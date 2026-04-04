import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { checkExtensionToken, hashToken } from "../_shared/extension-auth.ts"

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!
/** Optional legacy single secret; clients may also use tokens issued via admin-console (DB). */
const LEGACY_EXTENSION_TOKEN = Deno.env.get("EXTENSION_TOKEN") ?? undefined
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const ALLOWED_ORIGINS = [
  "https://outlook.office.com",
  "https://outlook.office365.com",
  "https://outlook.cloud.microsoft",
]

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-extension-token",
}

// ── Detection rules (server-side only) ──────────────────────────────────────
const GIFT_CARD_KEYWORDS = [
  'gift card', 'gift cards', 'itunes card', 'google play card', 'amazon gift card',
  'steam card', 'ebay gift card', 'visa gift card', 'buy gift cards', 'purchase gift cards',
  'get gift cards', 'send gift cards', 'gift card number', 'gift card code',
  'scratch the card', 'scratch card', 'card balance', 'redeem the card',
  'send me the codes', 'send the codes', 'send the numbers'
]

const HIGH_RISK_EXTENSIONS = ['.htm','.html','.js','.vbs','.vbe','.ps1','.wsf','.wsh','.jar','.hta']
const SUSPICIOUS_EXTENSIONS = ['.exe','.msi','.bat','.cmd','.iso','.img','.zip','.rar','.7z','.docm','.xlsm','.pptm','.lnk']

function checkForGiftCardFraud(subject: string, body: string): boolean {
  const combined = ((subject || '') + ' ' + (body || '')).toLowerCase()
  return GIFT_CARD_KEYWORDS.some(kw => combined.includes(kw))
}

const SAFE_DECOY_EXTENSIONS = ['.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.txt','.png','.jpg','.jpeg','.gif','.csv']
 classifyAttachments(attachments: string[]): {
  highRisk: string[], suspicious: string[], doubleExt: string[],
  hasHighRisk: boolean, hasSuspicious: boolean, count: number, highCount: boolean
} {
  const names = (attachments || []).map(a => a.toLowerCase())

  // Double-extension: e.g. invoice.pdf.exe — disguises malware as a safe file type
  const doubleExt = names.filter(n => {
    const parts = n.split('.')
    if (parts.length < 3) return false
    const finalExt = '.' + parts[parts.length - 1]
    const penultExt = '.' + parts[parts.length - 2]
    return (HIGH_RISK_EXTENSIONS.includes(finalExt) || SUSPICIOUS_EXTENSIONS.includes(finalExt))
      && SAFE_DECOY_EXTENSIONS.includes(penultExt)
  })

  const highRisk = [...new Set([
    ...names.filter(n => HIGH_RISK_EXTENSIONS.some(e => n.endsWith(e))),
    ...doubleExt,
  ])]
  const suspicious = names.filter(n => !highRisk.includes(n) && SUSPICIOUS_EXTENSIONS.some(e => n.endsWith(e)))
  const count = names.length
  return { highRisk, suspicious, doubleExt, hasHighRisk: highRisk.length > 0, hasSuspicious: suspicious.length > 0, count, highCount: count >= 5 }
}

const RATE_LIMIT_WINDOW_MS = 5000
const MAX_BODY_LENGTH = 3000
const MAX_TENANT_DOMAIN_LEN = 253
const MAX_LOG_SUBJECT_LEN = 300
const MAX_LOG_ADDRESS_LEN = 500

function clipLogField(s: string, max: number): string {
  const t = (s || "").trim()
  return t.length <= max ? t : t.slice(0, max) + "…"
}

