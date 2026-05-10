"""
Clarivise — AI-powered email security platform.
Two product lines: Clarivise Scan and Clarivise Shield.
"""

from __future__ import annotations

import hashlib
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import streamlit as st
from supabase import Client, create_client

MIN_PASSWORD_LEN = 8
SB_ACCESS = "sb_access_token"
SB_REFRESH = "sb_refresh_token"
SB_ANON = "portal_anon_client"

PAGE_STREAMLIT_HOME = "streamlit_app.py"
PAGE_REQUEST_KEY    = "pages/1_Request_a_key.py"
PAGE_TERMS          = "pages/2_Terms.py"
PAGE_PRIVACY        = "pages/3_Privacy.py"


def hash_token(plain: str) -> str:
    return hashlib.sha256(plain.encode("utf-8")).hexdigest()

def gen_token_plain() -> str:
    return secrets.token_hex(32)

def expires_at_iso(license_type: str) -> str:
    now = datetime.now(timezone.utc)
    return (now + timedelta(days=365 if license_type == "annual" else 15)).isoformat()

def slugify_company(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return (s[:50] if s else "org") + "-" + secrets.token_hex(3)

_PHONE_OK = re.compile(r"^[\d\s\-+().]{7,32}$")

def validate_phone(raw: str) -> bool:
    s = (raw or "").strip()
    return 7 <= len(s) <= 32 and bool(_PHONE_OK.match(s))

def _secret(name: str) -> str:
    try:
        v = st.secrets.get(name, "")
    except Exception:
        v = ""
    if v and str(v).strip():
        return str(v).strip()
    return (os.environ.get(name) or "").strip()

def _legal_doc_urls() -> tuple[str, str]:
    return "pages/2_Terms.py", "pages/3_Privacy.py"

def _portal_bootstrap() -> dict[str, str]:
    return {
        "product": _secret("PORTAL_PRODUCT_NAME") or "Clarivise Scan",
        "tagline": _secret("PORTAL_TAGLINE") or "Real-time AI risk scores and plain-English guidance—inside Outlook on the web.",
    }

def get_anon_client() -> Optional[Client]:
    url  = _secret("SUPABASE_URL")
    anon = _secret("SUPABASE_ANON_KEY")
    if not url or not anon:
        return None
    if SB_ANON not in st.session_state:
        st.session_state[SB_ANON] = create_client(url, anon)
    return st.session_state[SB_ANON]

def _persist_auth_session(session: Any) -> None:
    if session is None:
        return
    st.session_state[SB_ACCESS]  = session.access_token
    st.session_state[SB_REFRESH] = session.refresh_token

def _clear_auth_session() -> None:
    for k in (SB_ACCESS, SB_REFRESH):
        st.session_state.pop(k, None)

def get_auth_user(client: Client) -> Optional[Any]:
    at = st.session_state.get(SB_ACCESS)
    rt = st.session_state.get(SB_REFRESH)
    if not at or not rt:
        return None
    try:
        client.auth.set_session(at, rt)
    except Exception:
        _clear_auth_session()
        return None
    user: Optional[Any] = None
    try:
        uresp = client.auth.get_user()
        if uresp is not None:
            user = getattr(uresp, "user", None)
    except Exception:
        pass
    if user is None:
        try:
            gs   = client.auth.get_session()
            sess = getattr(gs, "session", None) or gs
            if sess is not None:
                user = getattr(sess, "user", None)
        except Exception:
            pass
    if user is None or not hasattr(user, "id"):
        _clear_auth_session()
        return None
    return user

def _user_email(user: Any) -> str:
    return (getattr(user, "email", None) or "").strip()

def _auth_error_message(err: Exception) -> str:
    for attr in ("message", "msg", "error_description", "name"):
        v = getattr(err, attr, None)
        if v and str(v) != type(err).__name__:
            return str(v)
    return str(err) or "Authentication failed."

def sign_out_user(client: Client) -> None:
    try:
        client.auth.sign_out()
    except Exception:
        pass
    _clear_auth_session()
    if SB_ANON in st.session_state:
        del st.session_state[SB_ANON]


# ── Theme ──────────────────────────────────────────────────────────────────────
def _inject_saas_theme() -> None:
    st.markdown("""
<style>
    :root { --saas-ink:#0f172a; --saas-muted:#64748b; --saas-accent:#4f46e5; --saas-surface:#fff; --saas-border:#e2e8f0; }
    .block-container { padding-top:0.5rem !important; max-width:1100px; }
    [data-testid="stAppViewContainer"] { background:linear-gradient(180deg,#f8fafc 0%,#f1f5f9 100%); }
    [data-testid="stMainBlockContainer"] { color:#1e293b; }
    section.main [data-baseweb="tab"] { color:#334155 !important; background-color:#f1f5f9 !important; }
    section.main [data-baseweb="tab"][aria-selected="true"] { color:#0f172a !important; background-color:#fff !important; border-bottom-color:#4f46e5 !important; }
    section.main [data-baseweb="input"] input,
    section.main [data-baseweb="input"] textarea { color:#0f172a !important; -webkit-text-fill-color:#0f172a !important; background-color:#fff !important; caret-color:#0f172a !important; }
    section.main label, section.main [data-testid="stWidgetLabel"] p { color:#334155 !important; }
    section.main [data-testid="stCaption"] { color:#64748b !important; }
    .saas-hero { background:linear-gradient(145deg,#0f172a 0%,#1e1b4b 45%,#312e81 100%); color:#f8fafc; border-radius:20px; padding:2.6rem 2.1rem 2.4rem; margin-bottom:1.75rem; box-shadow:0 32px 64px -24px rgba(15,23,42,.45); position:relative; overflow:hidden; }
    .saas-hero::after { content:""; position:absolute; top:-50%; right:-20%; width:60%; height:200%; background:radial-gradient(ellipse,rgba(99,102,241,.28) 0%,transparent 70%); pointer-events:none; }
    .saas-hero-inner { position:relative; z-index:1; }
    .saas-badge { display:inline-block; font-size:.72rem; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:#c7d2fe; background:rgba(99,102,241,.22); border:1px solid rgba(165,180,252,.35); border-radius:999px; padding:.38rem .95rem; margin-bottom:1rem; }
    .saas-hero h1 { font-size:clamp(1.65rem,4.2vw,2.6rem); font-weight:700; letter-spacing:-.03em; line-height:1.12; margin:0 0 .45rem; color:#fff; }
    .saas-hero p.lead { font-size:1.1rem; line-height:1.6; color:#cbd5e1; max-width:38rem; margin:0 0 1.1rem; }
    .saas-hero .pill-row { display:flex; flex-wrap:wrap; gap:.45rem; margin-top:.6rem; }
    .saas-pill { font-size:.78rem; color:#e0e7ff; background:rgba(15,23,42,.35); border:1px solid rgba(148,163,184,.2); border-radius:8px; padding:.32rem .7rem; }
    .product-grid { display:grid; grid-template-columns:1fr 1fr; gap:1.25rem; margin:1.5rem 0; }
    .product-card { border-radius:16px; padding:1.75rem; border:1px solid var(--saas-border); background:#fff; box-shadow:0 2px 8px rgba(15,23,42,.06); position:relative; overflow:hidden; }
    .product-card.scan { border-top:4px solid #4f46e5; }
    .product-card.shield { border-top:4px solid #2E75B6; }
    .product-card .product-badge { display:inline-block; font-size:.65rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase; border-radius:6px; padding:.25rem .6rem; margin-bottom:.75rem; }
    .product-card.scan .product-badge { background:#eef2ff; color:#4f46e5; }
    .product-card.shield .product-badge { background:#dbeafe; color:#1d4ed8; }
    .product-card h2 { font-size:1.3rem; font-weight:700; color:#0f172a; margin:0 0 .4rem; letter-spacing:-.02em; }
    .product-card p.desc { font-size:.88rem; color:#475569; line-height:1.6; margin:0 0 1rem; }
    .product-card .feature-list { list-style:none; padding:0; margin:0 0 1.25rem; }
    .product-card .feature-list li { font-size:.83rem; color:#334155; padding:.25rem 0; display:flex; align-items:flex-start; gap:.5rem; }
    .product-card .feature-list li::before { content:"✓"; color:#059669; font-weight:700; flex-shrink:0; margin-top:1px; }
    .product-card .price-row { font-size:.82rem; color:#6b7280; border-top:1px solid #f1f5f9; padding-top:.75rem; margin-top:.25rem; }
    .product-card .price-row strong { color:#0f172a; }
    .saas-trust { display:flex; flex-wrap:wrap; align-items:center; gap:1.1rem 1.5rem; margin:1.4rem 0 1.75rem; color:var(--saas-muted); font-size:.88rem; }
    .saas-trust strong { color:var(--saas-ink); }
    .saas-trust .dot { color:#cbd5e1; }
    .saas-section-title { font-size:.68rem; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--saas-muted); margin:0 0 .65rem; }
    .saas-h2 { font-size:1.38rem; font-weight:700; color:var(--saas-ink); margin:0 0 .9rem; letter-spacing:-.02em; }
    .saas-card { background:var(--saas-surface); border:1px solid var(--saas-border); border-radius:14px; padding:1.3rem 1.15rem; height:100%; box-shadow:0 1px 2px rgba(15,23,42,.04); }
    .saas-card .icon { font-size:1.65rem; line-height:1; margin-bottom:.5rem; }
    .saas-card h3 { font-size:1.02rem; font-weight:600; color:var(--saas-ink); margin:0 0 .35rem; }
    .saas-card p { font-size:.86rem; color:var(--saas-muted); line-height:1.55; margin:0; }
    .saas-steps { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:.85rem; }
    .saas-step { text-align:left; padding:.9rem 1rem; border-left:3px solid var(--saas-accent); background:#f8fafc; border-radius:0 10px 10px 0; }
    .saas-step .n { display:inline-block; min-width:1.6rem; height:1.6rem; line-height:1.6rem; text-align:center; border-radius:7px; background:#eef2ff; color:var(--saas-accent); font-weight:700; font-size:.8rem; margin-bottom:.4rem; }
    .saas-step h4 { font-size:.9rem; font-weight:600; margin:0 0 .3rem; color:var(--saas-ink); }
    .saas-step p { font-size:.8rem; color:var(--saas-muted); margin:0; line-height:1.45; }
    .saas-pricing { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:.9rem; margin-bottom:1.1rem; }
    .saas-price-card { border:1px solid var(--saas-border); border-radius:14px; padding:1.4rem 1.25rem; background:#fff; position:relative; }
    .saas-price-card.popular { border-color:#818cf8; box-shadow:0 0 0 1px #818cf8,0 16px 32px -12px rgba(79,70,229,.2); }
    .saas-price-card .tag { position:absolute; top:-.45rem; right:.9rem; background:#4f46e5; color:#fff; font-size:.62rem; font-weight:700; padding:.2rem .5rem; border-radius:6px; letter-spacing:.04em; }
    .saas-price-card h3 { margin:0 0 .2rem; font-size:1.02rem; color:var(--saas-ink); }
    .saas-price-card .price { font-size:1.35rem; font-weight:700; color:var(--saas-ink); margin:.4rem 0; }
    .saas-price-card .sub { font-size:.78rem; color:var(--saas-muted); line-height:1.4; }
    div[data-testid="stExpander"] details { background:#fff; border:1px solid var(--saas-border) !important; border-radius:10px; }
    .legal-container { max-width:860px; margin:0 auto; }
    .legal-hero { border-radius:16px; padding:2rem 2rem 1.75rem; margin-bottom:1.5rem; }
    .legal-hero h1 { font-size:1.6rem; font-weight:700; margin:0 0 .3rem; color:#fff; }
    .legal-hero p { font-size:.9rem; color:#94a3b8; margin:0; }
    .legal-toc { background:#f1f5f9; border:1px solid #e2e8f0; border-radius:12px; padding:1rem 1.25rem; margin-bottom:1.5rem; }
    .legal-toc p { font-size:.78rem; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:#64748b; margin:0 0 .5rem; }
    .legal-toc a { color:#4f46e5 !important; text-decoration:none; font-size:.85rem; }
    .legal-toc a:hover { text-decoration:underline; }
    .legal-section { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:1.4rem 1.5rem; margin-bottom:1rem; }
    .legal-section h2 { font-size:1rem; font-weight:700; color:#0f172a; margin:0 0 .75rem; padding-bottom:.5rem; border-bottom:1px solid #e2e8f0; }
    .legal-section p, .legal-section li { font-size:.88rem; color:#334155; line-height:1.65; }
    .legal-section ul { margin:.5rem 0 0 1rem; padding:0; }
    .legal-section li { margin-bottom:.3rem; }
    .legal-section table { width:100%; border-collapse:collapse; font-size:.82rem; margin-top:.5rem; }
    .legal-section th { background:#f1f5f9; color:#334155; font-weight:600; padding:.5rem .75rem; border:1px solid #e2e8f0; text-align:left; }
    .legal-section td { padding:.45rem .75rem; border:1px solid #e2e8f0; color:#475569; vertical-align:top; }
    .legal-warning { background:#fef3c7; border:1px solid #fbbf24; border-radius:10px; padding:1rem 1.25rem; margin-bottom:1.25rem; font-size:.85rem; color:#78350f; font-weight:500; line-height:1.55; }
    .legal-caps { font-size:.82rem; color:#475569; line-height:1.6; }
    .legal-footer { text-align:center; font-size:.78rem; color:#94a3b8; margin:1.5rem 0 .5rem; padding-top:1rem; border-top:1px solid #e2e8f0; }
</style>""", unsafe_allow_html=True)


# ── Navigation ─────────────────────────────────────────────────────────────────
def render_sidebar_navigation(p: dict[str, str]) -> None:
    with st.sidebar:
        st.markdown("### Clarivise")
        st.caption("AI-powered email security")
        st.divider()
        st.caption("Products")
        st.markdown("📧 **Clarivise Scan** — you are here")
        st.markdown("🛡️ **Clarivise Shield** — coming soon")

def render_in_page_navigation(p: dict[str, str]) -> None:
    n1, n2, n3, n4 = st.columns(4)
    with n1:
        try:
            st.page_link(PAGE_STREAMLIT_HOME, label="Home", icon="🏠", use_container_width=True)
        except TypeError:
            st.page_link(PAGE_STREAMLIT_HOME, label="Home", icon="🏠")
    with n2:
        try:
            st.page_link(PAGE_REQUEST_KEY, label="Get a Key", icon="🔑", use_container_width=True)
        except TypeError:
            st.page_link(PAGE_REQUEST_KEY, label="Get a Key", icon="🔑")
    with n3:
        try:
            st.page_link(PAGE_TERMS, label="Terms", icon="📋", use_container_width=True)
        except TypeError:
            st.page_link(PAGE_TERMS, label="Terms", icon="📋")
    with n4:
        try:
            st.page_link(PAGE_PRIVACY, label="Privacy", icon="🔒", use_container_width=True)
        except TypeError:
            st.page_link(PAGE_PRIVACY, label="Privacy", icon="🔒")
    st.divider()


# ── Home page ──────────────────────────────────────────────────────────────────
def render_portal_landing(p: dict[str, str]) -> None:
    st.markdown("""
<div class="saas-hero">
  <div class="saas-hero-inner">
    <div class="saas-badge">AI Email Security · Microsoft 365 · Powered by Claude</div>
    <h1>Clarivise</h1>
    <p class="lead">AI-powered email security for Microsoft 365 — from on-demand analysis in the reading pane to automatic protection at the mail transport layer.</p>
    <div class="pill-row">
      <span class="saas-pill">Claude AI analysis</span>
      <span class="saas-pill">No API keys in the browser</span>
      <span class="saas-pill">Built for Microsoft 365</span>
      <span class="saas-pill">Prompt caching — 90% cost reduction</span>
    </div>
  </div>
</div>""", unsafe_allow_html=True)

    st.markdown("""
<div class="saas-trust">
  <span><strong>Server-side</strong> — Anthropic keys stay in Supabase, never in the browser</span>
  <span class="dot">·</span>
  <span><strong>Two layers</strong> — on-demand analysis and automatic mail transport protection</span>
  <span class="dot">·</span>
  <span><strong>AI-powered</strong> — real-time phishing, spam, and BEC detection</span>
</div>""", unsafe_allow_html=True)

    st.markdown('<p class="saas-section-title" style="margin-top:0.5rem;">Our products</p>', unsafe_allow_html=True)
    st.markdown('<h2 class="saas-h2">Two layers of email security</h2>', unsafe_allow_html=True)

    st.markdown("""
<div class="product-grid">

  <div class="product-card scan">
    <div class="product-badge">Clarivise Scan</div>
    <h2>📧 On-demand analysis</h2>
    <p class="desc">A Chrome extension that sits inside Outlook on the web. Click Analyze Email on any message and get an instant AI verdict with plain-English explanations.</p>
    <ul class="feature-list">
      <li>Phishing score, spam score, and verdict</li>
      <li>Link and attachment analysis</li>
      <li>Display name impersonation detection</li>
      <li>Plain-English findings for non-technical users</li>
      <li>Send to IT Security button</li>
      <li>Works inside Outlook — no new app</li>
    </ul>
    <div class="price-row"><strong>From $5 / user / month (USD)</strong> &nbsp;·&nbsp; Free 15-day trial · Annual license · Chrome extension</div>
  </div>

  <div class="product-card shield">
    <div class="product-badge">Clarivise Shield</div>
    <h2>🛡️ Automatic protection</h2>
    <p class="desc">A mail transport pipeline that intercepts every inbound email at the M365 layer — before it reaches the inbox. Claude analyzes each message and automatically tags, junks, or quarantines threats.</p>
    <ul class="feature-list">
      <li>Analyzes 100% of inbound external email</li>
      <li>Automatic quarantine for phishing</li>
      <li>Subject-line tagging for suspicious email</li>
      <li>Allow/blocklist management</li>
      <li>Admin dashboard with scan log</li>
      <li>Daily AI security summary email</li>
    </ul>
    <div class="price-row"><strong>From $12 / user / month (USD)</strong> &nbsp;·&nbsp; Contact us for pricing · M365 mail transport integration</div>
  </div>

</div>""", unsafe_allow_html=True)

    st.markdown('<div style="margin:1.5rem 0 .75rem;"><p class="saas-section-title">Clarivise Scan</p><h2 class="saas-h2" style="margin-top:0">From open email to verdict in seconds</h2></div>', unsafe_allow_html=True)
    st.markdown("""
<div class="saas-steps">
  <div class="saas-step"><div class="n">1</div><h4>Install extension</h4><p>Load Clarivise Scan in Chrome and configure your proxy URL and product key under Connection.</p></div>
  <div class="saas-step"><div class="n">2</div><h4>Open any email</h4><p>Open a message in Outlook on the web and click <strong>Analyze Email</strong> in the sidebar.</p></div>
  <div class="saas-step"><div class="n">3</div><h4>Get the verdict</h4><p>Claude AI returns a phishing score, spam score, and plain-English explanation of any red flags.</p></div>
</div>""", unsafe_allow_html=True)

    st.markdown('<div style="margin:1.5rem 0 .75rem;"><p class="saas-section-title">Clarivise Shield</p><h2 class="saas-h2" style="margin-top:0">Automatic protection at the transport layer</h2></div>', unsafe_allow_html=True)
    st.markdown("""
<div class="saas-steps">
  <div class="saas-step"><div class="n">1</div><h4>Connect to M365</h4><p>A mail flow rule journals every inbound external email to Shield before it reaches any inbox.</p></div>
  <div class="saas-step"><div class="n">2</div><h4>Claude analyzes</h4><p>Every email is scored for phishing, spam, BEC, and lookalike domains using Claude AI with prompt caching.</p></div>
  <div class="saas-step"><div class="n">3</div><h4>Automatic action</h4><p>SAFE emails deliver normally. SUSPICIOUS emails get tagged. PHISHING emails are quarantined for admin review.</p></div>
  <div class="saas-step"><div class="n">4</div><h4>Daily summary</h4><p>IT receives a daily email with all verdicts, threat counts, and flagged senders.</p></div>
</div>""", unsafe_allow_html=True)

    st.markdown('<div style="margin:1.5rem 0 .75rem;"><p class="saas-section-title">Pricing</p><h2 class="saas-h2" style="margin-top:0">Simple per-user pricing in USD</h2></div>', unsafe_allow_html=True)
    st.markdown("""
<div class="saas-pricing">
  <div class="saas-price-card">
    <h3>📧 Scan — Trial</h3>
    <div class="price">Free · 15 days</div>
    <p class="sub">Full Clarivise Scan access. Great for evaluating before rolling out to your team.</p>
  </div>
  <div class="saas-price-card popular">
    <div class="tag">Most popular</div>
    <h3>📧 Scan — Annual</h3>
    <div class="price">From $5 / user / mo</div>
    <p class="sub">One product key per user, 365-day license. On-demand AI analysis in Outlook on the web.</p>
  </div>
  <div class="saas-price-card">
    <h3>🛡️ Shield</h3>
    <div class="price">From $12 / user / mo</div>
    <p class="sub">Full mail transport protection. Automatic analysis of 100% of inbound email. Contact us for a quote.</p>
  </div>
</div>""", unsafe_allow_html=True)

    with st.expander("Compare Scan vs Shield", expanded=False):
        st.markdown("""
| Feature | Clarivise Scan | Clarivise Shield |
|---|---|---|
| On-demand analysis | ✅ User clicks Analyze | ✅ Automatic |
| Coverage | Emails user chooses to check | 100% of inbound external email |
| Deployment | Chrome extension | M365 mail transport rule |
| Quarantine | ❌ | ✅ Auto-quarantine phishing |
| Admin dashboard | ❌ | ✅ Full scan log + quarantine queue |
| Daily summary email | ❌ | ✅ |
| Best for | Individual users, small teams | Organizations, IT departments |
| Price (USD) | From $5 / user / mo | From $12 / user / mo |
        """)

    with st.expander("How the AI analysis works", expanded=False):
        st.markdown("""
Both products use **Claude AI** (Anthropic) via a secure **Supabase Edge Function**. Email metadata is sent server-side — your Anthropic API key never leaves the server.

**What's analyzed:** sender domain vs display name, link destinations vs display text, attachment names and extensions, body text patterns (urgency, credential requests, gift card asks), Reply-To vs From domain mismatches, lookalike domain detection (typosquatting).

**Cost efficiency:** both products use **prompt caching** — the analysis system prompt is cached at Anthropic, reducing per-email AI cost by ~40% on input tokens.
        """)


def render_home_cta(anon: Optional[Client], p: dict[str, str]) -> None:
    st.markdown("---")
    st.markdown("### Get started with Clarivise Scan")
    st.caption("Sign in and request a product key to activate the Chrome extension.")
    au = get_auth_user(anon) if anon else None
    c1, c2, c3 = st.columns([1, 2, 1])
    with c2:
        label = "Continue to your key" if au else "Get a Scan product key"
        if st.button(label, type="primary", use_container_width=True, key="nav_to_key_page"):
            try:
                st.switch_page(PAGE_REQUEST_KEY)
            except Exception:
                st.error("Use **Get a Key** in the navigation above.")
    st.caption("Interested in Clarivise Shield for your organization? Contact us at shawn@ingotsolutions.com")
    if not anon:
        st.warning("Add **SUPABASE_ANON_KEY** to Streamlit secrets to enable sign-in.")


# ── Terms page ─────────────────────────────────────────────────────────────────
def render_terms_content() -> None:
    st.markdown("""
<div class="legal-container">
<div class="legal-hero" style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);">
  <h1>📋 Terms and Conditions of Use</h1>
  <p>Clarivise (Outlook Email Evaluator) — Ingot Solutions &nbsp;·&nbsp; Effective: April 4, 2026 &nbsp;·&nbsp; Governing jurisdiction: Province of Alberta, Canada</p>
</div>
<div class="legal-warning">
  ⚠️ <strong>IMPORTANT:</strong> BY INSTALLING OR USING THE SOFTWARE, OR BY SUBMITTING INFORMATION THROUGH THE SIGNUP PORTAL, YOU AGREE TO THESE TERMS. IF YOU DO NOT AGREE, DO NOT USE THE SOFTWARE OR THE PORTAL.
</div>
<div class="legal-toc">
  <p>Contents</p>
  <a href="#s1">1. Definitions</a> &nbsp;·&nbsp; <a href="#s2">2. Acceptance</a> &nbsp;·&nbsp; <a href="#s3">3. Nature of the Service</a> &nbsp;·&nbsp; <a href="#s4">4. Disclaimer of Warranties</a> &nbsp;·&nbsp; <a href="#s5">5. Limitation of Liability</a> &nbsp;·&nbsp; <a href="#s6">6. Indemnity</a> &nbsp;·&nbsp; <a href="#s7">7. License and Restrictions</a> &nbsp;·&nbsp; <a href="#s8">8. Signup Portal and Account Data</a> &nbsp;·&nbsp; <a href="#s9">9. Third-Party Services</a> &nbsp;·&nbsp; <a href="#s10">10. Privacy</a> &nbsp;·&nbsp; <a href="#s11">11. Intellectual Property</a> &nbsp;·&nbsp; <a href="#s12">12. Suspension and Termination</a> &nbsp;·&nbsp; <a href="#s13">13. Changes</a> &nbsp;·&nbsp; <a href="#s14">14. Governing Law</a> &nbsp;·&nbsp; <a href="#s15">15. General</a> &nbsp;·&nbsp; <a href="#s16">16. Contact</a>
</div>
<div class="legal-section" id="s1"><h2>1. Definitions</h2><ul>
  <li><strong>"Software"</strong> means the Clarivise Scan browser extension, Clarivise Shield mail transport service, related documentation, and any product key or signup portal operated by or on behalf of Ingot Solutions.</li>
  <li><strong>"Ingot Solutions," "we," "us"</strong> means Ingot Solutions (operating entity as identified on ingot.solutions).</li>
  <li><strong>"You," "your"</strong> means the individual or organization using the Software or portal.</li>
</ul></div>
<div class="legal-section" id="s2"><h2>2. Acceptance</h2><p>By installing, accessing, or using the Software, or by submitting a signup form to obtain a product key, you confirm that you have read these Terms, that you are authorized to bind yourself (and, if applicable, your employer) to them, and that you agree to be bound.</p></div>
<div class="legal-section" id="s3"><h2>3. Nature of the Service (AI Analysis)</h2><p>The Software uses artificial intelligence to suggest whether an email may be spam, phishing, or otherwise suspicious. Outputs are <strong>probabilistic</strong> and may be <strong>wrong</strong>. The Software is a <strong>supplement</strong> to—not a replacement for—your own judgment, security tooling, policies, and training. <strong>You remain solely responsible</strong> for decisions you make about emails, links, attachments, and data handling.</p></div>
<div class="legal-section" id="s4"><h2>4. Disclaimer of Warranties</h2><p class="legal-caps">TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SOFTWARE IS PROVIDED "AS IS" AND "AS AVAILABLE." INGOT SOLUTIONS DISCLAIMS ALL WARRANTIES, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SOFTWARE WILL BE ERROR-FREE, UNINTERRUPTED, OR FREE OF HARMFUL COMPONENTS.</p></div>
<div class="legal-section" id="s5"><h2>5. Limitation of Liability</h2>
  <p class="legal-caps">TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT SHALL INGOT SOLUTIONS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, GOODWILL, OR BUSINESS, ARISING OUT OF OR RELATED TO THESE TERMS OR THE SOFTWARE.</p>
  <p class="legal-caps" style="margin-top:.75rem;">INGOT SOLUTIONS' TOTAL AGGREGATE LIABILITY SHALL NOT EXCEED THE GREATER OF (A) AMOUNTS YOU PAID IN THE TWELVE (12) MONTHS BEFORE THE CLAIM, OR (B) USD $100 IF NO FEES APPLIED.</p>
  <p style="margin-top:.75rem;"><strong>Email misclassification:</strong> You expressly acknowledge that Ingot Solutions shall not be liable for any loss or damage resulting from incorrect classification of email, including security incidents, financial loss, or regulatory exposure.</p>
</div>
<div class="legal-section" id="s6"><h2>6. Indemnity</h2><p>You will defend, indemnify, and hold harmless Ingot Solutions and its officers, directors, employees, and agents from and against any claims, damages, losses, liabilities, costs, and expenses (including reasonable legal fees) arising out of or related to: (a) your use of the Software; (b) your violation of these Terms; (c) your violation of any law or third-party right; or (d) data you submit through the Software or signup portal.</p></div>
<div class="legal-section" id="s7"><h2>7. License and Restrictions</h2><p>Subject to these Terms, Ingot Solutions grants you a limited, non-exclusive, non-transferable, revocable license to use the Software. You may not reverse engineer, resell, sublicense, or use the Software to build a competing product. Product keys are for your internal use only.</p></div>
<div class="legal-section" id="s8"><h2>8. Signup Portal and Account Data</h2><p>If you request a product key through the signup portal, you may be asked to provide <strong>name, work email, phone number, company name, and mailing address.</strong> That information is used to fulfill your request, operate licensing, and communicate with you. It is not sold.</p></div>
<div class="legal-section" id="s9"><h2>9. Third-Party Services</h2><p>The Software relies on infrastructure and AI providers including Supabase and Anthropic. Your use is also subject to their applicable terms and policies.</p></div>
<div class="legal-section" id="s10"><h2>10. Privacy</h2><p>Personal data collected through the extension and related services is described in our <strong>Privacy Policy</strong> (see the Privacy page in this portal).</p></div>
<div class="legal-section" id="s11"><h2>11. Intellectual Property</h2><p>The Software, branding, and documentation are owned by Ingot Solutions or its licensors. Except for the limited license above, no rights are granted.</p></div>
<div class="legal-section" id="s12"><h2>12. Suspension and Termination</h2><p>We may suspend or terminate access if you breach these Terms, if required by law, or to protect security. Provisions that by nature should survive termination do survive.</p></div>
<div class="legal-section" id="s13"><h2>13. Changes to These Terms</h2><p>We may update these Terms by posting a revised version. Continued use after changes constitutes acceptance.</p></div>
<div class="legal-section" id="s14"><h2>14. Governing Law and Venue</h2><p>These Terms are governed by the laws of the <strong>Province of Alberta</strong> and the federal laws of <strong>Canada</strong>. You attorn to the exclusive jurisdiction of the courts located in Alberta.</p></div>
<div class="legal-section" id="s15"><h2>15. General</h2><p>If any provision is unenforceable, the remainder remains in effect. These Terms constitute the entire agreement regarding the Software.</p></div>
<div class="legal-section" id="s16"><h2>16. Contact</h2><p>For questions about these Terms, contact Ingot Solutions at ingot.solutions or through the support channels provided with your license.</p></div>
<div class="legal-footer">© 2026 Ingot Solutions. All rights reserved. &nbsp;·&nbsp; Version 1.3</div>
</div>""", unsafe_allow_html=True)


# ── Privacy page ───────────────────────────────────────────────────────────────
def render_privacy_content() -> None:
    st.markdown("""
<div class="legal-container">
<div class="legal-hero" style="background:linear-gradient(135deg,#0f172a 0%,#1a4731 100%);">
  <h1>🔒 Privacy Policy</h1>
  <p>Clarivise (Scan &amp; Shield) — Ingot Solutions &nbsp;·&nbsp; Last updated: May 9, 2026</p>
</div>
<div class="legal-section"><h2>Overview</h2><p>Clarivise is a suite of AI-powered email security products for Microsoft 365. <strong>Clarivise Scan</strong> is a Chrome extension for on-demand email analysis in Outlook Web. <strong>Clarivise Shield</strong> is a mail transport pipeline that automatically analyzes inbound email at the M365 layer. This policy covers both products.</p></div>
<div class="legal-section"><h2>Product Key Signup Portal</h2><p>If you request a product key through the signup portal, you provide <strong>first name, last name, phone number, company name, and mailing address</strong> via Supabase Auth. That information is used to issue and manage keys, operate the service, and contact you if needed. It is <strong>not sold</strong>.</p></div>
<div class="legal-section"><h2>Clarivise Scan — Data Collected</h2><p>When you click <strong>Analyze Email</strong>, the following is sent to the Supabase proxy:</p>
<ul>
  <li>Email subject line, sender display name, recipient</li>
  <li>Email body text (up to 3,000 characters)</li>
  <li>Hyperlink display text and destination domains</li>
  <li>Attachment file names (if present)</li>
  <li>Whether Outlook flagged the sender as external</li>
  <li>Optional: your organization domain and custom instructions</li>
</ul></div>
<div class="legal-section"><h2>Clarivise Shield — Data Collected</h2><p>For every inbound external email, Shield receives and processes:</p>
<ul>
  <li>Email subject line, sender, recipient</li>
  <li>Email body text (up to 3,000 characters)</li>
  <li>Hyperlink display text and destination domains</li>
  <li>Attachment file names (if present)</li>
  <li>M365 message ID and internet message ID</li>
</ul>
<p style="margin-top:.6rem;">Shield logs verdict metadata (verdict, scores, sender, subject, action taken) to a Supabase database. <strong>Full message body text is not stored.</strong></p></div>
<div class="legal-section"><h2>Data Flow</h2>
<table>
  <tr><th>Step</th><th>What happens</th><th>Who can see email content?</th></tr>
  <tr><td>Your browser / M365</td><td>Email data extracted and sent over HTTPS</td><td>You / your org only</td></tr>
  <tr><td>Supabase Edge Function</td><td>Validates token, builds AI prompt, forwards to Anthropic</td><td>In memory only — not logged by Supabase</td></tr>
  <tr><td>Anthropic API</td><td>Analyzes the email and returns a verdict</td><td>Anthropic (see below)</td></tr>
  <tr><td>Response</td><td>Verdict returned and displayed / actioned</td><td>You / your org admin</td></tr>
</table></div>
<div class="legal-section"><h2>Anthropic API</h2><ul>
  <li>API inputs are <strong>not used for model training</strong> by default.</li>
  <li>API data may be <strong>retained for up to 30 days</strong> for trust and safety purposes, then deleted.</li>
  <li>Your use is subject to Anthropic's Privacy Policy and Terms of Service.</li>
</ul></div>
<div class="legal-section"><h2>Data Sharing</h2><p>We do not sell, share, or disclose user data to any third party. Email data is transmitted only to <strong>Supabase</strong> (infrastructure, data processor) and <strong>Anthropic</strong> (AI analysis). No other parties receive any data.</p></div>
<div class="legal-section"><h2>Children's Privacy</h2><p>These products are not directed at children under 13 and do not knowingly collect data from children.</p></div>
<div class="legal-section"><h2>Changes to This Policy</h2><p>This policy may be updated periodically. The date at the top reflects the most recent revision. Continued use constitutes acceptance.</p></div>
<div class="legal-section"><h2>Contact</h2><p>For privacy questions, contact Ingot Solutions at ingot.solutions or through the support channels provided with your license.</p></div>
<div class="legal-footer">© 2026 Ingot Solutions. All rights reserved.</div>
</div>""", unsafe_allow_html=True)


# ── Supabase helpers ────────────────────────────────────────────────────────────
def get_supabase() -> Client:
    url = _secret("SUPABASE_URL")
    key = _secret("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        st.error("**Supabase credentials are not configured.**")
        st.stop()
    return create_client(url, key)

def ensure_org(sb: Client, company: str) -> str:
    default = (st.secrets.get("DEFAULT_ORG_ID") or "").strip()
    if default:
        return default
    row = sb.table("organizations").insert({"name": company.strip()[:200], "slug": slugify_company(company), "plan": "trial", "seat_limit": 5}).execute()
    if not row.data:
        raise RuntimeError("Could not create organization.")
    return row.data[0]["id"]


# ── Page config ─────────────────────────────────────────────────────────────────
def _configure_streamlit(page_key: str) -> None:
    flag = f"_portal_st_config_{page_key}"
    if st.session_state.get(flag):
        return
    configs = {
        "home":    ("Clarivise — AI Email Security", "🛡️"),
        "key":     ("Request a Product Key", "🔑"),
        "terms":   ("Terms and Conditions", "📋"),
        "privacy": ("Privacy Policy", "🔒"),
    }
    title, icon = configs.get(page_key, ("Clarivise", "🛡️"))
    st.set_page_config(page_title=title, page_icon=icon, layout="wide", initial_sidebar_state="expanded")
    st.session_state[flag] = True

def _redirect_if_query_param() -> None:
    raw = st.query_params.get("page")
    if raw is None:
        return
    q = str(raw[0] if isinstance(raw, list) and raw else raw).lower().strip()
    dest = {
        "key": PAGE_REQUEST_KEY, "request": PAGE_REQUEST_KEY, "get-key": PAGE_REQUEST_KEY,
        "terms": PAGE_TERMS, "tos": PAGE_TERMS, "legal": PAGE_TERMS,
        "privacy": PAGE_PRIVACY, "policy": PAGE_PRIVACY,
    }.get(q)
    if dest:
        try:
            st.switch_page(dest)
        except Exception:
            pass


# ── Key request form ────────────────────────────────────────────────────────────
def _render_key_request_form(anon: Client, p: dict[str, str]) -> None:
    auth_user = get_auth_user(anon)
    if auth_user:
        ac1, ac2 = st.columns([4, 1])
        with ac1:
            st.caption(f"Signed in as **{_user_email(auth_user)}**")
        with ac2:
            if st.button("Sign out", type="secondary"):
                sign_out_user(anon)
                st.rerun()
    else:
        t_reg, t_in = st.tabs(["Create account", "Sign in"])
        with t_reg:
            with st.form("register"):
                r_email = st.text_input("Email", key="reg_email_f")
                r_pw    = st.text_input("Password", type="password", key="reg_pw_f", help=f"At least {MIN_PASSWORD_LEN} characters.")
                r_pw2   = st.text_input("Confirm password", type="password", key="reg_pw2_f")
                reg_btn = st.form_submit_button("Create account")
            if reg_btn:
                em = (r_email or "").strip()
                if "@" not in em or len(em) > 254:
                    st.error("Enter a valid email.")
                elif len(r_pw or "") < MIN_PASSWORD_LEN:
                    st.error(f"Password must be at least {MIN_PASSWORD_LEN} characters.")
                elif r_pw != r_pw2:
                    st.error("Passwords do not match.")
                else:
                    try:
                        res = anon.auth.sign_up({"email": em, "password": r_pw})
                        sess = getattr(res, "session", None)
                        if sess:
                            _persist_auth_session(sess)
                            st.rerun()
                        st.success("Check your inbox to confirm your email, then use **Sign in**.")
                    except Exception as ex:
                        st.error(_auth_error_message(ex))
        with t_in:
            with st.form("login"):
                l_email   = st.text_input("Email", key="login_email_f")
                l_pw      = st.text_input("Password", type="password", key="login_pw_f")
                login_btn = st.form_submit_button("Sign in")
            if login_btn:
                try:
                    res = anon.auth.sign_in_with_password({"email": (l_email or "").strip(), "password": l_pw})
                    sess = getattr(res, "session", None)
                    if not sess:
                        st.error("No session returned. Confirm your email or reset your password.")
                    else:
                        _persist_auth_session(sess)
                        st.rerun()
                except Exception as ex:
                    st.error(_auth_error_message(ex))

    auth_user = get_auth_user(anon)
    if not auth_user:
        st.info("Create an account or sign in to request a **Clarivise Scan product key**.")
        return

    st.divider()
    st.markdown("#### Company & key details")
    email_login = _user_email(auth_user)
    st.caption(f"Work email for this key: **{email_login}**. Paste the key in the extension under **Connection → Extension Token** after installing.")

    portal_secret = (st.secrets.get("PORTAL_SIGNUP_SECRET") or "").strip()

    with st.form("signup"):
        if portal_secret:
            invite = st.text_input("Signup passphrase", type="password", help="Provided by your administrator.")
        else:
            invite = ""
        c1, c2 = st.columns(2)
        with c1:
            first_name = st.text_input("First name", placeholder="Jane")
        with c2:
            last_name = st.text_input("Last name", placeholder="Doe")
        phone   = st.text_input("Phone", placeholder="+1 555 123 4567")
        company = st.text_input("Company / team name", placeholder="Acme Corp")
        st.markdown("**Mailing address**")
        address_line1 = st.text_input("Street address", placeholder="123 Main St")
        address_line2 = st.text_input("Apt, suite, etc. (optional)")
        ac1, ac2 = st.columns(2)
        with ac1:
            city = st.text_input("City", placeholder="Calgary")
        with ac2:
            region = st.text_input("State / province / region", placeholder="AB")
        ap1, ap2 = st.columns(2)
        with ap1:
            postal_code = st.text_input("Postal code", placeholder="T2P 0A1")
        with ap2:
            country = st.text_input("Country", placeholder="Canada")
        license_type = st.selectbox("License", options=["trial", "annual"], format_func=lambda x: "Trial (15 days)" if x == "trial" else "Annual (365 days)")
        st.markdown("Legal: [Terms and Conditions](pages/2_Terms.py) · [Privacy Policy](pages/3_Privacy.py)")
        agree_terms = st.checkbox("I have read and agree to the Terms and Conditions and Privacy Policy.", value=False)
        submitted = st.form_submit_button("Generate my key")

    if not submitted:
        st.caption("Keys are shown **once**. Store them safely.")
        return

    if portal_secret and invite != portal_secret:
        st.error("Invalid signup passphrase.")
        return
    if not agree_terms:
        st.error("You must agree to the Terms and Conditions and Privacy Policy to receive a key.")
        return

    au = get_auth_user(anon)
    if not au:
        st.error("Your session expired. Sign in again.")
        return

    email         = _user_email(au)
    first_name    = (first_name or "").strip()
    last_name     = (last_name or "").strip()
    phone         = (phone or "").strip()
    company       = (company or "").strip()
    address_line1 = (address_line1 or "").strip()
    address_line2 = (address_line2 or "").strip()
    city          = (city or "").strip()
    region        = (region or "").strip()
    postal_code   = (postal_code or "").strip()
    country       = (country or "").strip()

    if not first_name:  st.error("Please enter your first name."); return
    if not last_name:   st.error("Please enter your last name."); return
    if not validate_phone(phone): st.error("Please enter a valid phone number."); return
    if not company or len(company) < 2: st.error("Please enter your company or team name."); return
    if not address_line1: st.error("Please enter a street address."); return
    if not city:          st.error("Please enter a city."); return
    if not region:        st.error("Please enter a state, province, or region."); return
    if not postal_code:   st.error("Please enter a postal code."); return
    if not country:       st.error("Please enter a country."); return

    try:
        sb        = get_supabase()
        org_id    = ensure_org(sb, company)
        full_name = f"{first_name} {last_name}".strip()[:300]
        auth_uid  = str(getattr(au, "id", "") or "")
        cust = sb.table("customers").insert({
            "org_id": org_id, "email": email[:254], "company_name": company[:200],
            "full_name": full_name, "first_name": first_name[:100], "last_name": last_name[:100],
            "phone": phone[:32], "address_line1": address_line1[:200],
            "address_line2": address_line2[:200] if address_line2 else None,
            "city": city[:100], "region": region[:100], "postal_code": postal_code[:32],
            "country": country[:100], "signup_source": "streamlit",
            "auth_user_id": auth_uid if auth_uid else None,
        }).execute()
        if not cust.data:
            raise RuntimeError("Could not create customer record.")
        plain      = gen_token_plain()
        token_hash = hash_token(plain)
        exp        = expires_at_iso(license_type)
        ins = sb.table("extension_tokens").insert({
            "token_hash": token_hash, "label": company[:200], "user_email": email[:254],
            "org_id": org_id, "customer_id": cust.data[0]["id"],
            "license_type": license_type, "expires_at": exp,
        }).execute()
        if not ins.data:
            raise RuntimeError("Insert returned no row.")
    except Exception as e:
        err = str(e).lower()
        if "unique" in err and "customers" in err:
            st.error("A record for this email already exists. Contact your administrator if you need a new key.")
        else:
            st.error(f"Could not create key: {e}")
        return

    st.success("Your key is ready — copy it now. It cannot be shown again.")
    st.code(plain, language="text")
    st.info(
        f"**License:** {license_type} · **Valid until (UTC):** {exp}\n\n"
        "In Chrome: extension icon → **Connection** → paste the key → Save → open Outlook on the web and use **Analyze Email**."
    )


# ── Page entry points ───────────────────────────────────────────────────────────
def run_home_page() -> None:
    _configure_streamlit("home")
    _redirect_if_query_param()
    p = _portal_bootstrap()
    _inject_saas_theme()
    render_sidebar_navigation(p)
    render_in_page_navigation(p)
    render_portal_landing(p)
    render_home_cta(get_anon_client(), p)

def run_terms_page() -> None:
    _configure_streamlit("terms")
    p = _portal_bootstrap()
    _inject_saas_theme()
    render_sidebar_navigation(p)
    render_in_page_navigation(p)
    render_terms_content()

def run_privacy_page() -> None:
    _configure_streamlit("privacy")
    p = _portal_bootstrap()
    _inject_saas_theme()
    render_sidebar_navigation(p)
    render_in_page_navigation(p)
    render_privacy_content()

def run_key_request_page() -> None:
    _configure_streamlit("key")
    p = _portal_bootstrap()
    _inject_saas_theme()
    render_sidebar_navigation(p)
    render_in_page_navigation(p)
    st.caption("**Clarivise Scan** — sign in, then complete the form to generate your extension token.")
    st.markdown("#### Account")
    anon = get_anon_client()
    if not anon:
        st.error("**SUPABASE_ANON_KEY** is missing from Streamlit secrets.")
        st.stop()
    _render_key_request_form(anon, p)

def main() -> None:
    run_home_page()

if __name__ == "__main__":
    main()
