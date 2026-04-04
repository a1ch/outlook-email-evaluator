import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

export type ExtensionTokenAuthFailure = "missing" | "invalid" | "expired"

/** Legacy env secret, or an active non-expired row in extension_tokens. */
export async function checkExtensionToken(
  supabase: SupabaseClient,
  token: string,
  legacyEnvToken: string | undefined,
): Promise<{ ok: true } | { ok: false; reason: ExtensionTokenAuthFailure }> {
  if (!token) return { ok: false, reason: "missing" }
  const legacy = legacyEnvToken?.trim()
  if (legacy && token === legacy) return { ok: true }
  const h = await hashToken(token)
  const { data } = await supabase
    .from("extension_tokens")
    .select("id, expires_at")
    .eq("token_hash", h)
    .is("revoked_at", null)
    .maybeSingle()
  if (!data) return { ok: false, reason: "invalid" }
  if (data.expires_at) {
    const t = new Date(data.expires_at as string).getTime()
    if (!Number.isFinite(t) || Date.now() >= t) return { ok: false, reason: "expired" }
  }
  return { ok: true }
}

/** Legacy single secret (EXTENSION_TOKEN) or an active row in extension_tokens. */
export async function isExtensionTokenAllowed(
  supabase: SupabaseClient,
  token: string,
  legacyEnvToken: string | undefined,
): Promise<boolean> {
  const r = await checkExtensionToken(supabase, token, legacyEnvToken)
  return r.ok
}
