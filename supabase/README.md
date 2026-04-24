# Supabase

This repo targets **one** hosted project: **Spammyspammerson** (`pikplhvawbhndijpkdbq`). CLI link commands and MCP below assume that ref.

This folder configures that project and the Edge Functions: **`analyze-email`**, **`report-feedback`**, and **`admin-console`**. Edge Function source is **Deno** (TypeScript); installing **[Deno](https://deno.land/)** locally is optional but improves editor support. The repo includes **`.vscode/settings.json`** so the Deno extension only activates under **`supabase/functions`**.

**401 “Unauthorized” from the proxy URL (extension token is correct):** Supabase’s gateway can enforce JWT on functions (`verify_jwt`). The Chrome extension only sends `x-extension-token`, not `Authorization: Bearer …`. This repo sets **`verify_jwt = false`** for both functions in `config.toml` so the request reaches your code; auth is still enforced via `EXTENSION_TOKEN` inside the function.

**Customers:** Table **`public.customers`** stores one row per signup (email + company, tied to **`organizations`**). **`extension_tokens.customer_id`** links each product key to that customer (nullable for keys issued only from the admin UI before this existed). Unique per **`(org_id, email)`** so the Streamlit portal does not duplicate the same person in one org.

## Connect to your hosted project

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli).
2. Log in: `npx supabase login` (or `supabase login` if the CLI is on your PATH)
3. Link this repo to your project (get the project ref from the Supabase dashboard URL):

   ```bash
   npx supabase link --project-ref pikplhvawbhndijpkdbq
   ```

4. Apply database migrations to the remote database (from the repo root; use **`npx`** if the Supabase CLI is not on your PATH):

   ```bash
   npx supabase db push
   ```

   If the CLI reports **out-of-order** or **missing** remote history, use **`npx supabase db push --include-all`** once, or run **`npx supabase migration repair`** as suggested in the error. After changing migration filenames, teammates should **pull** before pushing.

5. Set Edge Function secrets in the dashboard (**Project Settings → Edge Functions → Secrets**) or via CLI:

   - `ANTHROPIC_API_KEY`
   - `EXTENSION_TOKEN` *(optional legacy)* — if set, that string still works as a shared client secret. Prefer per-client tokens from **admin-console** (below).
   - `ADMIN_SECRET` — long random string; required to **create/list/revoke** client tokens in the admin UI (not used by the Chrome extension).
   - `SUPABASE_URL` (usually auto-provided; confirm in dashboard)
   - `SUPABASE_SERVICE_ROLE_KEY` (service role — never expose to the extension)

6. Apply migrations and deploy functions:

   ```bash
   npx supabase db push
   npm run deploy:functions
   ```

   This deploys `analyze-email`, `report-feedback`, and **`admin-console`**.

## Admin console — issue & revoke extension tokens (product keys)

Tokens are rows in **`extension_tokens`** (hash only in the database). They can be tied to **`organizations`** via **`org_id`** for the dashboard. Optional columns include **`license_type`** (`trial` | `annual`) and **`expires_at`**: **trial** keys expire **15 days** after issue, **annual** keys **365 days** (enforced in **`analyze-email`** / **`report-feedback`**). Rows with **`expires_at` null** behave as **unexpired legacy** keys.

### Option A — Web dashboard (`admin-console.html`)

Best for operators who want charts, org-scoped lists, and **Trial / Annual** when creating keys.

1. From the **repository root**: **`npm run admin:ui`** then open **`http://localhost:8765/admin-console.html`** (fully restart the editor after first install if the tab won’t load — the static server must be running).
2. Sign in with:
   - **Supabase project URL** — e.g. `https://<project-ref>.supabase.co`
   - **Service role key** — **Project Settings → API** (never share with end users or put in the extension)
   - **Organization ID** — UUID from **`select id, name from public.organizations`**
3. Use **Issue new company key**, choose **Trial** or **Annual**, copy the plaintext token once for the customer. They paste it in the extension **Connection → Extension Token**.

### Option B — `admin-console` Edge Function (HTTP API)

The URL **`https://<project-ref>.supabase.co/functions/v1/admin-console`** is a **JSON API** only (Supabase’s gateway does not reliably render HTML here). Authenticate with **`Authorization: Bearer <ADMIN_SECRET>`** (or header **`x-admin-secret`**) and POST JSON, e.g. `{ "action": "list" }`, `{ "action": "create", "label": "Acme", "license": "trial" | "annual" }`, `{ "action": "revoke", "id": "<uuid>" }`, `{ "action": "revoke_all" }`.

Use **`curl`**, a script, or any API client — not the browser address bar.

**Revoke** does not change the optional legacy **`EXTENSION_TOKEN`** env secret — rotate that separately in the dashboard if you still use a single shared secret.

**Code deploys** (updating Edge Function source) use **`npm run deploy:functions`** from this repo, not the admin UI.

## Edge Functions from Cursor (agent deploy)

The AI assistant can **edit** files under `supabase/functions/` in this repo. To **publish** those changes to hosted Supabase:

1. Install and log in: [Supabase CLI](https://supabase.com/docs/guides/cli), then `npx supabase login`.
2. Link this repo once: `npx supabase link --project-ref pikplhvawbhndijpkdbq`.
3. After edits, deploy using either:
   - **CLI (reliable):** `npm run deploy:analyze-email`, `npm run deploy:report-feedback`, or `npm run deploy:functions`
   - **MCP:** With **Supabase MCP** connected, approve the **`deploy_edge_function`** tool when the agent deploys (uses the Management API; `read_only=true` only affects Postgres SQL, not function deploy).

If MCP deploy is unavailable or fails, use the npm/CLI commands above.

## Local development

```bash
npx supabase start
npx supabase db reset
```

Local URLs and keys are printed when `supabase start` finishes. Use them only for local testing.

## Cursor MCP (AI assistant)

MCP is scoped to **Spammyspammerson** only (`project_ref=pikplhvawbhndijpkdbq` in the URL) so the agent does not touch other Supabase projects in your account.

1. Copy `supabase/cursor-mcp.example.json` to **`.cursor/mcp.json`** at the repo root (gitignored). It sets **`read_only=true`** for Postgres SQL; Edge Function tools still work—approve `deploy_edge_function` when prompted.
2. Restart Cursor fully.
3. **Cursor Settings → Tools & MCP** — connect **supabase** (browser OAuth the first time). Disable any **duplicate** global Supabase MCP entry if you see two servers.
4. See [Supabase MCP](https://supabase.com/docs/guides/getting-started/mcp) security notes.

You can also start from the dashboard **Connect → MCP** tab and paste the generated URL into `mcp.json` if you prefer.

For CI or clients without OAuth, see [manual authentication](https://supabase.com/docs/guides/getting-started/mcp#manual-authentication) (personal access token in `headers`).
