import streamlit as st
from graph import run_email_agent

st.set_page_config(page_title="PinkCurve Email Assistant", page_icon="📧")
st.title("📧 PinkCurve Email Assistant")
st.caption("Paste a video ad URL and tell me where to send it.")

if "messages" not in st.session_state:
    st.session_state.messages = []

# Render existing conversation
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])

user_input = st.chat_input(
    "e.g. 'Send https://.../video.mp4 to jane@example.com, headline: Diagnose before you drive'"
)

if user_input:
    st.session_state.messages.append({"role": "user", "content": user_input})
    with st.chat_message("user"):
        st.markdown(user_input)

    with st.chat_message("assistant"):
        with st.spinner("Sending email..."):
            response = run_email_agent(user_input)
        st.markdown(response)

    st.session_state.messages.append({"role": "assistant", "content": response})