/** Structured line for Supabase Edge Function log stream (Dashboard → Functions → Logs). */
function logScanEnvelope(event: string, emailData: EmailData) {
  console.log(JSON.stringify({
    event,
    subject: clipLogField(emailData.subject, 220),
    from: clipLogField(emailData.sender, 220),
    to: clipLogField(emailData.recipient ?? "(No recipient found)", 220),
  }))
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface EmailLink {
  display: string
  href: string
  fullUrl?: string
  mismatch?: boolean
}

interface EmailData {
  subject: string
  sender: string
  recipient?: string
  senderHasEmail: boolean
  body: string
  links: EmailLink[]
  attachments: string[]
  hasHighRiskAttachment: boolean
  hasSuspiciousAttachment: boolean
  highRiskFiles: string[]
  suspiciousFiles: string[]
  doubleExtFiles?: string[]
  attachmentCount?: number
  hasHighAttachmentCount?: boolean
  // Header-derived signals (extracted from Outlook DOM)
  replyTo?: string | null
  onBehalfOf?: string | null
  viaHeader?: string | null
  displayName?: string | null  senderEmail?: string | null
  displayNameMismatch?: boolean
  outlookWarnings?: string[]
  isOutlookExternal: boolean
  clientTimestamp: string
  clientTimezone?: string
}

// ── Trusted Microsoft system senders ─────────────────────────────────────────
const TRUSTED_MICROSOFT_SENDERS = [
  "powerautomatenoreply@microsoft.com",
  "no-reply@microsoft.com",
  "noreply@microsoft.com",
  "msa@communication.microsoft.com",
  "microsoft-noreply@microsoft.com",
  "sharepoint@communication.microsoft.com",
  "teams@communication.microsoft.com",
  "azure-noreply@microsoft.com",
  "notify@email.windowsazure.com",
  "admin@email.windowsazure.com",
]

function isTrustedMicrosoftSender(sender: string): boolean {
  const s = sender.toLowerCase()
  return TRUSTED_MICROSOFT_SENDERS.some(trusted => s.includes(trusted)) ||
    (s.includes("@microsoft.com") && (
      s.includes("noreply") || s.includes("no-reply") ||
      s.includes("powerautomate") || s.includes("sharepoint") ||
      s.includes("teams") || s.includes("azure") || s.includes("notify")
    ))
}

// ── Trusted third-party SaaS senders ─────────────────────────────────────────
const TRUSTED_SAAS_DOMAINS: Array<{ domain: string; name: string; linkDomains: string[] }> = [
  { domain: "1password.ca",   name: "1Password",    linkDomains: ["1password.com", "1password.ca"] },
  { domain: "1password.com",  name: "1Password",    linkDomains: ["1password.com", "1password.ca"] },
  { domain: "github.com",     name: "GitHub",       linkDomains: ["github.com", "githubusercontent.com"] },
  { domain: "gitlab.com",     name: "GitLab",       linkDomains: ["gitlab.com"] },
  { domain: "atlassian.com",  name: "Atlassian",    linkDomains: ["atlassian.com", "atlassian.net"] },
  { domain: "slack.com",      name: "Slack",        linkDomains: ["slack.com"] },
  { domain: "zoom.us",        name: "Zoom",         linkDomains: ["zoom.us"] },
  { domain: "docusign.com",   name: "DocuSign",     linkDomains: ["docusign.com", "docusign.net"] },
  { domain: "dropbox.com",    name: "Dropbox",      linkDomains: ["dropbox.com"] },
  { domain: "salesforce.com", name: "Salesforce",   linkDomains: ["salesforce.com", "force.com"] },
  { domain: "hubspot.com",    name: "HubSpot",      linkDomains: ["hubspot.com", "hs-sites.com"] },
  { domain: "lastpass.com",   name: "LastPass",     linkDomains: ["lastpass.com"] },
  { domain: "okta.com",       name: "Okta",         linkDomains: ["okta.com"] },
  { domain: "duo.com",        name: "Duo Security", linkDomains: ["duo.com"] },
]

function getTrustedSaasMatch(sender: string): { domain: string; name: string; linkDomains: string[] } | null {
  const s = sender.toLowerCase()
  return TRUSTED_SAAS_DOMAINS.find(entry =>
    s.includes("@" + entry.domain) || s.includes("." + entry.domain + ">")
  ) ?? null
}

// ── Extract sender domain from email address ──────────────────────────────────
// Handles formats like: "Display Name <user@domain.com>", "user@domain.com"
function extractSenderDomain(sender: string): string {
  if (!sender) return ""
  const s = sender.toLowerCase()
  // Match email address in angle brackets first, then bare email
  const match = s.match(/<[^>]*@([a-z0-9.-]+)>/) || s.match(/@([a-z0-9.-]+)/)
  return match ? match[1] : ""
}

// ── Determine if sender is external based on domain comparison ────────────────
// Returns: 'internal' | 'external' | 'unknown'
function classifySenderDomain(sender: string, tenantDomain: string): 'internal' | 'external' | 'unknown' {
  if (!tenantDomain) return 'unknown'
  const senderDomain = extractSenderDomain(sender)
  if (!senderDomain) return 'unknown'
  // Internal if sender domain matches or is a subdomain of tenantDomain
  if (senderDomain === tenantDomain || senderDomain.endsWith("." + tenantDomain)) return 'internal'
  return 'external'
}


// ── Lookalike Domain Detection ─────────────────────────────────────────────
// Detects domains impersonating well-known brands via character substitution,
// Levenshtein distance, subdomain abuse, and homoglyph swaps.

interface BrandEntry {
  name: string
  domains: string[]      // All legitimate domains for this brand
  keywords: string[]     // Core brand keywords to match against display text
}

const BRAND_LIST: BrandEntry[] = [
  // Financial
  { name: "PayPal",          domains: ["paypal.com"],                              keywords: ["paypal"] },
  { name: "Chase",           domains: ["chase.com","jpmorgan.com"],                keywords: ["chase","jpmorgan"] },
  { name: "Wells Fargo",     domains: ["wellsfargo.com"],                          keywords: ["wellsfargo","wells fargo"] },
  { name: "Bank of America", domains: ["bankofamerica.com"],                       keywords: ["bankofamerica","bank of america"] },
  { name: "Citibank",        domains: ["citi.com","citibank.com"],                 keywords: ["citi","citibank"] },
  { name: "American Express",domains: ["americanexpress.com","amex.com"],          keywords: ["amex","americanexpress","american express"] },
  { name: "Visa",            domains: ["visa.com"],                                keywords: ["visa"] },
  { name: "Mastercard",      domains: ["mastercard.com"],                          keywords: ["mastercard"] },
  { name: "Capital One",     domains: ["capitalone.com"],                          keywords: ["capitalone","capital one"] },
  // Tech / Cloud
  { name: "Microsoft",       domains: ["microsoft.com","live.com","outlook.com","office.com","office365.com","microsoftonline.com","sharepoint.com","onedrive.com"], keywords: ["microsoft","office365","onedrive","sharepoint"] },
  { name: "Google",          domains: ["google.com","gmail.com","google.ca","google.co.uk","googleapis.com","goog.le"], keywords: ["google","gmail","google drive","google workspace"] },
  { name: "Apple",           domains: ["apple.com","icloud.com"],                  keywords: ["apple","icloud","itunes","app store"] },
  { name: "Amazon",          domains: ["amazon.com","amazon.ca","amazon.co.uk","aws.amazon.com","awsapps.com"], keywords: ["amazon","aws","amazon web services"] },
  { name: "Dropbox",         domains: ["dropbox.com"],                             keywords: ["dropbox"] },
  { name: "Adobe",           domains: ["adobe.com"],                               keywords: ["adobe","acrobat","photoshop","creative cloud"] },
  { name: "Zoom",            domains: ["zoom.us","zoom.com"],                      keywords: ["zoom"] },
  { name: "Slack",           domains: ["slack.com"],                               keywords: ["slack"] },
  { name: "DocuSign",        domains: ["docusign.com","docusign.net"],             keywords: ["docusign"] },
  { name: "Salesforce",      domains: ["salesforce.com","force.com"],              keywords: ["salesforce"] },
  { name: "GitHub",          domains: ["github.com","githubusercontent.com"],       keywords: ["github"] },
  { name: "LinkedIn",        domains: ["linkedin.com"],                            keywords: ["linkedin"] },
  { name: "Facebook",        domains: ["facebook.com","fb.com","meta.com"],        keywords: ["facebook","meta"] },
  { name: "Twitter / X",     domains: ["twitter.com","x.com","t.co"],             keywords: ["twitter"] },
  { name: "Instagram",       domains: ["instagram.com"],                           keywords: ["instagram"] },
  { name: "Netflix",         domains: ["netflix.com"],                             keywords: ["netflix"] },
  { name: "Spotify",         domains: ["spotify.com"],                             keywords: ["spotify"] },
  // Shipping / Retail
  { name: "FedEx",           domains: ["fedex.com"],                               keywords: ["fedex"] },
  { name: "UPS",             domains: ["ups.com"],                                 keywords: ["ups"] },
  { name: "DHL",             domains: ["dhl.com","dhl.de"],                        keywords: ["dhl"] },
  { name: "USPS",            domains: ["usps.com"],                                keywords: ["usps","postal service"] },
  { name: "Canada Post",     domains: ["canadapost.ca","canadapost-postescanada.ca"], keywords: ["canada post","canadapost"] },
  // Government / Tax
  { name: "IRS",             domains: ["irs.gov"],                                 keywords: ["irs"] },
  { name: "Canada Revenue",  domains: ["canada.ca","cra-arc.gc.ca"],               keywords: ["cra","canada revenue","service canada"] },
  // Security / Identity
  { name: "Okta",            domains: ["okta.com"],                                keywords: ["okta"] },
  { name: "Duo Security",    domains: ["duo.com","duosecurity.com"],               keywords: ["duo"] },
  { name: "1Password",       domains: ["1password.com","1password.ca"],            keywords: ["1password"] },
  { name: "LastPass",        domains: ["lastpass.com"],                            keywords: ["lastpass"] },
]

// Normalise a domain: strip www. and trailing slash, lowercase
function normaliseDomain(d: string): string {
  return d.replace(/^www\./i, '').toLowerCase().split('/')[0].split(':')[0]
}

// Levenshtein distance (iterative, O(n*m))
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
    }
  }
  return dp[m][n]
}

