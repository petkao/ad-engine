"""
PinkCurve Video Discovery - Streamlit Community Cloud App

A video ad discovery assistant powered by LangGraph and MCP.
"""

import re
import asyncio
import traceback

# nest_asyncio allows asyncio.run() inside Streamlit's event loop
import nest_asyncio
nest_asyncio.apply()

import streamlit as st

# Page configuration - must be first Streamlit command
st.set_page_config(
    page_title="PinkCurve Video Discovery",
    page_icon="🎬",
    layout="wide"
)

# -----------------------------------------------------------------------------
# Configuration & Secrets Handling
# -----------------------------------------------------------------------------

def get_secret(key: str, default: str = None) -> str:
    """Get a secret from st.secrets or environment, with fallback."""
    import os
    # Try st.secrets first (Streamlit Cloud)
    try:
        return st.secrets[key]
    except (KeyError, FileNotFoundError):
        pass
    # Fall back to environment variable
    return os.environ.get(key, default)


def check_required_secrets() -> list:
    """Check for required secrets and return list of missing ones."""
    required = ["OPENAI_API_KEY", "PINKCURVE_MCP_URL"]
    missing = []
    for key in required:
        if not get_secret(key):
            missing.append(key)
    return missing


# -----------------------------------------------------------------------------
# PinkCurve Branding Header
# -----------------------------------------------------------------------------

def render_header():
    """Render PinkCurve branded header."""
    st.markdown("""
    <style>
    .pinkcurve-header {
        background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%);
        padding: 1.5rem 2rem;
        border-radius: 1rem;
        margin-bottom: 1.5rem;
    }
    .pinkcurve-title {
        color: white;
        font-size: 2rem;
        font-weight: 700;
        margin: 0;
    }
    .pinkcurve-subtitle {
        color: rgba(255,255,255,0.9);
        font-size: 1rem;
        margin-top: 0.5rem;
    }
    .video-container {
        margin-top: 1rem;
    }
    </style>
    <div class="pinkcurve-header">
        <p class="pinkcurve-title">🎬 PinkCurve Video Discovery</p>
        <p class="pinkcurve-subtitle">
            Tell me what you're shopping for, and I'll find matching video ads from sellers.
        </p>
    </div>
    """, unsafe_allow_html=True)


def render_missing_secrets_error(missing: list):
    """Render helpful error message for missing secrets."""
    st.error("⚠️ Missing Required Configuration")
    st.markdown("""
    This app requires the following secrets to be configured:
    """)

    for key in missing:
        if key == "OPENAI_API_KEY":
            st.markdown(f"- **`{key}`**: Your OpenAI API key (get one at [platform.openai.com](https://platform.openai.com/api-keys))")
        elif key == "PINKCURVE_MCP_URL":
            st.markdown(f"- **`{key}`**: The PinkCurve MCP server URL")

    st.markdown("""
    ---
    ### How to Configure Secrets

    **For Streamlit Community Cloud:**
    1. Go to your app settings
    2. Click "Secrets" in the sidebar
    3. Add your secrets in TOML format:

    ```toml
    OPENAI_API_KEY = "sk-..."
    PINKCURVE_MCP_URL = "https://your-api-url/mcp"
    ```

    **For local development:**
    Create a `.streamlit/secrets.toml` file with the same format.
    """)


# -----------------------------------------------------------------------------
# Video Agent Logic (adapted from graph.py)
# -----------------------------------------------------------------------------

