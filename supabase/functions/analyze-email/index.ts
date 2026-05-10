import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { checkExtensionToken, hashToken } from "../_shared/extension-auth.ts"

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!
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
function classifyAttachments(attachments: string[]): {
  highRisk: string[], suspicious: string[], doubleExt: string[],
  hasHighRisk: boolean, hasSuspicious: boolean, count: number, highCount: boolean
} {
  const names = (attachments || []).map(a => a.toLowerCase())
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
  replyTo?: string | null
  onBehalfOf?: string | null
  viaHeader?: string | null
  displayName?: string | null
  senderEmail?: string | null
  displayNameMismatch?: boolean
  outlookWarnings?: string[]
  isOutlookExternal: boolean
  clientTimestamp: string
  clientTimezone?: string
}

// ── Trusted senders ───────────────────────────────────────────────────────────
const TRUSTED_MICROSOFT_SENDERS = [
  "powerautomatenoreply@microsoft.com","no-reply@microsoft.com","noreply@microsoft.com",
  "msa@communication.microsoft.com","microsoft-noreply@microsoft.com",
  "sharepoint@communication.microsoft.com","teams@communication.microsoft.com",
  "azure-noreply@microsoft.com","notify@email.windowsazure.com","admin@email.windowsazure.com",
]

function isTrustedMicrosoftSender(sender: string): boolean {
  const s = sender.toLowerCase()
  return TRUSTED_MICROSOFT_SENDERS.some(t => s.includes(t)) ||
    (s.includes("@microsoft.com") && (
      s.includes("noreply") || s.includes("no-reply") || s.includes("powerautomate") ||
      s.includes("sharepoint") || s.includes("teams") || s.includes("azure") || s.includes("notify")
    ))
}

const TRUSTED_SAAS_DOMAINS: Array<{ domain: string; name: string; linkDomains: string[] }> = [
  { domain: "1password.ca",   name: "1Password",    linkDomains: ["1password.com","1password.ca"] },
  { domain: "1password.com",  name: "1Password",    linkDomains: ["1password.com","1password.ca"] },
  { domain: "github.com",     name: "GitHub",       linkDomains: ["github.com","githubusercontent.com"] },
  { domain: "gitlab.com",     name: "GitLab",       linkDomains: ["gitlab.com"] },
  { domain: "atlassian.com",  name: "Atlassian",    linkDomains: ["atlassian.com","atlassian.net"] },
  { domain: "slack.com",      name: "Slack",        linkDomains: ["slack.com"] },
  { domain: "zoom.us",        name: "Zoom",         linkDomains: ["zoom.us"] },
  { domain: "docusign.com",   name: "DocuSign",     linkDomains: ["docusign.com","docusign.net"] },
  { domain: "dropbox.com",    name: "Dropbox",      linkDomains: ["dropbox.com"] },
  { domain: "salesforce.com", name: "Salesforce",   linkDomains: ["salesforce.com","force.com"] },
  { domain: "hubspot.com",    name: "HubSpot",      linkDomains: ["hubspot.com","hs-sites.com"] },
  { domain: "lastpass.com",   name: "LastPass",     linkDomains: ["lastpass.com"] },
  { domain: "okta.com",       name: "Okta",         linkDomains: ["okta.com"] },
  { domain: "duo.com",        name: "Duo Security", linkDomains: ["duo.com"] },
]

function getTrustedSaasMatch(sender: string): { domain: string; name: string; linkDomains: string[] } | null {
  const s = sender.toLowerCase()
  return TRUSTED_SAAS_DOMAINS.find(e => s.includes("@" + e.domain) || s.includes("." + e.domain + ">")) ?? null
}

function extractSenderDomain(sender: string): string {
  if (!sender) return ""
  const s = sender.toLowerCase()
  const match = s.match(/<[^>]*@([a-z0-9.-]+)>/) || s.match(/@([a-z0-9.-]+)/)
  return match ? match[1] : ""
}

function classifySenderDomain(sender: string, tenantDomain: string): 'internal' | 'external' | 'unknown' {
  if (!tenantDomain) return 'unknown'
  const sd = extractSenderDomain(sender)
  if (!sd) return 'unknown'
  if (sd === tenantDomain || sd.endsWith("." + tenantDomain)) return 'internal'
  return 'external'
}