// Homoglyph / number-swap normalisation: map visually similar chars to canonical form
const HOMOGLYPH_MAP: Record<string, string> = {
  '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '6': 'b', '7': 't', '8': 'b',
  'vv': 'w', 'rn': 'm', 'cl': 'd', 'ii': 'u',
}
function normaliseHomoglyphs(s: string): string {
  let r = s.toLowerCase()
  // Multi-char substitutions first
  for (const [from, to] of Object.entries(HOMOGLYPH_MAP)) {
    if (from.length > 1) r = r.split(from).join(to)
  }
  // Single-char substitutions
  r = r.split('').map(c => (HOMOGLYPH_MAP[c] && HOMOGLYPH_MAP[c].length === 1 ? HOMOGLYPH_MAP[c] : c)).join('')
  return r
}

interface LookalikeHit {
  domain: string       // The suspicious domain
  brand: string        // Brand it's impersonating
  technique: string    // How it was detected
  legitimateDomain: string  // The real domain
}

function detectLookalikeDomains(links: EmailLink[]): LookalikeHit[] {
  const hits: LookalikeHit[] = []
  const seen = new Set<string>()

  for (const link of links) {
    if (!link.href) continue
    const raw = normaliseDomain(link.href)
    // Strip port
    const domain = raw.split(':')[0]
    if (!domain || domain.length < 4) continue
    // Extract registrable domain (last two parts) and full hostname
    const parts = domain.split('.')
    if (parts.length < 2) continue
    const registrable = parts.slice(-2).join('.')   // e.g. "paypa1.com"
    const tld = parts[parts.length - 1]

    for (const brand of BRAND_LIST) {
      for (const legit of brand.domains) {
        const legitNorm = normaliseDomain(legit)
        const legitParts = legitNorm.split('.')
        const legitRegistrable = legitParts.slice(-2).join('.')

        // Skip if it IS the legitimate domain (exact or subdomain)
        if (domain === legitNorm || domain.endsWith('.' + legitNorm)) continue
        // Skip if registrable domains match (already caught by exact check)
        if (registrable === legitRegistrable) continue

        const key = `${domain}::${legit}`
        if (seen.has(key)) continue

        // ── Technique 1: Subdomain abuse ─────────────────────────────────
        // e.g. microsoft.com.evil.ru — legitimate brand appears as a subdomain
        if (domain.includes('.' + legitNorm + '.') || domain.startsWith(legitNorm + '.')) {
          seen.add(key)
          hits.push({ domain, brand: brand.name, technique: 'subdomain-abuse', legitimateDomain: legit })
          break
        }

        // ── Technique 2: Homoglyph-normalised exact match ─────────────────
        // e.g. paypa1.com -> paypal.com after normalisation
        const normDomain = normaliseHomoglyphs(registrable)
        const normLegit  = normaliseHomoglyphs(legitRegistrable)
        if (normDomain === normLegit && registrable !== legitRegistrable) {
          seen.add(key)
          hits.push({ domain, brand: brand.name, technique: 'character-substitution', legitimateDomain: legit })
          break
        }

        // ── Technique 3: Levenshtein distance ────────────────────────────
        // Only compare if TLD matches (reduces false positives) and
        // brand keyword appears somewhere in the domain (avoids flagging
        // completely unrelated short domains)
        if (tld === legitParts[legitParts.length - 1]) {
          const brandCore = legitParts[0]  // e.g. "paypal" from "paypal.com"
          const dist = levenshtein(registrable, legitRegistrable)
          const maxLen = Math.max(registrable.length, legitRegistrable.length)
          // Distance 1-2 edits AND domain contains some chars from brand name
          // AND normalised forms differ (catches swaps not caught above)
          if (dist >= 1 && dist <= 2 && normDomain !== normLegit) {
            // Extra guard: at least 60% char overlap to avoid false positives
            const overlap = [...registrable].filter(c => legitRegistrable.includes(c)).length
            if (overlap / brandCore.length >= 0.6) {
              seen.add(key)
              hits.push({ domain, brand: brand.name, technique: 'typosquatting', legitimateDomain: legit })
              break
            }
          }
        }
      }
    }
  }

  return hits
}
// ── Prompt builder (all analysis logic lives here, not in the extension) ─────
function buildPrompt(e: EmailData, customPrompt: string, tenantDomain: string): string {
  const now = new Date()
  const utcString = now.toUTCString()
  const tz = e.clientTimezone || "America/Edmonton"
  let localString = ""
  try { localString = now.toLocaleString("en-US", { timeZone: tz, timeZoneName: "short" }) }
  catch { localString = now.toLocaleString("en-US", { timeZone: "America/Edmonton", timeZoneName: "short" }) }

  const orgContext = tenantDomain
    ? `Recipient organization primary domain (from extension settings): ${tenantDomain}`
    : `Recipient organization domain: not configured in extension settings — infer internal vs external from email content, sender addresses, and Outlook external indicators only.`

  const sharePointLine = tenantDomain
    ? `SharePoint/OneDrive links from ${tenantDomain} or *.sharepoint.com are typically INTERNAL collaboration links for this org; do not flag them as suspicious without other red flags.`
    : `SharePoint/OneDrive/Microsoft 365 links may be internal collaboration; do not flag without other red flags.`

  const customLine = customPrompt ? `- Additional instructions: ${customPrompt}` : ""

  const attachmentList = e.attachments?.length > 0
    ? e.attachments.map(n => {
        const isDouble = (e.doubleExtFiles || []).includes(n)
        const isHigh = (e.highRiskFiles || []).includes(n)
        const isSusp = (e.suspiciousFiles || []).includes(n)
        const tag = isDouble ? ' [DOUBLE-EXTENSION — disguised as safe file]'
          : isHigh ? ' [HIGH RISK]'
          : isSusp ? ' [SUSPICIOUS]'
          : ''
        return n + tag
      }).join(", ")
    : "(none)"

  const doubleExtList = (e.doubleExtFiles || []).join(", ")
  let attachmentWarning = ""
  if (e.hasHighRiskAttachment) {
    const reason = doubleExtList
      ? `Includes double-extension file(s) disguised as safe types: ${doubleExtList}. `
      : ""
    attachmentWarning = `CRITICAL: HIGH RISK attachment(s) detected: ${e.highRiskFiles.join(", ")}. ${reason}You MUST set verdict to PHISHING, phishing_score to at least 90, and suggested_action MUST include: Do NOT open this attachment. Report this email to your IT security team immediately.`
  } else if (e.hasSuspiciousAttachment) {
    attachmentWarning = `WARNING: SUSPICIOUS attachment(s) detected: ${e.suspiciousFiles.join(", ")}. Set phishing_score to at least 60 and suggested_action MUST include: Do not open this attachment unless you are certain of its origin.`
  }
  if (e.hasHighAttachmentCount) {
    attachmentWarning += ` NOTE: This email has an unusually high number of attachments (${e.attachmentCount}), which is atypical for legitimate emails and may indicate a spray-and-pray malware delivery attempt.`
  }

  const lookalikesDetected = detectLookalikeDomains(e.links || [])
  const lookalikeByDomain = new Map<string, LookalikeHit>(
    lookalikesDetected.map(h => [normaliseDomain(h.domain), h])
  )

  const linksBlock = e.links?.length > 0
    ? e.links.map(l => {
        const norm = normaliseDomain(l.href || '')
        const hit = lookalikeByDomain.get(norm)
        const mismatchTag = l.mismatch ? ' WARNING: DOMAIN MISMATCH' : ''
        const lookalikeTag = hit
          ? ` LOOKALIKE ALERT: impersonates ${hit.brand} (${hit.legitimateDomain}) via ${hit.technique}`
          : ''
        return ` - Display: "${l.display}" -> Real domain: ${l.href}${mismatchTag}${lookalikeTag}`
      }).join("\n")
    : " (No links found)"

  // ── Server-side external classification (more reliable than client-side banner) ──
  const senderDomainClassification = classifySenderDomain(e.sender, tenantDomain)
  const senderDomain = extractSenderDomain(e.sender)

  let externalNote: string
  if (senderDomainClassification === 'internal') {
    // Domain matches tenant — definitely internal, override Outlook's banner if needed
    externalNote = `NO - sender domain "${senderDomain}" matches your organization domain "${tenantDomain}". Treat as INTERNAL.`
  } else if (senderDomainClassification === 'external') {
    // Domain does NOT match tenant — definitely external
    externalNote = `YES - sender domain "${senderDomain}" does NOT match your organization domain "${tenantDomain}". This is an EXTERNAL sender.`
  } else if (e.isOutlookExternal) {
    // No tenant domain configured but Outlook flagged it
    externalNote = "YES - Microsoft Outlook has confirmed this is from an external organization (no tenant domain configured to verify further)."
  } else {
    // No tenant domain and no Outlook flag
    externalNote = "UNKNOWN - no organization domain configured in settings and Outlook has not flagged this as external. Do not assume external based on display name alone."
  }

  // Trust note for known Microsoft system senders
  const microsoftTrustNote = isTrustedMicrosoftSender(e.sender)
    ? `TRUSTED MICROSOFT SYSTEM EMAIL: The sender "${e.sender}" is a known legitimate Microsoft automated notification service (Power Automate, SharePoint, Teams, Azure, etc.).
CRITICAL RULES for this email:
1. The "external organization" warning shown by Outlook is EXPECTED and NORMAL — Microsoft sends these notifications from their own tenant, not yours. This is NOT a red flag.
2. SafeLinks-wrapped URLs pointing to make.powerautomate.com, portal.azure.com, admin.microsoft.com, sharepoint.com, teams.microsoft.com, or other Microsoft service domains are LEGITIMATE.
3. Do NOT flag this email as phishing or suspicious solely because it is marked external or contains Microsoft service links.
4. Still scan for actual red flags: credential harvesting, unexpected password resets, suspicious non-Microsoft link destinations, or content inconsistent with a system notification.
5. If the email content matches expected Microsoft system notification patterns (flow alerts, subscription changes, service updates, security codes for services the user likely uses), lean toward SAFE.`
    : ""

  // Trust note for known third-party SaaS senders
  const saasMatch = getTrustedSaasMatch(e.sender)
  const saasTrustNote = saasMatch
    ? `TRUSTED THIRD-PARTY SAAS EMAIL: The sender "${e.sender}" is a known legitimate notification from ${saasMatch.name}.
CRITICAL RULES for this email:
1. The "external organization" warning shown by Outlook is EXPECTED and NORMAL — ${saasMatch.name} sends notifications from their own servers, not your org's tenant. This is NOT a red flag.
2. Links pointing to these domains are LEGITIMATE for ${saasMatch.name}: ${saasMatch.linkDomains.join(", ")}. Do NOT flag them as suspicious.
3. Do NOT flag this email as phishing solely because it is marked external or contains ${saasMatch.name} service links.
4. Still scan for actual red flags: links going to non-${saasMatch.name} domains, unexpected credential requests, urgent pressure inconsistent with normal ${saasMatch.name} notifications, or content that doesn't match the subject.
5. Sign-in alerts, new device notifications, and account activity summaries from ${saasMatch.name} are routine and expected — lean toward SAFE if content matches normal ${saasMatch.name} notification patterns.`
    : ""


  // ── Header signal block for the prompt ──────────────────────────────────────
  const headerLines: string[] = []

  if (e.displayName && e.senderEmail) {
    headerLines.push(`Sender display name: "${e.displayName}" | Actual email: ${e.senderEmail}`)
  }
  if (e.displayNameMismatch) {
    headerLines.push(`DISPLAY NAME MISMATCH: The display name implies a well-known brand but the sending email address belongs to a different domain. This is a classic phishing technique. MUST flag as a finding.`)
  }
  if (e.replyTo) {
    const rtDiffers = e.senderEmail && e.replyTo.toLowerCase() !== e.senderEmail.toLowerCase()
    const rtDomain = e.replyTo.includes('@') ? e.replyTo.split('@')[1] : ''
    const senderDomainForRT = e.senderEmail?.split('@')[1] ?? ''
    const rtDomainMismatch = rtDomain && senderDomainForRT && rtDomain !== senderDomainForRT
    if (rtDiffers && rtDomainMismatch) {
      headerLines.push(`Reply-To MISMATCH: Replies will go to "${e.replyTo}" which is on a DIFFERENT DOMAIN than the sender (${senderDomainForRT}). This is a common phishing technique to intercept replies. MUST flag as a finding if verdict is SUSPICIOUS or PHISHING.`)
    } else if (rtDiffers) {
      headerLines.push(`Reply-To differs from sender: "${e.replyTo}" — replies will go to a different address than the one that sent this.`)
    } else {
      headerLines.push(`Reply-To: ${e.replyTo} (matches sender — normal)`)
    }
  }
  if (e.onBehalfOf) {
    headerLines.push(`Sent on behalf of: "${e.onBehalfOf}" — verify this delegation is expected and legitimate.`)
  }
  if (e.viaHeader) {
    const KNOWN_ESP = ['mailchimp','sendgrid','constantcontact','hubspot','klaviyo','salesforce','marketo','campaignmonitor','exacttarget','aweber','mailgun','postmark','sparkpost']
    const isKnownESP = KNOWN_ESP.some(esp => e.viaHeader!.includes(esp))
    headerLines.push(`Sent via: ${e.viaHeader}${isKnownESP ? ' (known email service provider — normal for marketing emails)' : ' (third-party relay — verify this is expected)'}`)
  }
  if (e.outlookWarnings && e.outlookWarnings.length > 0) {
    headerLines.push(`Outlook surfaced these warnings in the UI:`)
    e.outlookWarnings.forEach(w => headerLines.push(`  - "${w}"`))
  }

  const headerSignalsBlock = headerLines.length > 0
    ? `\nHEADER SIGNALS (extracted from Outlook DOM — treat as high-confidence data):\n${headerLines.join('\n')}\n`
    : ''
  // ── Lookalike domain warning block ──────────────────────────────────────
  let lookalikeWarning = ''
  if (lookalikesDetected.length > 0) {
    const hitLines = lookalikesDetected.map(
      h => `  -  is impersonating  () — detected via `
    ).join('\n')    lookalikeWarning = `LOOKALIKE DOMAIN ALERT: The following link domains appear to be impersonating well-known brands. You MUST flag each one as a finding. Set verdict to at least SUSPICIOUS; if combined with credential requests or urgency, set to PHISHING with phishing_score >= 85.\n\n`  }  return `You are a cybersecurity educator helping everyday office workers learn to identify email threats. Analyze the email below and respond ONLY with a JSON object - no markdown, no text outside the JSON.

IMPORTANT CONTEXT:
- Current date/time: ${utcString} (UTC) / ${localString} (${tz}). Do not flag dates as suspicious if they fall within the current day across timezones.
- ${orgContext}
${headerSignalsBlock}- Sender: ${e.sender}
- Is this an external sender? ${externalNote}
- If sender is "(No sender found)" that is a technical extraction issue, NOT a red flag - do not flag it as suspicious
- Do NOT assume external based on display name alone
- ${sharePointLine}
${microsoftTrustNote}
${saasTrustNote}
${customLine}
ENVIRONMENT-SPECIFIC RULES (CRITICAL - follow these exactly):
- This org uses Trend Micro and Microsoft SafeLinks. ALL links will route through safelinks.protection.outlook.com or Trend Micro URL filters. Do NOT flag these wrappers - links are already decoded.
- Known trusted external vendors/services for this org: sharegate.com, sharegate-software.com (SharePoint migration/management tool). Emails from Sharegate are expected and legitimate.
- If sender is '(No sender found)' this is a known technical extraction limitation of Outlook's web rendering - this is NOT a red flag and MUST NOT be listed as a finding. Do not mention missing sender info at all.
- Do not flag the absence of a visible sender email address as suspicious if the email content is otherwise legitimate business communication.
- The body text is read from Outlook on the web: OTPs, verification codes, magic links, or JWT-like strings may be masked, truncated, or hidden by the client — do not treat missing codes as proof an email is benign, and do not assume the body is complete.

KEY RULES:
1. NEVER give any email a free pass based on sender domain alone - even internal senders can be compromised.
2. Only flag as external if the domain comparison above confirms it OR Outlook shows the warning.
3. Well-known domains (microsoft.com etc) - don't flag the domain itself, but DO flag suspicious content, urgency, credential requests.
4. Analyze content and intent independently of sender.
5. If email involves adding users, granting access, payments, credential changes, or urgent action - suggested_action MUST include: "Verify this request through official channels other than email before taking action."
6. If email contains a login link, verification code, OTP, security alert, or account notification - suggested_action MUST include: "If you did not request this, do not click any links and report this to your IT security team immediately."
7. If email contains a verification or security code - suggested_action MUST include: "Never share this code with anyone - legitimate services will never ask you for it."
8. HEADER RULES (only apply when header signals are provided above):
   a. If Reply-To domain differs from sender domain: flag as suspicious finding — this is used to intercept replies.
   b. If display name mismatch is confirmed (flagged above): MUST set verdict to at least SUSPICIOUS and MUST include a finding.
   c. If "Sent on behalf of" is present: note it, but only flag if the delegating address seems inconsistent with the email content.
   d. If "Sent via" is an unknown relay: note it; if via a known ESP it is normal for marketing.. GIFT CARD RULE: Any request to purchase or send gift cards of any kind
9. LOOKALIKE DOMAIN RULE: Any domain flagged as LOOKALIKE ALERT in the links section MUST be included as a finding. Explain what character substitution or typosquatting means in plain language. Set verdict to at least SUSPICIOUS.
10. GIFT CARD RULE: Any request to purchase or send gift cards of any kind (iTunes, Google Play, Amazon, Visa, Steam, etc.) MUST be flagged as PHISHING with phishing_score of 99. No legitimate business ever requests gift card payments. This is always fraud.

VERDICT DEFINITIONS - apply these strictly:
- SAFE: Legitimate email with no red flags. Internal comms, expected system notifications, known business contacts.
- SPAM: Unsolicited commercial or marketing email. Insurance offers, benefit programs, promotions, newsletters, sales pitches from outside the org. No credential theft or malware risk - just unwanted. Use SPAM (not SUSPICIOUS) for these.
- SUSPICIOUS: Something feels off but not clearly malicious. Unexpected requests, odd sender, minor red flags that don't rise to phishing.
- PHISHING: Actively trying to steal credentials, install malware, or trick the user into a harmful action.

EDUCATION FOCUS - THIS IS CRITICAL:
Write all findings for a non-technical audience. No jargon. For each red flag:
- Explain what the attacker is doing and WHY it fools people
- Explain exactly how the user can spot this themselves next time
- Use plain conversational language like explaining to a friend
- If there are NO red flags, return an empty findings array - do not invent issues

Email details:
Subject: ${e.subject}
From: ${e.sender}
Body:
${e.body}
Attachments found: ${attachmentList}
${attachmentWarning}
${lookalikeWarning}

EMBEDDED LINKS (already decoded from safelinks wrappers):
${linksBlock}

When analyzing links:
1. Do NOT flag safelinks.protection.outlook.com or urldefense.com - already decoded above
2. Flag display text showing one domain but real destination is completely different
3. Any link marked LOOKALIKE ALERT has been algorithmically verified as impersonating a known brand — treat it as confirmed and MUST flag it as a finding
4. Flag URL shorteners (bit.ly, tinyurl, t.co)
5. For lookalike domains: explain the specific deception technique (character substitution, typosquatting, subdomain abuse) in plain English so users can spot it themselves

Respond with this EXACT JSON structure:
{
  "verdict": "SAFE" | "SUSPICIOUS" | "SPAM" | "PHISHING",
  "phishing_score": <0-100>,
  "spam_score": <0-100>,
  "summary": "<1-2 sentence plain-English summary>",
  "findings": [
    {
      "flag": "<Short plain-English name of the red flag>",
      "explanation": "<2-3 sentences: what the attacker is doing, why this technique fools people, what the risk is>",
      "howToSpotIt": "<1-2 sentences: exactly what to look for in any email to catch this yourself next time>"
    }
  ],
  "lesson": "<One memorable sentence the user can apply to every future email>",
  "suggested_action": "<Clear instruction on what to do right now>"
}`
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req) => {
  const origin = req.headers.get("origin") ?? ""
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : "*"
  const corsHeaders = { ...CORS_HEADERS, "Access-Control-Allow-Origin": allowOrigin }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, corsHeaders)
  }

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    return json({ error: "Invalid JSON" }, 400, corsHeaders)
  }
  const headerToken = req.headers.get("x-extension-token") ?? ""
  const raw = parsedBody as Record<string, unknown>
  // Use `oeAuth` in JSON body — some proxies flag or strip a top-level `token` field; legacy `token` still accepted.
  const bodyToken =
    (typeof raw?.oeAuth === "string" ? raw.oeAuth : "") ||
    (typeof raw?.token === "string" ? raw.token : "")
  const token = headerToken || bodyToken
  if (!token) {
    return json({ error: "Unauthorized" }, 401, corsHeaders)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const auth = await checkExtensionToken(supabase, token, LEGACY_EXTENSION_TOKEN)
  if (!auth.ok) {
    const err =
      auth.reason === "expired"
        ? "License expired — request a new key from your administrator."
        : "Unauthorized"
    return json({ error: err }, 401, corsHeaders)
  }

  if (
    parsedBody !== null &&
    typeof parsedBody === "object" &&
    !Array.isArray(parsedBody) &&
    (parsedBody as { ping?: boolean }).ping === true
  ) {
    return json({ ok: true }, 200, corsHeaders)
  }

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const tokenKey = await hashToken(token)
  const now = Date.now()
  const windowStart = new Date(now - RATE_LIMIT_WINDOW_MS).toISOString()

  const { count } = await supabase
    .from("rate_limit_log")
    .select("*", { count: "exact", head: true })
    .eq("token_key", tokenKey)
    .gte("created_at", windowStart)

  if (count && count >= 1) {
    return json(
      { error: "Rate limit: please wait 5 seconds between analyses." },
      429,
      { ...corsHeaders, "Retry-After": "5" }
    )
  }

  await supabase.from("rate_limit_log").insert({
    token_key: tokenKey,
    created_at: new Date(now).toISOString(),
  })

  // ── Parse and validate request body ───────────────────────────────────────
  let emailData: EmailData
  let customPrompt: string
  let tenantDomain: string
  try {
    const body = parsedBody as { emailData?: EmailData; customPrompt?: string; tenantDomain?: string }
    emailData = body.emailData!
    customPrompt = typeof body.customPrompt === "string" ? body.customPrompt : ""
    tenantDomain = sanitizeTenantDomain(body.tenantDomain)
    if (!emailData || typeof emailData.subject !== "string" || typeof emailData.body !== "string") {
      throw new Error("missing emailData")
    }
    emailData.body = emailData.body.slice(0, MAX_BODY_LENGTH)
    emailData.subject = emailData.subject.slice(0, 300)
    emailData.sender = (emailData.sender || "(No sender found)").slice(0, 300)
    emailData.recipient = typeof emailData.recipient === "string"
      ? emailData.recipient.slice(0, MAX_LOG_ADDRESS_LEN)
      : "(No recipient found)"
    emailData.links = (emailData.links || []).slice(0, 20)
    emailData.attachments = (emailData.attachments || []).slice(0, 20)

    const attach = classifyAttachments(emailData.attachments)
    emailData.hasHighRiskAttachment = attach.hasHighRisk
    emailData.hasSuspiciousAttachment = attach.hasSuspicious
    emailData.highRiskFiles = attach.highRisk
    emailData.suspiciousFiles = attach.suspicious
    emailData.doubleExtFiles = attach.doubleExt
    emailData.attachmentCount = attach.count
    emailData.hasHighAttachmentCount = attach.highCount
  } catch {
    return json({ error: "Invalid request body" }, 400, corsHeaders)
  }

  if (checkForGiftCardFraud(emailData.subject, emailData.body)) {
    logScanEnvelope("scan_gift_card_rule", emailData)
    supabase.from("scan_log").insert({
      token_key: tokenKey,
      verdict: "PHISHING",
      phishing_score: 99,
      spam_score: 10,
      response_time_ms: null,
      subject: clipLogField(emailData.subject, MAX_LOG_SUBJECT_LEN),
      sender: clipLogField(emailData.sender, MAX_LOG_ADDRESS_LEN),
      recipient: clipLogField(emailData.recipient, MAX_LOG_ADDRESS_LEN),
    }).then(() => {})

    return json({ result: {
      verdict: 'PHISHING', phishing_score: 99, spam_score: 10,
      summary: 'This email contains a request for gift cards. This is one of the most common fraud tactics used against businesses — it is almost certainly a scam.',
      findings: [{ flag: 'Gift card request detected', explanation: 'Fraudsters impersonate managers, executives, or colleagues and ask employees to buy gift cards urgently. No legitimate business request will ever ask for gift card payments.', howToSpotIt: 'If ANY email asks you to buy gift cards and send the codes — stop immediately. Call that person directly on a known phone number to verify.' }],
      lesson: 'No legitimate business transaction is ever completed with gift cards. If someone asks you to buy gift cards and send the codes, it is a scam — 100% of the time.',
      suggested_action: 'Do NOT purchase any gift cards. Report this email to your IT security team and your manager immediately.'
    }}, 200, corsHeaders)
  }

  const prompt = buildPrompt(emailData, customPrompt, tenantDomain)

  try {
    const t0 = Date.now()
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    })
    const responseTimeMs = Date.now() - t0

    if (!anthropicRes.ok) {
      const err = await anthropicRes.json()
      return json(
        { error: `Anthropic error ${anthropicRes.status}: ${err.error?.message ?? JSON.stringify(err)}` },
        502,
        corsHeaders
      )
    }

    const data = await anthropicRes.json()
    const text = (data.content?.[0]?.text ?? "").trim()
    const clean = text.replace(/```json|```/g, "").trim()
    const parsed = JSON.parse(clean)

    logScanEnvelope("scan_complete", emailData)
    supabase.from("scan_log").insert({
      token_key: tokenKey,
      verdict: parsed.verdict ?? "UNKNOWN",
      phishing_score: parsed.phishing_score ?? null,
      spam_score: parsed.spam_score ?? null,
      response_time_ms: responseTimeMs,
      subject: clipLogField(emailData.subject, MAX_LOG_SUBJECT_LEN),
      sender: clipLogField(emailData.sender, MAX_LOG_ADDRESS_LEN),
      recipient: clipLogField(emailData.recipient, MAX_LOG_ADDRESS_LEN),
    }).then(() => {})

    // Attach lookalike hits so the client can badge individual link rows    const resultWithLookalikes = {      ...parsed,      lookalikeDomains: lookalikesDetected.map(h => ({
        domain: h.domain,
        brand: h.brand,
        technique: h.technique,
        legitimateDomain: h.legitimateDomain,
      })),
      itSecurityEmail: itEmail,
    }    return json({ result: resultWithLookalikes }, 200, corsHeaders)

  } catch (err) {
    return json({ error: `Upstream fetch failed: ${(err as Error).message}` }, 502, corsHeaders)
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────
function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

function sanitizeTenantDomain(raw: unknown): string {
  if (typeof raw !== "string") return ""
  let s = raw.trim().toLowerCase().slice(0, MAX_TENANT_DOMAIN_LEN)
  s = s.replace(/^https?:\/\//, "")
  const host = s.split("/")[0]?.split(":")[0] ?? ""
  if (!host) return ""
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)) return ""
  if (host.includes("..")) return ""
  return host
}
