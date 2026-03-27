# Supabase

This folder configures your Supabase project and the `analyze-email` Edge Function.

## Connect to your hosted project

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli).
2. Log in: `supabase login`
3. Link this repo to your project (get the project ref from the Supabase dashboard URL):

   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   ```

4. Apply database migrations to the remote database:

   ```bash
   supabase db push
   ```

5. Set Edge Function secrets in the dashboard (**Project Settings → Edge Functions → Secrets**) or via CLI:

   - `ANTHROPIC_API_KEY`
   - `EXTENSION_TOKEN` (same value users paste into the Chrome extension)
   - `SUPABASE_URL` (usually auto-provided; confirm in dashboard)
   - `SUPABASE_SERVICE_ROLE_KEY` (service role — never expose to the extension)

6. Deploy the function:

   ```bash
   supabase functions deploy analyze-email
   ```

## Local development

```bash
supabase start
supabase db reset
```

Local URLs and keys are printed when `supabase start` finishes. Use them only for local testing.

## Cursor MCP (AI assistant)

Connect Cursor to this Supabase project so the agent can list tables, run read-only SQL, search docs, and similar tasks.

1. In the [Supabase dashboard](https://supabase.com/dashboard), open **Project Settings → General** and copy **Reference ID** (project ref).
2. Edit **`.cursor/mcp.json`** in this repo and replace `REPLACE_WITH_PROJECT_REF` with that ID.
   - Optional: use Cursor [config interpolation](https://cursor.com/docs/context/mcp) instead, for example  
     `"url": "https://mcp.supabase.com/mcp?project_ref=${env:SUPABASE_PROJECT_REF}&read_only=true"`  
     and set a Windows user environment variable `SUPABASE_PROJECT_REF` to your ref.
3. Restart Cursor.
4. Open **Cursor Settings → Tools & MCP** and ensure the **supabase** server is enabled. The first connection may open a browser to sign in to Supabase (OAuth).
5. Prefer a **dev** project, not production. This config uses **`read_only=true`** per [Supabase MCP](https://supabase.com/docs/guides/getting-started/mcp) recommendations.

You can also start from the dashboard **Connect → MCP** tab and paste the generated URL into `mcp.json` if you prefer.

For CI or clients without OAuth, see [manual authentication](https://supabase.com/docs/guides/getting-started/mcp#manual-authentication) (personal access token in `headers`).