// ── Lookalike Domain Detection ─────────────────────────────────────────────────
interface BrandEntry { name: string; domains: string[]; keywords: string[] }
interface LookalikeHit { domain: string; brand: string; technique: string; legitimateDomain: string }

const BRAND_LIST: BrandEntry[] = [
  { name: "PayPal",          domains: ["paypal.com"],                                   keywords: ["paypal"] },
  { name: "Chase",           domains: ["chase.com","jpmorgan.com"],                     keywords: ["chase","jpmorgan"] },
  { name: "Wells Fargo",     domains: ["wellsfargo.com"],                               keywords: ["wellsfargo","wells fargo"] },
  { name: "Bank of America", domains: ["bankofamerica.com"],                            keywords: ["bankofamerica","bank of america"] },
  { name: "Citibank",        domains: ["citi.com","citibank.com"],                      keywords: ["citi","citibank"] },
  { name: "American Express",domains: ["americanexpress.com","amex.com"],               keywords: ["amex","americanexpress","american express"] },
  { name: "Visa",            domains: ["visa.com"],                                     keywords: ["visa"] },
  { name: "Mastercard",      domains: ["mastercard.com"],                               keywords: ["mastercard"] },
  { name: "Capital One",     domains: ["capitalone.com"],                               keywords: ["capitalone","capital one"] },
  { name: "Microsoft",       domains: ["microsoft.com","live.com","outlook.com","office.com","office365.com","microsoftonline.com","sharepoint.com","onedrive.com"], keywords: ["microsoft","office365","onedrive","sharepoint"] },
  { name: "Google",          domains: ["google.com","gmail.com","google.ca","google.co.uk","googleapis.com","goog.le"], keywords: ["google","gmail","google drive","google workspace"] },
  { name: "Apple",           domains: ["apple.com","icloud.com"],                       keywords: ["apple","icloud","itunes","app store"] },
  { name: "Amazon",          domains: ["amazon.com","amazon.ca","amazon.co.uk","aws.amazon.com","awsapps.com"], keywords: ["amazon","aws","amazon web services"] },
  { name: "Dropbox",         domains: ["dropbox.com"],                                  keywords: ["dropbox"] },
  { name: "Adobe",           domains: ["adobe.com"],                                    keywords: ["adobe","acrobat","photoshop","creative cloud"] },
  { name: "Zoom",            domains: ["zoom.us","zoom.com"],                           keywords: ["zoom"] },
  { name: "Slack",           domains: ["slack.com"],                                    keywords: ["slack"] },
  { name: "DocuSign",        domains: ["docusign.com","docusign.net"],                  keywords: ["docusign"] },
  { name: "Salesforce",      domains: ["salesforce.com","force.com"],                   keywords: ["salesforce"] },
  { name: "GitHub",          domains: ["github.com","githubusercontent.com"],            keywords: ["github"] },
  { name: "LinkedIn",        domains: ["linkedin.com"],                                 keywords: ["linkedin"] },
  { name: "Facebook",        domains: ["facebook.com","fb.com","meta.com"],             keywords: ["facebook","meta"] },
  { name: "Twitter / X",     domains: ["twitter.com","x.com","t.co"],                  keywords: ["twitter"] },
  { name: "Instagram",       domains: ["instagram.com"],                                keywords: ["instagram"] },
  { name: "Netflix",         domains: ["netflix.com"],                                  keywords: ["netflix"] },
  { name: "Spotify",         domains: ["spotify.com"],                                  keywords: ["spotify"] },
  { name: "FedEx",           domains: ["fedex.com"],                                    keywords: ["fedex"] },
  { name: "UPS",             domains: ["ups.com"],                                      keywords: ["ups"] },
  { name: "DHL",             domains: ["dhl.com","dhl.de"],                             keywords: ["dhl"] },
  { name: "USPS",            domains: ["usps.com"],                                     keywords: ["usps","postal service"] },
  { name: "Canada Post",     domains: ["canadapost.ca","canadapost-postescanada.ca"],   keywords: ["canada post","canadapost"] },
  { name: "IRS",             domains: ["irs.gov"],                                      keywords: ["irs"] },
  { name: "Canada Revenue",  domains: ["canada.ca","cra-arc.gc.ca"],                   keywords: ["cra","canada revenue","service canada"] },
  { name: "Okta",            domains: ["okta.com"],                                     keywords: ["okta"] },
  { name: "Duo Security",    domains: ["duo.com","duosecurity.com"],                    keywords: ["duo"] },
  { name: "1Password",       domains: ["1password.com","1password.ca"],                 keywords: ["1password"] },
  { name: "LastPass",        domains: ["lastpass.com"],                                 keywords: ["lastpass"] },
]

