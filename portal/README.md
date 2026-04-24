# Email Evaluator — self-serve product key portal (Streamlit)

Small web UI where approved users request a **Chrome extension product key**. Each signup creates a row in **`customers`**, then a row in **`extension_tokens`** with **`customer_id`** set (see migration `20260406120000_customers.sql`). Keys are still stored hashed.

**You do not need to run this on your PC for end users.** Host it on **Streamlit Community Cloud** (free tier available) so everyone gets a normal **https://** URL.

---

## Deploy on Streamlit Community Cloud (recommended)

1. **Push this repo to GitHub** (the `portal/` folder must be in the repo).

2. Sign in at **[share.streamlit.io](https://share.streamlit.io)** with GitHub.

3. Click **New app** → choose the repo and branch.

4. **Main file path:** leave the default **`streamlit_app.py`** (at the **repository root**).  
   That file loads the UI from **`portal/app.py`**.  
   Dependencies are installed from the root **`requirements.txt`** (also required for this layout).

5. Open **⚙ Settings** → **Secrets**. Paste TOML with **exact** keys `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (see **`.streamlit/secrets.toml.example`** at the **repo root**):

   ```toml
   SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co"
   SUPABASE_SERVICE_ROLE_KEY = "eyJ..."

   DEFAULT_ORG_ID = ""
   PORTAL_SIGNUP_SECRET = "your-long-random-phrase"
   ```

   - **`DEFAULT_ORG_ID`:** optional UUID from `select id from public.organizations`. Leave `""` to auto-create an org per signup.
   - **`PORTAL_SIGNUP_SECRET`:** strongly recommended so random people cannot mint keys.

6. **Deploy.** When the app is live, share the **`*.streamlit.app`** URL with your users.

7. **Updates:** push to GitHub; the app can be set to redeploy automatically on commit.

---

## Security (hosted)

- The **service role** key lives only in **Streamlit Secrets**, never in the browser.
- Use **`PORTAL_SIGNUP_SECRET`** (and rotate it) like a shared invite code.
- For stricter control later, add Streamlit **authentication** or move signup behind your main product.

---

## Optional: run on your laptop (development only)

Use this to test UI changes before deploying.

**Secrets file location:** from the **repository root** (where `streamlit_app.py` lives), copy **`.streamlit/secrets.toml.example`** → **`.streamlit/secrets.toml`** and edit. Then:

```bash
# repo root
pip install -r requirements.txt
streamlit run streamlit_app.py
```

If you run `streamlit run portal/app.py` from the repo root without fixing paths, put **`portal/.streamlit/secrets.toml`** instead — but the documented flow is root `streamlit_app.py` + root `.streamlit/secrets.toml`.

---

## After signup

Users paste the key in the extension → **Connection** → **Extension Token**. Trial keys expire in **15 days**, annual in **365 days**, matching the Edge Functions.
