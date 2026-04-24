# Privacy Policy — Outlook Email Evaluator

**Last updated: March 27, 2026**

## Overview

Outlook Email Evaluator is a Chrome extension that analyzes emails in Microsoft Outlook Web for spam and phishing threats using AI. This privacy policy explains what data is collected, how it flows, and how it is protected.

## Product key signup portal

If you request an extension product key through a **Streamlit** (or similar) signup portal operated for this product, you may be asked to provide **first name, last name, work email, phone number, company or team name, and mailing address** (street, city, region, postal code, country; optional second address line). That information is stored in the operator’s **Supabase** database (as **customer** / licensing records) and used to **issue and manage keys**, **operate the service**, and **contact you** if needed. It is **not** sold. Access is restricted to **service administrators** and systems using the **service role** key (treat portal deployments as internal tools). For applicable legal terms, see **`TERMS_AND_CONDITIONS.md`**.

## Architecture

This extension does not call AI services directly from your browser. Instead, it sends email metadata to a secure proxy service hosted on Supabase (supabase.co), which forwards the request to the Anthropic Claude API for analysis. Your Anthropic API key is stored on the server and never touches your browser.

## Data Collected

When you click Analyze Email, the following information is extracted from the currently open email and sent to the proxy service:

- Email subject line
- Sender display name
- Recipient / To line (when visible in the reading pane)
- Email body text (up to 3,000 characters)
- Hyperlink display text and destination domains extracted from the email body
- Attachment file names (if present)
- Whether Outlook flagged the sender as external

Optional settings you save in the extension are also sent with each analysis request: your **organization domain** (e.g. `company.com`, used only to tailor internal-vs-external context in the AI prompt) and any **additional instructions** text you enter.

No email content beyond these fields is collected or transmitted.

## Data Flow

| Step | What happens | Who can see email content? |
|------|-------------|--------------------------|
| 1. Your browser | Extension reads the email from the Outlook page | You (local only) |
| 2. Network transit | Data sent over HTTPS (TLS encrypted) | No one (encrypted) |
| 3. Supabase Edge Function | Validates your token, builds the AI prompt, forwards to Anthropic | In memory only during execution — not inspected, logged, or stored by Supabase |
| 4. Anthropic API | Analyzes the email and returns a verdict | Anthropic (see below) |
| 5. Response | Result returned to your browser and displayed in the sidebar | You (local only) |

Email content is processed transiently for inference. Full message bodies are **not** stored in your database; see **Scan Logging** below for what is retained (metadata and scores only).

## Anthropic API

This extension uses the Anthropic Claude API to perform email analysis. Per Anthropic's API data policy:

- API inputs are **not used for model training** by default.
- API data may be **retained for up to 30 days** for trust and safety purposes, then deleted.
- Anthropic employees may access data during that period for safety review.

Your use of this extension is subject to [Anthropic's Privacy Policy](https://www.anthropic.com/privacy) and [Terms of Service](https://www.anthropic.com/terms).

## Supabase

The proxy service runs as a Supabase Edge Function. Supabase acts as a **data processor** (not a data controller) under their [Data Processing Addendum](https://supabase.com/legal/dpa). Supabase does not inspect, store, or share the email content that passes through the function. Infrastructure is hosted on AWS.

For details, see [Supabase Privacy Policy](https://supabase.com/docs/company/privacy).

## Scan Logging

Each analysis logs the following to a Supabase database for usage reporting and troubleshooting:

- A **hashed** identifier for the extension token (not the token itself). Your project may associate tokens with **organization** metadata for licensing; that association is stored in your database under your control.
- Verdict (Safe / Suspicious / Spam / Phishing)
- Phishing risk score and spam score
- Response time
- Timestamp
- **Subject line, From, and To** — truncated lengths only (no full message body is stored in this table)

**Message body text is not written to `scan_log`.** The Edge Function may also emit a single structured **log line** (subject / from / to, truncated) to Supabase’s function logs for the same operational purposes.

## Local Storage

The following are stored locally in your browser using Chrome's `chrome.storage.local` API and never leave your device except as described above:

- **Proxy URL** — the address of the Supabase Edge Function
- **Extension token** — a secret that authenticates your requests to the proxy (often a **per-tenant** key issued by your administrator; alternatively a single legacy secret configured only in Supabase)
- **Organization domain** — used to detect external senders
- **Custom instructions** — optional text passed to the AI on each analysis

## Permissions Used

This extension requests the following Chrome permissions:

- **activeTab** — to read the content of the Outlook tab you are currently viewing
- **storage** — to store your settings locally in your browser
- **Host permission for outlook.cloud.microsoft, outlook.office.com, and outlook.office365.com** — to inject the sidebar UI into Outlook Web
- **Host permission for *.supabase.co** — to send analysis requests to the proxy service

## Data Sharing

This extension does not sell, share, or disclose any user data to any third party. Email data is transmitted only to:

1. **Supabase** (infrastructure provider, data processor) — transiently, during Edge Function execution
2. **Anthropic** (AI provider) — for email analysis, subject to their data retention policy

No other parties receive any data.

## Children's Privacy

This extension is not directed at children under the age of 13 and does not knowingly collect data from children.

## Changes to This Policy

This privacy policy may be updated periodically. The date at the top of this document reflects the most recent revision. Continued use of the extension after changes constitutes acceptance of the updated policy.

## Contact

For questions about this privacy policy, please open an issue at:
https://github.com/a1ch/outlook-email-evaluator