function normaliseDomain(d: string): string {
  return d.replace(/^www\./i, '').toLowerCase().split('/')[0].split(':')[0]
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}

const HOMOGLYPH_MAP: Record<string, string> = {
  '0':'o','1':'l','3':'e','4':'a','5':'s','6':'b','7':'t','8':'b','vv':'w','rn':'m','cl':'d','ii':'u',
}
function normaliseHomoglyphs(s: string): string {
  let r = s.toLowerCase()
  for (const [from, to] of Object.entries(HOMOGLYPH_MAP))
    if (from.length > 1) r = r.split(from).join(to)
  r = r.split('').map(c => (HOMOGLYPH_MAP[c] && HOMOGLYPH_MAP[c].length === 1 ? HOMOGLYPH_MAP[c] : c)).join('')
  return r
}

function detectLookalikeDomains(links: EmailLink[]): LookalikeHit[] {
  const hits: LookalikeHit[] = []
  const seen = new Set<string>()
  for (const link of links) {
    if (!link.href) continue
    const raw = normaliseDomain(link.href)
    const domain = raw.split(':')[0]
    if (!domain || domain.length < 4) continue
    const parts = domain.split('.')
    if (parts.length < 2) continue
    const registrable = parts.slice(-2).join('.')
    const tld = parts[parts.length - 1]
    for (const brand of BRAND_LIST) {
      for (const legit of brand.domains) {
        const legitNorm = normaliseDomain(legit)
        const legitParts = legitNorm.split('.')
        const legitRegistrable = legitParts.slice(-2).join('.')
        if (domain === legitNorm || domain.endsWith('.' + legitNorm)) continue
        if (registrable === legitRegistrable) continue
        const key = `${domain}::${legit}`
        if (seen.has(key)) continue
        if (domain.includes('.' + legitNorm + '.') || domain.startsWith(legitNorm + '.')) {
          seen.add(key); hits.push({ domain, brand: brand.name, technique: 'subdomain-abuse', legitimateDomain: legit }); break
        }
        const normDomain = normaliseHomoglyphs(registrable)
        const normLegit  = normaliseHomoglyphs(legitRegistrable)
        if (normDomain === normLegit && registrable !== legitRegistrable) {
          seen.add(key); hits.push({ domain, brand: brand.name, technique: 'character-substitution', legitimateDomain: legit }); break
        }
        if (tld === legitParts[legitParts.length - 1]) {
          const brandCore = legitParts[0]
          const dist = levenshtein(registrable, legitRegistrable)
          if (dist >= 1 && dist <= 2 && normaliseHomoglyphs(registrable) !== normaliseHomoglyphs(legitRegistrable)) {
            const overlap = [...registrable].filter(c => legitRegistrable.includes(c)).length
            if (overlap / brandCore.length >= 0.6) {
              seen.add(key); hits.push({ domain, brand: brand.name, technique: 'typosquatting', legitimateDomain: legit }); break
            }
          }
        }
      }
    }
  }
  return hits
}

