import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { hashToken } from "../_shared/extension-auth.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET") ?? ""

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-secret",
}

function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...extra },
  })
}

function adminAuth(req: Request): boolean {
  if (!ADMIN_SECRET) return false
  const auth = req.headers.get("Authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : ""
  const header = req.headers.get("x-admin-secret")?.trim() ?? ""
  return bearer === ADMIN_SECRET || header === ADMIN_SECRET
}

function genToken(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
}

/** Supabase’s gateway often serves function responses as text/plain; browsers won’t render HTML from this URL. */
function getInstructionsText(req: Request): string {
  const u = new URL(req.url)
  const api = `${u.origin}${u.pathname}`
  return [
    "Outlook Email Evaluator — Admin API",
    "",
    "This URL is the JSON API only. Supabase Edge Functions are not reliable for serving HTML in the browser (you may see raw markup or plain text).",
    "",
    "Use the static admin UI from this repo:",
    "  1. From the repository root:  npm run admin:ui",
    "  2. Open in your browser:       http://localhost:8765/admin-console.html",
    "",
    "Paste this as the page’s “Admin API base URL” if it differs from the default:",
    `  ${api}`,
    "",
    "POST with Authorization: Bearer <ADMIN_SECRET> and JSON body:",
    "  { action: list | revoke | revoke_all }",
    "  { action: create, label?: string, license?: \"trial\" | \"annual\" } — trial = 15 days, annual = 365 days (default trial).",
  ].join("\n")
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (req.method === "GET") {
    return new Response(getInstructionsText(req), {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS },
    })
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405)
  }

  if (!adminAuth(req)) {
    return json({ error: "Unauthorized" }, 401)
  }

  let body: {
    action?: string
    label?: string | null
    id?: string
    /** trial = 15 days, annual = 365 days from issue. Omit = trial (new keys expire). */
    license?: "trial" | "annual"
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: "Invalid JSON" }, 400)
  }

  function expiresAtForLicense(license: "trial" | "annual"): string {
    const d = new Date()
    if (license === "annual") {
      d.setDate(d.getDate() + 365)
    } else {
      d.setDate(d.getDate() + 15)
    }
    return d.toISOString()
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const action = body.action

  if (action === "list") {
    const { data, error } = await supabase
      .from("extension_tokens")
      .select("id, label, created_at, revoked_at, license_type, expires_at")
      .order("created_at", { ascending: false })

    if (error) return json({ error: error.message }, 500)
    return json({ tokens: data ?? [] })
  }

  if (action === "create") {
    const plain = genToken()
    const token_hash = await hashToken(plain)
    const label = typeof body.label === "string" ? body.label.slice(0, 200) : null
    const license: "trial" | "annual" = body.license === "annual" ? "annual" : "trial"
    const expires_at = expiresAtForLicense(license)
    const { data, error } = await supabase
      .from("extension_tokens")
      .insert({ token_hash, label, license_type: license, expires_at })
      .select("id")
      .single()

    if (error) return json({ error: error.message }, 500)
    return json({
      token: plain,
      id: data?.id,
      label,
      license_type: license,
      expires_at,
    })
  }

  if (action === "revoke") {
    const id = typeof body.id === "string" ? body.id : ""
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return json({ error: "Invalid id" }, 400)
    }
    const { error } = await supabase
      .from("extension_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .is("revoked_at", null)

    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  }

  if (action === "revoke_all") {
    const { data, error } = await supabase
      .from("extension_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .is("revoked_at", null)
      .select("id")

    if (error) return json({ error: error.message }, 500)
    return json({ ok: true, revoked_count: data?.length ?? 0 })
  }

  return json({ error: "Unknown action" }, 400)
})
