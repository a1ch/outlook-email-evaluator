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

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Email Evaluator — Client tokens</title>
  <style>
    :root { --bg:#0f1419; --card:#1a2332; --text:#e7ecf3; --muted:#8b9cb3; --accent:#3b82f6; --danger:#ef4444; --ok:#22c55e; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 24px; line-height: 1.5; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 8px; }
    p.sub { color: var(--muted); font-size: 0.875rem; margin: 0 0 24px; }
    .card { background: var(--card); border-radius: 10px; padding: 20px; max-width: 720px; margin-bottom: 20px; border: 1px solid #2a3544; }
    label { display: block; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 6px; }
    input[type="password"], input[type="text"] { width: 100%; padding: 10px 12px; border-radius: 6px; border: 1px solid #3d4f66; background: #0f1419; color: var(--text); font-size: 14px; }
    button { background: var(--accent); color: white; border: none; padding: 10px 18px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 14px; }
    button:hover { filter: brightness(1.08); }
    button.danger { background: var(--danger); }
    button.secondary { background: #334155; }
    .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; margin-top: 12px; }
    .once { background: #14532d; border: 1px solid var(--ok); padding: 12px; border-radius: 8px; font-family: ui-monospace, monospace; word-break: break-all; font-size: 13px; margin-top: 12px; display: none; }
    .once.show { display: block; }
    .err { color: #fca5a5; font-size: 14px; margin-top: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #2a3544; }
    th { color: var(--muted); font-weight: 600; }
    .badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; }
    .badge.on { background: #14532d; color: #86efac; }
    .badge.off { background: #450a0a; color: #fca5a5; }
  </style>
</head>
<body>
  <h1>Client extension tokens</h1>
  <p class="sub">Create tokens for new Chrome extension installs. Copy the value once — it is not stored in plain text.</p>

  <div class="card">
    <label for="secret">Admin secret</label>
    <input type="password" id="secret" placeholder="Same as ADMIN_SECRET in Supabase Edge Function secrets" autocomplete="off" />
    <div class="row">
      <button type="button" id="btnList">Load tokens</button>
    </div>
    <p class="err" id="err"></p>
  </div>

  <div class="card">
    <label for="label">Label (client / org)</label>
    <input type="text" id="label" placeholder="e.g. Contoso — pilot batch 2" maxlength="200" />
    <div class="row">
      <button type="button" id="btnCreate">Create new token</button>
    </div>
    <div class="once" id="once"></div>
  </div>

  <div class="card">
    <strong>Active &amp; revoked tokens</strong>
    <div style="overflow-x:auto;margin-top:12px;">
      <table>
        <thead><tr><th>Label</th><th>Created</th><th>Status</th><th></th></tr></thead>
        <tbody id="rows"><tr><td colspan="4" style="color:var(--muted)">Click “Load tokens”</td></tr></tbody>
      </table>
    </div>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);
    const err = $("err");
    const rows = $("rows");
    const once = $("once");

    function authHeaders() {
      const s = $("secret").value.trim();
      if (!s) throw new Error("Enter admin secret first.");
      return { "Content-Type": "application/json", "Authorization": "Bearer " + s };
    }

    async function api(body) {
      err.textContent = "";
      const res = await fetch(location.href.split("?")[0], {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    }

    $("btnList").onclick = async () => {
      try {
        const data = await api({ action: "list" });
        rows.innerHTML = (data.tokens || []).map((t) => {
          const active = !t.revoked_at;
          return "<tr><td>" + escapeHtml(t.label || "—") + "</td><td>" + escapeHtml(t.created_at || "") + "</td><td>" +
            (active ? '<span class="badge on">Active</span>' : '<span class="badge off">Revoked</span>') + "</td><td>" +
            (active ? '<button type="button" class="danger" data-id="' + t.id + '">Revoke</button>' : "") + "</td></tr>";
        }).join("") || '<tr><td colspan="4" style="color:var(--muted)">No tokens yet.</td></tr>';
        rows.querySelectorAll("button[data-id]").forEach((btn) => {
          btn.onclick = async () => {
            if (!confirm("Revoke this token? Clients using it will stop working.")) return;
            try {
              await api({ action: "revoke", id: btn.getAttribute("data-id") });
              $("btnList").click();
            } catch (e) { err.textContent = e.message; }
          };
        });
      } catch (e) { err.textContent = e.message; }
    };

    $("btnCreate").onclick = async () => {
      once.classList.remove("show");
      try {
        const data = await api({ action: "create", label: $("label").value.trim() || null });
        once.textContent = "Give this to the client once (extension Connection → Extension Token):\\n\\n" + data.token;
        once.classList.add("show");
        $("label").value = "";
        $("btnList").click();
      } catch (e) { err.textContent = e.message; }
    };

    function escapeHtml(s) {
      const d = document.createElement("div");
      d.textContent = s;
      return d.innerHTML;
    }
  </script>
</body>
</html>`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (req.method === "GET") {
    return new Response(HTML, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", ...CORS },
    })
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405)
  }

  if (!adminAuth(req)) {
    return json({ error: "Unauthorized" }, 401)
  }

  let body: { action?: string; label?: string | null; id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: "Invalid JSON" }, 400)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const action = body.action

  if (action === "list") {
    const { data, error } = await supabase
      .from("extension_tokens")
      .select("id, label, created_at, revoked_at")
      .order("created_at", { ascending: false })

    if (error) return json({ error: error.message }, 500)
    return json({ tokens: data ?? [] })
  }

  if (action === "create") {
    const plain = genToken()
    const token_hash = await hashToken(plain)
    const label = typeof body.label === "string" ? body.label.slice(0, 200) : null
    const { data, error } = await supabase
      .from("extension_tokens")
      .insert({ token_hash, label })
      .select("id")
      .single()

    if (error) return json({ error: error.message }, 500)
    return json({ token: plain, id: data?.id, label })
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

  return json({ error: "Unknown action" }, 400)
})