// ── Cached system prompt — static rules that never change ─────────────────────
// This block is sent as the system prompt with cache_control: ephemeral.
// Anthropic caches it for 5 minutes (refreshed on each hit).
// At 300 scans/user/month this saves ~40% on input token costs.
const STATIC_SYSTEM_PROMPT = `You are a cybersecurity educator helping everyday office workers identify email threats. Analyze the email data provided and respond ONLY with a JSON object — no markdown, no text outside the JSON.

VERDICT DEFINITIONS — apply these strictly:
- SAFE: Legitimate email with no red flags. Internal comms, expected system notifications, known business contacts.
- SPAM: Unsolicited commercial or marketing email. No credential theft or malware risk — just unwanted. Use SPAM (not SUSPICIOUS) for these.
- SUSPICIOUS: Something feels off but not clearly malicious. Unexpected requests, odd sender, minor red flags.
- PHISHING: Actively trying to steal credentials, install malware, or trick the user into a harmful action.

KEY RULES:
1. NEVER give any email a free pass based on sender domain alone — even internal senders can be compromised.
2. Only flag as external if the domain comparison confirms it OR Outlook shows the warning.
3. Well-known domains (microsoft.com etc) — don't flag the domain itself, but DO flag suspicious content, urgency, credential requests.
4. Analyze content and intent independently of sender.
5. If email involves adding users, granting access, payments, credential changes, or urgent action — suggested_action MUST include: "Verify this request through official channels other than email before taking action."
6. If email contains a login link, verification code, OTP, security alert, or account notification — suggested_action MUST include: "If you did not request this, do not click any links and report this to your IT security team immediately."
7. If email contains a verification or security code — suggested_action MUST include: "Never share this code with anyone — legitimate services will never ask you for it."
8. HEADER RULES:
   a. If Reply-To domain differs from sender domain: flag as suspicious finding.
   b. If display name mismatch is confirmed: MUST set verdict to at least SUSPICIOUS and MUST include a finding.
   c. If "Sent on behalf of" is present: note it, only flag if inconsistent with content.
   d. If "Sent via" is an unknown relay: note it; known ESPs are normal for marketing.
9. LOOKALIKE DOMAIN RULE: Any domain flagged as LOOKALIKE ALERT MUST be included as a finding. Set verdict to at least SUSPICIOUS.
10. GIFT CARD RULE: Any request to purchase or send gift cards MUST be flagged as PHISHING with phishing_score 99. Always fraud.

ENVIRONMENT RULES:
- This org uses Trend Micro and Microsoft SafeLinks. ALL links route through safelinks.protection.outlook.com or Trend Micro URL filters. Do NOT flag these wrappers — links are already decoded.
- Known trusted vendors: sharegate.com, sharegate-software.com (SharePoint migration tool). Emails from Sharegate are expected and legitimate.
- If sender is "(No sender found)" this is a known Outlook web rendering limitation — NOT a red flag. Do not mention it.
- Do not flag the absence of a visible sender email address as suspicious if the email content is otherwise legitimate.
- OTPs, verification codes, magic links, or JWT-like strings may be masked or truncated by the Outlook web client.

MICROSOFT SYSTEM EMAILS:
- Known Microsoft automated senders (powerautomatenoreply@microsoft.com, sharepoint notifications, Teams, Azure alerts etc.) are legitimate. The "external organization" warning from Outlook is EXPECTED and NORMAL for these. Do NOT flag it.
- SafeLinks URLs pointing to make.powerautomate.com, portal.azure.com, admin.microsoft.com, sharepoint.com, teams.microsoft.com are LEGITIMATE.

TRUSTED SAAS EMAILS:
- Known SaaS providers (GitHub, Slack, Zoom, DocuSign, Dropbox, Salesforce, HubSpot, Okta, Duo, 1Password, LastPass, Atlassian) send from their own servers. The Outlook "external" warning is EXPECTED. Their own link domains are LEGITIMATE.
- Sign-in alerts, new device notifications, and account activity summaries from these providers are routine — lean toward SAFE if content matches normal notification patterns.

LINK ANALYSIS RULES:
1. Do NOT flag safelinks.protection.outlook.com or urldefense.com — already decoded.
2. Flag display text showing one domain but real destination is completely different.
3. Any link marked LOOKALIKE ALERT has been algorithmically verified — treat as confirmed and MUST flag as a finding.
4. Flag URL shorteners (bit.ly, tinyurl, t.co).
5. For lookalike domains: explain the deception technique in plain English.

EDUCATION FOCUS — CRITICAL:
Write all findings for a non-technical audience. No jargon. For each red flag:
- Explain what the attacker is doing and WHY it fools people
- Explain exactly how the user can spot this themselves next time
- Use plain conversational language
- If there are NO red flags, return an empty findings array — do not invent issues

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

// ── Dynamic user message — per-email context ──────────────────────────────────
function buildUserMessage(e: EmailData, customPrompt: string, tenantDomain: string): string {
  const now = new Date()
  const utcString = now.toUTCString()
  const tz = e.clientTimezone || "America/Edmonton"
  let localString = ""
  try { localString = now.toLocaleString("en-US", { timeZone: tz, timeZoneName: "short" }) }
  catch { localString = now.toLocaleString("en-US", { timeZone: "America/Edmonton", timeZoneName: "short" }) }

  const orgContext = tenantDomain
    ? `Recipient organization primary domain: ${tenantDomain}`
    : `Recipient organization domain: not configured — infer internal vs external from email content and Outlook indicators only.`

  const sharePointLine = tenantDomain
    ? `SharePoint/OneDrive links from ${tenantDomain} or *.sharepoint.com are typically INTERNAL — do not flag without other red flags.`
    : `SharePoint/OneDrive/Microsoft 365 links may be internal collaboration — do not flag without other red flags.`

  const customLine = customPrompt ? `Additional instructions: ${customPrompt}` : ""

  const attachmentList = e.attachments?.length > 0
    ? e.attachments.map(n => {
        const isDouble = (e.doubleExtFiles || []).includes(n)
        const isHigh = (e.highRiskFiles || []).includes(n)
        const isSusp = (e.suspiciousFiles || []).includes(n)
        const tag = isDouble ? ' [DOUBLE-EXTENSION — disguised as safe file]'
          : isHigh ? ' [HIGH RISK]' : isSusp ? ' [SUSPICIOUS]' : ''
        return n + tag
      }).join(", ")
    : "(none)"

  const doubleExtList = (e.doubleExtFiles || []).join(", ")
  let attachmentWarning = ""
  if (e.hasHighRiskAttachment) {
    const reason = doubleExtList ? `Includes double-extension file(s): ${doubleExtList}. ` : ""
    attachmentWarning = `CRITICAL: HIGH RISK attachment(s) detected: ${e.highRiskFiles.join(", ")}. ${reason}You MUST set verdict to PHISHING, phishing_score >= 90, and suggested_action MUST include: Do NOT open this attachment. Report this email to your IT security team immediately.`
  } else if (e.hasSuspiciousAttachment) {
    attachmentWarning = `WARNING: SUSPICIOUS attachment(s) detected: ${e.suspiciousFiles.join(", ")}. Set phishing_score >= 60 and suggested_action MUST include: Do not open this attachment unless you are certain of its origin.`
  }
  if (e.hasHighAttachmentCount) {
    attachmentWarning += ` NOTE: Unusually high attachment count (${e.attachmentCount}) — may indicate malware delivery attempt.`
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
          ? ` LOOKALIKE ALERT: impersonates ${hit.brand} (${hit.legitimateDomain}) via ${hit.technique}` : ''
        return ` - Display: "${l.display}" -> Real domain: ${l.href}${mismatchTag}${lookalikeTag}`
      }).join("\n")
    : " (No links found)"

  const senderDomainClassification = classifySenderDomain(e.sender, tenantDomain)
  const senderDomain = extractSenderDomain(e.sender)

  let externalNote: string
  if (senderDomainClassification === 'internal') {
    externalNote = `NO - sender domain "${senderDomain}" matches org domain "${tenantDomain}". Treat as INTERNAL.`
  } else if (senderDomainClassification === 'external') {
    externalNote = `YES - sender domain "${senderDomain}" does NOT match org domain "${tenantDomain}". EXTERNAL sender.`
  } else if (e.isOutlookExternal) {
    externalNote = "YES - Outlook has confirmed this is from an external organization."
  } else {
    externalNote = "UNKNOWN - no org domain configured and Outlook has not flagged this as external."
  }

  const microsoftTrustNote = isTrustedMicrosoftSender(e.sender)
    ? `TRUSTED MICROSOFT SYSTEM EMAIL: Sender "${e.sender}" is a known Microsoft automated service. The Outlook "external" warning is EXPECTED. Microsoft service links are LEGITIMATE. Only flag actual red flags.`
    : ""

  const saasMatch = getTrustedSaasMatch(e.sender)
  const saasTrustNote = saasMatch
    ? `TRUSTED SAAS EMAIL: Sender "${e.sender}" is a known ${saasMatch.name} notification. Outlook "external" warning is EXPECTED. These link domains are LEGITIMATE for ${saasMatch.name}: ${saasMatch.linkDomains.join(", ")}. Only flag actual red flags.`
    : ""

  const headerLines: string[] = []
  if (e.displayName && e.senderEmail) headerLines.push(`Sender display name: "${e.displayName}" | Actual email: ${e.senderEmail}`)
  if (e.displayNameMismatch) headerLines.push(`DISPLAY NAME MISMATCH: Display name implies a well-known brand but sending email is from a different domain. Classic phishing technique. MUST flag as a finding.`)
  if (e.replyTo) {
    const rtDiffers = e.senderEmail && e.replyTo.toLowerCase() !== e.senderEmail.toLowerCase()
    const rtDomain = e.replyTo.includes('@') ? e.replyTo.split('@')[1] : ''
    const senderDomainForRT = e.senderEmail?.split('@')[1] ?? ''
    const rtDomainMismatch = rtDomain && senderDomainForRT && rtDomain !== senderDomainForRT
    if (rtDiffers && rtDomainMismatch) {
      headerLines.push(`Reply-To MISMATCH: Replies go to "${e.replyTo}" on a DIFFERENT DOMAIN than sender (${senderDomainForRT}). Common phishing technique. MUST flag as a finding.`)
    } else if (rtDiffers) {
      headerLines.push(`Reply-To differs from sender: "${e.replyTo}"`)
    } else {
      headerLines.push(`Reply-To: ${e.replyTo} (matches sender — normal)`)
    }
  }
  if (e.onBehalfOf) headerLines.push(`Sent on behalf of: "${e.onBehalfOf}" — verify this delegation is expected.`)
  if (e.viaHeader) {
    const KNOWN_ESP = ['mailchimp','sendgrid','constantcontact','hubspot','klaviyo','salesforce','marketo','campaignmonitor','exacttarget','aweber','mailgun','postmark','sparkpost']
    const isKnownESP = KNOWN_ESP.some(esp => e.viaHeader!.includes(esp))
    headerLines.push(`Sent via: ${e.viaHeader}${isKnownESP ? ' (known ESP — normal for marketing)' : ' (third-party relay — verify this is expected)'}`)
  }
  if (e.outlookWarnings && e.outlookWarnings.length > 0) {
    headerLines.push(`Outlook surfaced these warnings:`)
    e.outlookWarnings.forEach(w => headerLines.push(`  - "${w}"`))
  }

  const headerSignalsBlock = headerLines.length > 0
    ? `\nHEADER SIGNALS (high-confidence data from Outlook DOM):\n${headerLines.join('\n')}\n`
    : ''

  let lookalikeWarning = ''
  if (lookalikesDetected.length > 0) {
    const hitLines = lookalikesDetected.map(h => `  - ${h.domain} impersonates ${h.brand} (${h.legitimateDomain}) via ${h.technique}`).join('\n')
    lookalikeWarning = `LOOKALIKE DOMAIN ALERT: MUST flag each as a finding. Set verdict >= SUSPICIOUS; if combined with credential requests or urgency, set PHISHING with phishing_score >= 85.\n${hitLines}\n`
  }

  return `Analyze this email. Current date/time: ${utcString} (UTC) / ${localString} (${tz}).
