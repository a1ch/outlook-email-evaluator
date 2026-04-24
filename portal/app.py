"""
Self-serve portal: collect signup details and issue one extension product key per submission.
Uses Supabase service role from Streamlit secrets only (server-side).
"""

from __future__ import annotations

import hashlib
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


def get_supabase() -> Client:
    url = st.secrets.get("SUPABASE_URL", "")
    key = st.secrets.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        st.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Streamlit secrets.")
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
        email = st.text_input("Work email", placeholder="you@company.com")
        company = st.text_input("Company / team name", placeholder="Acme Corp")
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
    if not email or "@" not in email or len(email) > 254:
        st.error("Please enter a valid email.")
        return
    if not company or len(company) < 2:
        st.error("Please enter your company or team name.")
        return

    try:
        sb = get_supabase()
        org_id = ensure_org(sb, company)
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
                    "license_type": license_type,
                    "expires_at": exp,
                }
            )
            .execute()
        )
        if not ins.data:
            raise RuntimeError("Insert returned no row.")
    except Exception as e:
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
