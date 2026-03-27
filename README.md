# Outlook Email Evaluator

A Chrome extension (Manifest V3) that analyzes open messages in **Outlook on the web** for spam and phishing using **Claude**. Analysis runs through a **Supabase Edge Function** so your **Anthropic API key stays on the server**—end users only configure a proxy URL and a shared **extension token**.

Supported Outlook URLs include `outlook.office.com`, `outlook.office365.com`, and `outlook.cloud.microsoft`.

## Features

- **AI analysis** via Claude (`claude-sonnet-4-20250514`) through your deployed proxy
- **Spam and phishing detection** with scores, summary, expandable findings, and suggested actions
- **Link revelation** — real destination domains next to links, with common safelink / URL-defense wrappers decoded
- **Domain mismatch** — highlights when link text implies a different host than the destination
- **External sender signal** — uses Outlook’s external-organization banner when present
- **Gift-card fraud pre-check** — fast local path for common scam patterns before calling the API
- **User feedback** — optional report of false positives or missed threats (stored in Supabase for review)
- **Collapsible sidebar** — minimal tab when collapsed
- **Settings** — additional instructions for the model (sent with each analysis); optional org domain stored in the extension

## Backend (Supabase)

The extension does **not** call Anthropic directly. It POSTs to your Edge Function with `emailData` and `customPrompt`; the function builds the prompt, calls Anthropic, and returns parsed JSON.

Deploy migrations and functions from the repo root. Full steps (CLI login, secrets, `db push`, deploy) are in **`supabase/README.md`**.

- **Secrets** (set in Supabase): `ANTHROPIC_API_KEY`, `EXTENSION_TOKEN` (must match what users paste in the extension), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Functions**: `analyze-email` (main analysis), `report-feedback` (user feedback). Deploy with JWT verification disabled for browser calls, e.g.  
  `supabase functions deploy analyze-email --no-verify-jwt`  
  `supabase functions deploy report-feedback --no-verify-jwt`

## Installation (developer / unpacked)

1. Clone or download this repository (folder name is typically `outlook-email-evaluator`).
2. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).
5. Click the extension icon → **Connection** tab:
   - **Supabase Proxy URL** — your function URL, e.g. `https://YOUR_PROJECT.supabase.co/functions/v1/analyze-email`
   - **Extension Token** — the same string as `EXTENSION_TOKEN` in Supabase secrets (not your Supabase anon key).
6. Click **Save & Test Connection** (uses a lightweight `ping` to the function; no email is analyzed).
7. Open **Settings** if you want **Additional Instructions** for the model; save.
8. Go to Outlook on the web, open a message, and use the sidebar **Analyze Email**.

## Usage

1. Select or open an email in the reading pane.
2. Use **Analyze Email** in the right-hand sidebar.
3. Review verdict, scores, summary, findings, and link list. Optionally use **False Positive** or **Missed Threat** to send feedback (subject/sender/recipient metadata only—no full body in the report).

**Rate limit:** the server enforces a short cooldown between analyses (e.g. one request every few seconds per token).

## Configuration

| Location | Purpose |
|----------|---------|
| **Connection** | Proxy URL + extension token (required). |
| **Settings** | **Additional instructions** — merged into the server-side prompt. **Organization domain** — e.g. `contoso.com`; sent with each analysis and used in the Edge Function prompt (sanitized server-side). |

The proxy URL must be exactly `https://<project-ref>.supabase.co/functions/v1/analyze-email` (optional trailing slash). **Custom domains** for Edge Functions are not supported; only `*.supabase.co` hosts are accepted, so the token is never sent to arbitrary servers.

## Privacy

Email content is sent to your **Supabase Edge Function** and then to **Anthropic** for inference. Scan and feedback metadata may be stored in your Supabase project. See **`PRIVACY.md`** for details.

## Requirements

- Google Chrome (or another Chromium browser that supports unpacked MV3 extensions)
- A **Supabase** project with Edge Functions and DB migrations applied as in `supabase/README.md`
- An **Anthropic API key** configured only in Supabase (not in the extension)
- Access to **Outlook on the web** on a supported domain

## Enterprise deployment

See **`ENTERPRISE-DEPLOYMENT.md`** for Intune, Google Admin, GPO, and self-hosted packaging notes.

## Chrome Web Store

Coming soon.

## License

MIT