def setup_agent():
    """Initialize the LangGraph video agent. Returns (graph, error_message)."""
    try:
        import httpx
        from langchain_openai import ChatOpenAI
        from langchain_core.tools import tool
        from langchain_core.messages import SystemMessage
        from langgraph.graph import StateGraph, MessagesState, START, END
        from langgraph.prebuilt import ToolNode
        from mcp import ClientSession
        from mcp.client.streamable_http import streamablehttp_client
    except ImportError as e:
        return None, f"Missing dependency: {e}"

    MCP_URL = get_secret("PINKCURVE_MCP_URL")
    EMAIL_AGENT_URL = get_secret("EMAIL_AGENT_A2A_URL", "http://localhost:9001")

    SYSTEM_PROMPT = (
        "You are PinkCurve's Video Ad Assistant. Help users discover video ads "
        "matching what they're shopping for. Use the search_video_ads tool when "
        "the user describes what they want, or get_featured_video_ads if they just "
        "want to browse. If the user asks to email a video ad to someone, use the "
        "send_video_ad_via_email tool with the most relevant video_url found so far "
        "and ask for their email address if not provided. Always include the video_url "
        "in your response so the user can see it clearly. Keep responses concise."
    )

    async def _call_mcp_tool(tool_name: str, arguments: dict) -> str:
        """Call a tool on the remote PinkCurve MCP server."""
        async with streamablehttp_client(MCP_URL) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(tool_name, arguments)
                return result.content[0].text if result.content else ""

    @tool
    def search_video_ads(query: str) -> str:
        """Search PinkCurve for video ads matching a buyer's intent/query.
        Returns ad details including headline and video URL."""
        return asyncio.run(_call_mcp_tool("search_video_ads", {"query": query, "limit": 3}))

    @tool
    def get_featured_video_ads() -> str:
        """Get currently featured video ads from PinkCurve (no specific query)."""
        return asyncio.run(_call_mcp_tool("get_video_ads", {"limit": 3}))

    @tool
    def send_video_ad_via_email(to_email: str, video_url: str, headline: str = "") -> str:
        """Send a video ad to a recipient's email by calling the Email Agent via A2A."""
        message = f"Send {video_url} to {to_email}"
        if headline:
            message += f", headline: {headline}"
        try:
            response = httpx.post(
                f"{EMAIL_AGENT_URL}/a2a/message",
                json={"message": message},
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()["response"]
        except Exception as e:
            return f"Failed to reach Email Agent: {e}"

    tools = [search_video_ads, get_featured_video_ads, send_video_ad_via_email]
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0).bind_tools(tools)

    def call_model(state: MessagesState):
        messages = state["messages"]
        if not any(isinstance(m, SystemMessage) for m in messages):
            messages = [SystemMessage(content=SYSTEM_PROMPT)] + messages
        response = llm.invoke(messages)
        return {"messages": [response]}

    def should_continue(state: MessagesState):
        last_message = state["messages"][-1]
        if getattr(last_message, "tool_calls", None):
            return "tools"
        return END

    tool_node = ToolNode(tools)

    builder = StateGraph(MessagesState)
    builder.add_node("agent", call_model)
    builder.add_node("tools", tool_node)
    builder.add_edge(START, "agent")
    builder.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
    builder.add_edge("tools", "agent")

    return builder.compile(), None


def run_video_agent(graph, user_message: str) -> tuple:
    """Run one turn of the video agent and return (response, error_traceback)."""
    try:
        result = graph.invoke({"messages": [{"role": "user", "content": user_message}]})
        return result["messages"][-1].content, None
    except Exception as e:
        error_tb = traceback.format_exc()
        return None, f"**Error:** {str(e)}\n\n```\n{error_tb}\n```"


# -----------------------------------------------------------------------------
# UI Components
# -----------------------------------------------------------------------------

VIDEO_URL_PATTERN = re.compile(r"https?://[^\s)]+\.mp4")


def render_message(content: str):
    """Render assistant text, with any .mp4 links shown as inline video players."""
    st.markdown(content)
    for url in VIDEO_URL_PATTERN.findall(content):
        st.video(url)


# -----------------------------------------------------------------------------
# Main App
# -----------------------------------------------------------------------------

def main():
    render_header()

    # Check for required secrets
    missing_secrets = check_required_secrets()
    if missing_secrets:
        render_missing_secrets_error(missing_secrets)
        return

    # Initialize agent (cached in session state)
    if "agent_graph" not in st.session_state:
        with st.spinner("Initializing video agent..."):
            graph, error = setup_agent()
            if error:
                st.error(f"Failed to initialize agent: {error}")
                return
            st.session_state.agent_graph = graph

    # Initialize message history
    if "messages" not in st.session_state:
        st.session_state.messages = []

    # Render existing conversation
    for msg in st.session_state.messages:
        with st.chat_message(msg["role"]):
            render_message(msg["content"])

    # User input
    user_input = st.chat_input("What are you shopping for? (e.g. 'car gadgets', 'sustainable clothing')")

    if user_input:
        # Add user message
        st.session_state.messages.append({"role": "user", "content": user_input})
        with st.chat_message("user"):
            st.markdown(user_input)

        # Get agent response
        with st.chat_message("assistant"):
            with st.spinner("Searching PinkCurve video ads..."):
                response, error = run_video_agent(st.session_state.agent_graph, user_input)

            if error:
                st.error("Failed to process your request")
                st.markdown(error)
                response = "Sorry, I encountered an error. Please check the details above."
            else:
                render_message(response)

        # Save assistant message
        st.session_state.messages.append({"role": "assistant", "content": response})


if __name__ == "__main__":
    main()
