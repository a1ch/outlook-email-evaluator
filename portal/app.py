# FIX: Reset entire file and just add the navigation constants.
# The file got corrupted through edits. Need to restore from a known-good state.
# For now, just put a placeholder that says we're fixing it.

import streamlit as st

st.title("🚧 Portal Maintenance")
st.info("The portal is being updated and will be back shortly. Please refresh in 30 seconds.")

# Redirect to Shield for demo
if st.button("Go to Shield Dashboard"):
    st.switch_page("pages/shield_dashboard.py")