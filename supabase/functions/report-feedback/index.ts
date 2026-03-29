import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const EXTENSION_TOKEN      = Deno.env.get("EXTENSION_TOKEN")!
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!
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

const VALID_TYPES = ["false_positive", "missed_threat"]

const MAX_VERDICT_LEN = 64
const FEEDBACK_RATE_WINDOW_MS = 60_000
const FEEDBACK_RATE_MAX = 10

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

  const token = req.headers.get("x-extension-token") ?? ""
  if (!token || token !== EXTENSION_TOKEN) {
    return json({ error: "Unauthorized" }, 401, corsHeaders)
  }

  let feedbackType: string
  let originalVerdict: string
  let originalPhishingScore: number | null
  let originalSpamScore: number | null
  let emailSubject: string | null
  let emailSender: string | null
  let emailRecipient: string | null
  let userComment: string | null

  try {
    const body = await req.json()
    feedbackType = body.feedbackType
    originalVerdict = typeof body.originalVerdict === "string"
      ? body.originalVerdict.slice(0, MAX_VERDICT_LEN)
      : ""
    originalPhishingScore = parseScore(body.originalPhishingScore)
    originalSpamScore = parseScore(body.originalSpamScore)
    emailSubject = (body.emailSubject || "").slice(0, 300) || null
    emailSender = (body.emailSender || "").slice(0, 300) || null
    emailRecipient = (body.emailRecipient || "").slice(0, 300) || null
    userComment = (body.userComment || "").slice(0, 1000) || null

    if (!VALID_TYPES.includes(feedbackType)) {
      throw new Error("invalid feedbackType")
    }
    if (!originalVerdict) {
      throw new Error("missing originalVerdict")
    }
  } catch {
    return json({ error: "Invalid request body" }, 400, corsHeaders)
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const tokenKey = await hashToken(token)
    const now = Date.now()
    const feedbackWindowStart = new Date(now - FEEDBACK_RATE_WINDOW_MS).toISOString()

    const { count: feedbackCount } = await supabase
      .from("user_feedback")
      .select("*", { count: "exact", head: true })
      .eq("token_key", tokenKey)
      .gte("created_at", feedbackWindowStart)

    if (feedbackCount !== null && feedbackCount >= FEEDBACK_RATE_MAX) {
      return json(
        { error: "Too many feedback reports. Please wait a minute and try again." },
        429,
        { ...corsHeaders, "Retry-After": "60" }
      )
    }

    const { error } = await supabase.from("user_feedback").insert({
      token_key: tokenKey,
      feedback_type: feedbackType,
      original_verdict: originalVerdict,
      original_phishing_score: originalPhishingScore,
      original_spam_score: originalSpamScore,
      email_subject: emailSubject,
      email_sender: emailSender,
      email_recipient: emailRecipient,
      user_comment: userComment,
    })

    if (error) {
      return json({ error: "Failed to save feedback" }, 500, corsHeaders)
    }

    return json({ success: true }, 200, corsHeaders)
  } catch {
    return json({ error: "Server error" }, 500, corsHeaders)
  }
})

function parseScore(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" ? v : Number.parseInt(String(v), 10)
  if (!Number.isFinite(n)) return null
  const x = Math.round(n)
  if (x < 0 || x > 100) return null
  return x
}

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
