"""
Clarivise — AI-powered email security platform.
Two product lines: Clarivise Scan and Clarivise Shield.
"""

import streamlit as st

st.set_page_config(page_title="Clarivise", page_icon="🛡️", layout="wide")

# KILL ALL PADDING - ZERO SPACING
st.markdown("""
<style>
    .block-container { padding: 0 !important; margin: 0 !important; }
    [data-testid="stMainBlockContainer"] { padding: 0 !important; margin: 0 !important; }
    [data-testid="stAppViewContainer"] { padding: 0 !important; margin: 0 !important; }
    main { padding: 0 !important; margin: 0 !important; }
</style>
""", unsafe_allow_html=True)

# ── Navigation ─────────────────────────────────────────────────────────────────
st.markdown("### Clarivise")
st.caption("AI-powered email security")
st.divider()

c1, c2, c3, c4, c5, c6 = st.columns(6)
with c1:
    st.write("🏠 **[Home](streamlit_app.py)**")
with c2:
    st.write("🔑 **[Get a Key](pages/1_Request_a_key.py)**")
with c3:
    st.write("📄 **[Guides](pages/4_Download_Guides.py)**")
with c4:
    st.write("❓ **[FAQ](pages/5_FAQ.py)**")
with c5:
    st.write("📋 **[Terms](pages/2_Terms.py)**")
with c6:
    st.write("🔒 **[Privacy](pages/3_Privacy.py)**")

st.divider()

# ── Content ────────────────────────────────────────────────────────────────────
st.markdown("## Welcome to Clarivise")
st.markdown("""
**AI-powered email security for Microsoft 365**

Two products:
- **Clarivise Scan** — On-demand analysis in Outlook
- **Clarivise Shield** — Automatic protection at mail transport layer

[Get Started](pages/1_Request_a_key.py)
""")
