import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!
const EXTENSION_TOKEN   = Deno.env.get("EXTENSION_TOKEN")!
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

function classifyAttachments(attachments: string[]): { highRisk: string[], suspicious: string[], hasHighRisk: boolean, hasSuspicious: boolean } {
  const names = (attachments || []).map(a => a.toLowerCase())
  const highRisk = names.filter(n => HIGH_RISK_EXTENSIONS.some(e => n.endsWith(e)))
  const suspicious = names.filter(n => !highRisk.includes(n) && SUSPICIOUS_EXTENSIONS.some(e => n.endsWith(e)))
  return { highRisk, suspicious, hasHighRisk: highRisk.length > 0, hasSuspicious: suspicious.length > 0 }
}

const RATE_LIMIT_WINDOW_MS = 5000
const MAX_BODY_LENGTH = 3000
const MAX_TENANT_DOMAIN_LEN = 253

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
  senderHasEmail: boolean
  body: string
  links: EmailLink[]
  attachments: string[]
  hasHighRiskAttachment: boolean
  hasSuspiciousAttachment: boolean
  highRiskFiles: string[]
  suspiciousFiles: string[]
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

  const attachmentList = e.attachments?.length > 0 ? e.attachments.join(", ") : "(none)"

  let attachmentWarning = ""
  if (e.hasHighRiskAttachment) {
    attachmentWarning = `CRITICAL: HIGH RISK attachment(s) detected: ${e.highRiskFiles.join(", ")}. You MUST set verdict to PHISHING, phishing_score to at least 90, and suggested_action MUST include: Do NOT open this attachment. Report this email to your IT security team immediately.`
  } else if (e.hasSuspiciousAttachment) {
    attachmentWarning = `WARNING: SUSPICIOUS attachment(s) detected: ${e.suspiciousFiles.join(", ")}. Set phishing_score to at least 60 and suggested_action MUST include: Do not open this attachment unless you are certain of its origin.`
  }

  const linksBlock = e.links?.length > 0
    ? e.links.map(l => ` - Display: "${l.display}" -> Real domain: ${l.href}${l.mismatch ? " WARNING: DOMAIN MISMATCH" : ""}`).join("\n")
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

  return `You are a cybersecurity educator helping everyday office workers learn to identify email threats. Analyze the email below and respond ONLY with a JSON object - no markdown, no text outside the JSON.

IMPORTANT CONTEXT:
- Current date/time: ${utcString} (UTC) / ${localString} (${tz}). Do not flag dates as suspicious if they fall within the current day across timezones.
- ${orgContext}
- Sender: ${e.sender}
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

KEY RULES:
1. NEVER give any email a free pass based on sender domain alone - even internal senders can be compromised.
2. Only flag as external if the domain comparison above confirms it OR Outlook shows the warning.
3. Well-known domains (microsoft.com etc) - don't flag the domain itself, but DO flag suspicious content, urgency, credential requests.
4. Analyze content and intent independently of sender.
5. If email involves adding users, granting access, payments, credential changes, or urgent action - suggested_action MUST include: "Verify this request through official channels other than email before taking action."
6. If email contains a login link, verification code, OTP, security alert, or account notification - suggested_action MUST include: "If you did not request this, do not click any links and report this to your IT security team immediately."
7. If email contains a verification or security code - suggested_action MUST include: "Never share this code with anyone - legitimate services will never ask you for it."
8. GIFT CARD RULE: Any request to purchase or send gift cards of any kind (iTunes, Google Play, Amazon, Visa, Steam, etc.) MUST be flagged as PHISHING with phishing_score of 99. No legitimate business ever requests gift card payments. This is always fraud.

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

EMBEDDED LINKS (already decoded from safelinks wrappers):
${linksBlock}

When analyzing links:
1. Do NOT flag safelinks.protection.outlook.com or urldefense.com - already decoded above
2. Flag display text showing one domain but real destination is completely different
3. Flag suspicious TLDs or domains impersonating known brands
4. Flag URL shorteners (bit.ly, tinyurl, t.co)

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
  const bodyToken = (parsedBody as Record<string, unknown>)?.token as string ?? ""
  const token = headerToken || bodyToken
  if (!token || token !== EXTENSION_TOKEN) {
    return json({ error: "Unauthorized" }, 401, corsHeaders)
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
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
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
    emailData.links = (emailData.links || []).slice(0, 20)
    emailData.attachments = (emailData.attachments || []).slice(0, 20)

    const attach = classifyAttachments(emailData.attachments)
    emailData.hasHighRiskAttachment = attach.hasHighRisk
    emailData.hasSuspiciousAttachment = attach.hasSuspicious
    emailData.highRiskFiles = attach.highRisk
    emailData.suspiciousFiles = attach.suspicious
  } catch {
    return json({ error: "Invalid request body" }, 400, corsHeaders)
  }

  if (checkForGiftCardFraud(emailData.subject, emailData.body)) {
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

    supabase.from("scan_log").insert({
      token_key: tokenKey,
      verdict: parsed.verdict ?? "UNKNOWN",
      phishing_score: parsed.phishing_score ?? null,
      spam_score: parsed.spam_score ?? null,
      response_time_ms: responseTimeMs,
    }).then(() => {})

    return json({ result: parsed }, 200, corsHeaders)

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

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("")
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
