# Supabase

This repo targets **one** hosted project: **Spammyspammerson** (`pikplhvawbhndijpkdbq`). CLI link commands and MCP below assume that ref.

This folder configures that project and the `analyze-email` / `report-feedback` Edge Functions.

**401 “Unauthorized” from the proxy URL (extension token is correct):** Supabase’s gateway can enforce JWT on functions (`verify_jwt`). The Chrome extension only sends `x-extension-token`, not `Authorization: Bearer …`. This repo sets **`verify_jwt = false`** for both functions in `config.toml` so the request reaches your code; auth is still enforced via `EXTENSION_TOKEN` inside the function.

## Connect to your hosted project

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli).
2. Log in: `supabase login`
3. Link this repo to your project (get the project ref from the Supabase dashboard URL):

   ```bash
   supabase link --project-ref pikplhvawbhndijpkdbq
   ```

4. Apply database migrations to the remote database:

   ```bash
   supabase db push
   ```

5. Set Edge Function secrets in the dashboard (**Project Settings → Edge Functions → Secrets**) or via CLI:

   - `ANTHROPIC_API_KEY`
   - `EXTENSION_TOKEN` *(optional legacy)* — if set, that string still works as a shared client secret. Prefer per-client tokens from **admin-console** (below).
   - `ADMIN_SECRET` — long random string; required to **create/list/revoke** client tokens in the admin UI (not used by the Chrome extension).
   - `SUPABASE_URL` (usually auto-provided; confirm in dashboard)
   - `SUPABASE_SERVICE_ROLE_KEY` (service role — never expose to the extension)

6. Apply migrations and deploy functions:

   ```bash
   supabase db push
   npm run deploy:functions
   ```

   This deploys `analyze-email`, `report-feedback`, and **`admin-console`**.

## Admin console (issue & revoke client access tokens)

The function URL **`https://<project-ref>.supabase.co/functions/v1/admin-console`** is the **API** (POST with `ADMIN_SECRET`). Do not expect it to render as a web page in the browser — use the static UI instead.

1. From the **repository root**, run **`npm run admin:ui`** and open **`http://localhost:8765/admin-console.html`** (or serve the repo folder with any static server). Set **Admin API base URL** to your function URL if needed.
2. Enter **`ADMIN_SECRET`** → **Load tokens**.
3. **Issue token (deploy access)** — creates a new token for a company; copy it once and send it to the client. They paste it into the extension **Connection → Extension Token**.
4. **Revoke access** — per row, or **Revoke all active** (emergency; double confirmation). Extensions using revoked tokens get **401** immediately.

Only **SHA-256 hashes** are stored in `extension_tokens`. **Revoke does not remove** the optional legacy **`EXTENSION_TOKEN`** env secret — change that in the dashboard if you need to rotate the old shared secret.

**Code deploys** (updating Edge Function source) use the CLI from this repo (`npm run deploy:functions`), not the admin page.

## Edge Functions from Cursor (agent deploy)

The AI assistant can **edit** files under `supabase/functions/` in this repo. To **publish** those changes to hosted Supabase:

1. Install and log in: [Supabase CLI](https://supabase.com/docs/guides/cli), then `supabase login`.
2. Link this repo once: `supabase link --project-ref pikplhvawbhndijpkdbq`.
3. After edits, deploy using either:
   - **CLI (reliable):** `npm run deploy:analyze-email`, `npm run deploy:report-feedback`, or `npm run deploy:functions`
   - **MCP:** With **Supabase MCP** connected, approve the **`deploy_edge_function`** tool when the agent deploys (uses the Management API; `read_only=true` only affects Postgres SQL, not function deploy).

If MCP deploy is unavailable or fails, use the npm/CLI commands above.

## Local development

```bash
supabase start
supabase db reset
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
