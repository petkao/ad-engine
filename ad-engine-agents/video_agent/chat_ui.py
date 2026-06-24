import re
import streamlit as st
from graph import run_video_agent

VIDEO_URL_PATTERN = re.compile(r"https?://[^\s)]+\.mp4")

st.set_page_config(page_title="PinkCurve Video Ad Assistant", page_icon="🎬")
st.title("🎬 PinkCurve Video Ad Assistant")
st.caption("Tell me what you're shopping for, and I'll find matching video ads.")

if "messages" not in st.session_state:
    st.session_state.messages = []


def render_message(content: str):
    """Render assistant text, with any .mp4 links shown as inline video players."""
    st.markdown(content)
    for url in VIDEO_URL_PATTERN.findall(content):
        st.video(url)


# Render existing conversation
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        render_message(msg["content"])

# Buyer's search input
user_input = st.chat_input("What are you shopping for? (e.g. 'car gadgets', 'sustainable clothing')")

if user_input:
    st.session_state.messages.append({"role": "user", "content": user_input})
    with st.chat_message("user"):
        st.markdown(user_input)

    with st.chat_message("assistant"):
        with st.spinner("Searching PinkCurve video ads..."):
            response = run_video_agent(user_input)
        render_message(response)

    st.session_state.messages.append({"role": "assistant", "content": response})