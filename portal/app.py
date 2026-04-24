"""
Self-serve portal: collect signup details and issue one extension product key per submission.
Uses Supabase service role from Streamlit secrets only (server-side).
"""

from __future__ import annotations

import hashlib
import os
import re
import secrets
from datetime import datetime, timedelta, timezone

import streamlit as st
from supabase import Client, create_client


def hash_token(plain: str) -> str:
    """SHA-256 UTF-8 digest, hex — must match supabase/functions/_shared/extension-auth.ts."""
    return hashlib.sha256(plain.encode("utf-8")).hexdigest()


def gen_token_plain() -> str:
    """64 hex chars (32 random bytes), same length as admin-console genToken()."""
    return secrets.token_hex(32)


def expires_at_iso(license_type: str) -> str:
    now = datetime.now(timezone.utc)
    if license_type == "annual":
        return (now + timedelta(days=365)).isoformat()
    return (now + timedelta(days=15)).isoformat()


def slugify_company(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return (s[:50] if s else "org") + "-" + secrets.token_hex(3)


_PHONE_OK = re.compile(r"^[\d\s\-+().]{7,32}$")


def validate_phone(raw: str) -> bool:
    s = (raw or "").strip()
    if len(s) < 7 or len(s) > 32:
        return False
    return bool(_PHONE_OK.match(s))


def _secret(name: str) -> str:
    """Streamlit secrets first; optional env fallback (e.g. Docker)."""
    try:
        v = st.secrets.get(name, "")
    except Exception:
        v = ""
    if v and str(v).strip():
        return str(v).strip()
    return (os.environ.get(name) or "").strip()


def get_supabase() -> Client:
    url = _secret("SUPABASE_URL")
    key = _secret("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        st.error("**Supabase credentials are not configured.**")
        with st.expander("How to fix this", expanded=True):
            st.markdown(
                """
**On Streamlit Community Cloud**

1. Open your app on [share.streamlit.io](https://share.streamlit.io).
2. Click **⚙ Settings** (bottom right) → **Secrets**.
3. Paste TOML with **exact** key names (case-sensitive):

```toml
SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co"
SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

4. **Save** — the app will restart. Keys are in Supabase → **Project Settings → API**.

**Running locally** (repo root, next to `streamlit_app.py`):

1. Copy `.streamlit/secrets.toml.example` → `.streamlit/secrets.toml`
2. Fill in real values. Streamlit only reads **`/.streamlit/secrets.toml`** when you run from the **repository root** — not `portal/.streamlit/` unless you `cd portal` and run `app.py` there.

**Typical mistakes:** typo in key names, missing quotes around values, or secrets only added under `portal/` while Cloud runs `streamlit_app.py` from root (Cloud uses the **Secrets** UI, not files in Git).
"""
            )
        st.stop()
    return create_client(url, key)


def ensure_org(sb: Client, company: str) -> str:
    default = (st.secrets.get("DEFAULT_ORG_ID") or "").strip()
    if default:
        return default
    row = (
        sb.table("organizations")
        .insert(
            {
                "name": company.strip()[:200],
                "slug": slugify_company(company),
                "plan": "trial",
                "seat_limit": 5,
            }
        )
        .execute()
    )
    if not row.data:
        raise RuntimeError("Could not create organization.")
    return row.data[0]["id"]


def main() -> None:
    st.set_page_config(
        page_title="Email Evaluator — Get your key",
        page_icon="📧",
        layout="centered",
    )
    st.title("📧 Outlook Email Evaluator")
    st.markdown(
        "Request a **product key** for the Chrome extension. "
        "You will paste it under **Connection → Extension Token** after installing the extension."
    )

    portal_secret = (st.secrets.get("PORTAL_SIGNUP_SECRET") or "").strip()

    with st.form("signup"):
        if portal_secret:
            invite = st.text_input(
                "Signup passphrase",
                type="password",
                help="Provided by your administrator.",
            )
        else:
            invite = ""
        c1, c2 = st.columns(2)
        with c1:
            first_name = st.text_input("First name", placeholder="Jane")
        with c2:
            last_name = st.text_input("Last name", placeholder="Doe")
        email = st.text_input("Work email", placeholder="you@company.com")
        phone = st.text_input(
            "Phone",
            placeholder="+1 555 123 4567",
            help="Include country code if outside your default region.",
        )
        company = st.text_input("Company / team name", placeholder="Acme Corp")
        st.markdown("**Mailing address**")
        address_line1 = st.text_input("Street address", placeholder="123 Main St")
        address_line2 = st.text_input(
            "Apt, suite, etc. (optional)",
            placeholder="",
        )
        ac1, ac2 = st.columns(2)
        with ac1:
            city = st.text_input("City", placeholder="Seattle")
        with ac2:
            region = st.text_input("State / province / region", placeholder="WA")
        ap1, ap2 = st.columns(2)
        with ap1:
            postal_code = st.text_input("Postal code", placeholder="98101")
        with ap2:
            country = st.text_input("Country", placeholder="United States")
        license_type = st.selectbox(
            "License",
            options=["trial", "annual"],
            format_func=lambda x: "Trial (15 days)" if x == "trial" else "Annual (365 days)",
        )
        submitted = st.form_submit_button("Generate my key")

    if not submitted:
        st.caption(
            "Keys are shown **once**. Store them safely. For questions, contact your IT or security team."
        )
        return

    if portal_secret and invite != portal_secret:
        st.error("Invalid signup passphrase.")
        return

    email = (email or "").strip()
    company = (company or "").strip()
    first_name = (first_name or "").strip()
    last_name = (last_name or "").strip()
    phone = (phone or "").strip()
    address_line1 = (address_line1 or "").strip()
    address_line2 = (address_line2 or "").strip()
    city = (city or "").strip()
    region = (region or "").strip()
    postal_code = (postal_code or "").strip()
    country = (country or "").strip()

    if not first_name or len(first_name) > 100:
        st.error("Please enter your first name (max 100 characters).")
        return
    if not last_name or len(last_name) > 100:
        st.error("Please enter your last name (max 100 characters).")
        return
    if not email or "@" not in email or len(email) > 254:
        st.error("Please enter a valid email.")
        return
    if not validate_phone(phone):
        st.error("Please enter a valid phone number (7–32 characters; digits and common formatting only).")
        return
    if not company or len(company) < 2:
        st.error("Please enter your company or team name.")
        return
    if not address_line1 or len(address_line1) > 200:
        st.error("Please enter a street address.")
        return
    if not city or len(city) > 100:
        st.error("Please enter a city.")
        return
    if not region or len(region) > 100:
        st.error("Please enter a state, province, or region.")
        return
    if not postal_code or len(postal_code) > 32:
        st.error("Please enter a postal code.")
        return
    if not country or len(country) > 100:
        st.error("Please enter a country.")
        return

    full_name = f"{first_name} {last_name}".strip()[:300]

    try:
        sb = get_supabase()
        org_id = ensure_org(sb, company)
        cust = (
            sb.table("customers")
            .insert(
                {
                    "org_id": org_id,
                    "email": email[:254],
                    "company_name": company[:200],
                    "full_name": full_name,
                    "first_name": first_name[:100],
                    "last_name": last_name[:100],
                    "phone": phone[:32],
                    "address_line1": address_line1[:200],
                    "address_line2": address_line2[:200] if address_line2 else None,
                    "city": city[:100],
                    "region": region[:100],
                    "postal_code": postal_code[:32],
                    "country": country[:100],
                    "signup_source": "streamlit",
                }
            )
            .execute()
        )
        if not cust.data:
            raise RuntimeError("Could not create customer record.")
        customer_id = cust.data[0]["id"]
        plain = gen_token_plain()
        token_hash = hash_token(plain)
        exp = expires_at_iso(license_type)
        ins = (
            sb.table("extension_tokens")
            .insert(
                {
                    "token_hash": token_hash,
                    "label": company[:200],
                    "user_email": email[:254],
                    "org_id": org_id,
                    "customer_id": customer_id,
                    "license_type": license_type,
                    "expires_at": exp,
                }
            )
            .execute()
        )
        if not ins.data:
            raise RuntimeError("Insert returned no row.")
    except Exception as e:
        err = str(e).lower()
        if "unique" in err and "customers" in err:
            st.error(
                "An account with this email already exists for this organization. "
                "Contact your administrator if you need a new key."
            )
        elif "duplicate key" in err:
            st.error(
                "This email is already registered. Contact your administrator if you need a new key."
            )
        else:
            st.error(f"Could not create key: {e}")
        return

    st.success("Your key is ready — copy it now. It cannot be shown again.")
    st.code(plain, language="text")
    st.info(
        f"**License:** {license_type} · **Valid until (UTC):** {exp}\n\n"
        "In Chrome: extension icon → **Connection** → paste the key → Save → open Outlook on the web and use **Analyze Email**."
    )


if __name__ == "__main__":
    main()