${orgContext}
${sharePointLine}
${customLine}
${microsoftTrustNote}
${saasTrustNote}
${headerSignalsBlock}
Sender: ${e.sender}
Is external sender: ${externalNote}

Subject: ${e.subject}
Body:
${e.body}

Attachments: ${attachmentList}
${attachmentWarning}
${lookalikeWarning}
EMBEDDED LINKS (already decoded from safelinks wrappers):
${linksBlock}`
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req) => {
  const origin = req.headers.get("origin") ?? ""
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : "*"
  const corsHeaders = { ...CORS_HEADERS, "Access-Control-Allow-Origin": allowOrigin }

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, corsHeaders)

  let parsedBody: unknown
  try { parsedBody = await req.json() } catch { return json({ error: "Invalid JSON" }, 400, corsHeaders) }

  const headerToken = req.headers.get("x-extension-token") ?? ""
  const raw = parsedBody as Record<string, unknown>
  const bodyToken = (typeof raw?.oeAuth === "string" ? raw.oeAuth : "") || (typeof raw?.token === "string" ? raw.token : "")
  const token = headerToken || bodyToken
  if (!token) return json({ error: "Unauthorized" }, 401, corsHeaders)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const auth = await checkExtensionToken(supabase, token, LEGACY_EXTENSION_TOKEN)
  if (!auth.ok) {
    const err = auth.reason === "expired" ? "License expired — request a new key from your administrator." : "Unauthorized"
    return json({ error: err }, 401, corsHeaders)
  }

  if (parsedBody !== null && typeof parsedBody === "object" && !Array.isArray(parsedBody) && (parsedBody as { ping?: boolean }).ping === true) {
    return json({ ok: true }, 200, corsHeaders)
  }

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const tokenKey = await hashToken(token)
  const now = Date.now()
  const windowStart = new Date(now - RATE_LIMIT_WINDOW_MS).toISOString()
  const { count } = await supabase.from("rate_limit_log").select("*", { count: "exact", head: true }).eq("token_key", tokenKey).gte("created_at", windowStart)
  if (count && count >= 1) return json({ error: "Rate limit: please wait 5 seconds between analyses." }, 429, { ...corsHeaders, "Retry-After": "5" })
  await supabase.from("rate_limit_log").insert({ token_key: tokenKey, created_at: new Date(now).toISOString() })

  // ── Parse request ─────────────────────────────────────────────────────────
  let emailData: EmailData
  let customPrompt: string
  let tenantDomain: string
  try {
    const body = parsedBody as { emailData?: EmailData; customPrompt?: string; tenantDomain?: string }
    emailData = body.emailData!
    customPrompt = typeof body.customPrompt === "string" ? body.customPrompt : ""
    tenantDomain = sanitizeTenantDomain(body.tenantDomain)
    if (!emailData || typeof emailData.subject !== "string" || typeof emailData.body !== "string") throw new Error("missing emailData")
    emailData.body = emailData.body.slice(0, MAX_BODY_LENGTH)
    emailData.subject = emailData.subject.slice(0, 300)
    emailData.sender = (emailData.sender || "(No sender found)").slice(0, 300)
    emailData.recipient = typeof emailData.recipient === "string" ? emailData.recipient.slice(0, MAX_LOG_ADDRESS_LEN) : "(No recipient found)"
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

  // ── Gift card fast path (no AI needed) ───────────────────────────────────
  if (checkForGiftCardFraud(emailData.subject, emailData.body)) {
    logScanEnvelope("scan_gift_card_rule", emailData)
    supabase.from("scan_log").insert({
      token_key: tokenKey, verdict: "PHISHING", phishing_score: 99, spam_score: 10, response_time_ms: null,
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

  const userMessage = buildUserMessage(emailData, customPrompt, tenantDomain)
  const lookalikesDetected = detectLookalikeDomains(emailData.links || [])

  try {
    const t0 = Date.now()

    // ── Anthropic API call with prompt caching ────────────────────────────
    // STATIC_SYSTEM_PROMPT is sent as system with cache_control: ephemeral.
    // Anthropic caches this block — 90% cost reduction on cache hits.
    // Only the per-email user message (unique each call) is billed at full rate.
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        system: [
          {
            type: "text",
            text: STATIC_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },  // Cache the static rules — 90% off on subsequent calls
          }
        ],
        messages: [{ role: "user", content: userMessage }],
      }),
    })
    const responseTimeMs = Date.now() - t0

    if (!anthropicRes.ok) {
      const err = await anthropicRes.json()
      return json({ error: `Anthropic error ${anthropicRes.status}: ${err.error?.message ?? JSON.stringify(err)}` }, 502, corsHeaders)
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

    return json({ result: {
      ...parsed,
      lookalikeDomains: lookalikesDetected.map(h => ({
        domain: h.domain, brand: h.brand, technique: h.technique, legitimateDomain: h.legitimateDomain,
      })),
    }}, 200, corsHeaders)

  } catch (err) {
    return json({ error: `Upstream fetch failed: ${(err as Error).message}` }, 502, corsHeaders)
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────
function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } })
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
