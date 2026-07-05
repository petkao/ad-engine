"""
PinkCurve Video Discovery - Streamlit Community Cloud App

A video ad discovery assistant powered by LangGraph and MCP.
"""

import re
import traceback
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
    try:
        return st.secrets[key]
    except (KeyError, FileNotFoundError):
        pass
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
    st.markdown("This app requires the following secrets to be configured:")
    for key in missing:
        if key == "OPENAI_API_KEY":
            st.markdown(f"- **`{key}`**: Your OpenAI API key")
        elif key == "PINKCURVE_MCP_URL":
            st.markdown(f"- **`{key}`**: The PinkCurve MCP server URL")
    st.markdown("""
---
### Configure in Streamlit Cloud:
1. App settings → Secrets
2. Add in TOML format:
```toml
OPENAI_API_KEY = "sk-..."
PINKCURVE_MCP_URL = "https://ad-engine-mcp-610270819686.us-west1.run.app/mcp"
```
    """)


# -----------------------------------------------------------------------------
# Video Agent Logic
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
    except ImportError as e:
        return None, f"Missing dependency: {e}"

    MCP_URL = get_secret("PINKCURVE_MCP_URL")
    OPENAI_API_KEY = get_secret("OPENAI_API_KEY")

    SYSTEM_PROMPT = """You are PinkCurve's Video Discovery Agent. Help users find video ads from sellers.

INTENT ROUTING - Choose the right tool based on user intent:

1. SPECIFIC SEARCH (use search_video_ads_for_buyer):
   - User describes what they're looking for
   - Examples: "I need a dash cam", "looking for jewelry gifts", "car accessories"

2. BROWSE/EXPLORE (use get_featured_video_ads):
   - User wants to browse without specific intent
   - Examples: "show me what you have", "any interesting products?", "just browsing"

3. CATEGORY FILTER (use get_video_ads_by_category):
   - User asks for a specific category
   - Examples: "show me automotive products", "fashion items"

4. DISCOVER CATEGORIES (use list_categories):
   - User asks what categories exist
   - Examples: "what categories do you have?", "what types of products?"

RESPONSE FORMAT:
- Present results clearly with headline, price, seller name
- ALWAYS include the video_url so users can watch
- Keep responses concise but informative
- If no results, suggest trying a different search or browsing featured ads"""

    def _call_mcp_tool(tool_name: str, arguments: dict) -> str:
        """Call MCP tool using thread with timeout to avoid hanging."""
        import json
        import uuid
        import threading
        import queue

        result_queue = queue.Queue()

        def _do_mcp_call():
            try:
                # Initialize session
                init_response = httpx.post(
                    MCP_URL,
                    json={
                        "jsonrpc": "2.0",
                        "id": str(uuid.uuid4()),
                        "method": "initialize",
                        "params": {
                            "protocolVersion": "2024-11-05",
                            "capabilities": {},
                            "clientInfo": {"name": "pinkcurve-streamlit", "version": "2.0"}
                        }
                    },
                    headers={
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    timeout=10.0
                )

                session_id = init_response.headers.get("mcp-session-id")
                if not session_id:
                    result_queue.put(("error", f"No session ID. Status: {init_response.status_code}"))
                    return

                # Call tool
                tool_response = httpx.post(
                    MCP_URL,
                    json={
                        "jsonrpc": "2.0",
                        "id": str(uuid.uuid4()),
                        "method": "tools/call",
                        "params": {"name": tool_name, "arguments": arguments}
                    },
                    headers={
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                        "mcp-session-id": session_id
                    },
                    timeout=10.0
                )

                result_queue.put(("success", tool_response.text))

            except Exception as e:
                result_queue.put(("error", str(e)))

        # Run in background thread
        thread = threading.Thread(target=_do_mcp_call)
        thread.daemon = True
        thread.start()

        # Wait with timeout
        try:
            status, data = result_queue.get(timeout=15)
            if status == "error":
                return f"MCP Error: {data}"

            # Parse response - try JSON first, then SSE format
            try:
                parsed = json.loads(data)
                if "result" in parsed and "content" in parsed["result"]:
                    return parsed["result"]["content"][0]["text"]
                elif "error" in parsed:
                    return f"MCP Error: {parsed['error']}"
                return f"Unexpected JSON: {data[:200]}"
            except json.JSONDecodeError:
                # Try SSE format
                for line in data.split("\n"):
                    if line.startswith("data: "):
                        try:
                            parsed = json.loads(line[6:])
                            if "result" in parsed and "content" in parsed["result"]:
                                return parsed["result"]["content"][0]["text"]
                            elif "error" in parsed:
                                return f"MCP Error: {parsed['error']}"
                        except json.JSONDecodeError:
                            continue
                return f"Could not parse response: {data[:200]}"

        except queue.Empty:
            return "MCP Error: Request timed out after 15 seconds"

    @tool
    def search_video_ads_for_buyer(query: str) -> str:
        """Search for video ads matching a buyer's shopping intent using semantic matching.
        Use when user describes what they're looking for."""
        return _call_mcp_tool("search_video_ads_for_buyer", {"query": query, "limit": 6})

    @tool
    def get_featured_video_ads() -> str:
        """Get currently featured video ads. Use for browsing when user has no specific intent."""
        return _call_mcp_tool("get_featured_video_ads", {"limit": 10})

    @tool
    def get_video_ads_by_category(category: str) -> str:
        """Get video ads filtered by category. Use when user asks for a specific category."""
        return _call_mcp_tool("get_video_ads_by_category", {"category": category, "limit": 6})

    @tool
    def list_categories() -> str:
        """List all available ad categories. Use to help users discover what's available."""
        return _call_mcp_tool("list_categories", {})

    @tool
    def get_ad_details(ad_id: str) -> str:
        """Get detailed information about a specific ad by ID."""
        return _call_mcp_tool("get_ad_details", {"ad_id": ad_id})

    tools = [search_video_ads_for_buyer, get_featured_video_ads, get_video_ads_by_category,
             list_categories, get_ad_details]

    llm = ChatOpenAI(
        model="gpt-4o-mini",
        temperature=0,
        api_key=OPENAI_API_KEY
    ).bind_tools(tools)

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


def run_video_agent_with_progress(graph, user_message: str, status_placeholder) -> tuple:
    """Run video agent with progress updates. Returns (response, error_traceback)."""
    import threading
    import queue
    import time

    result_queue = queue.Queue()

    def _run_agent():
        try:
            result = graph.invoke({"messages": [{"role": "user", "content": user_message}]})
            result_queue.put(("success", result["messages"][-1].content))
        except Exception as e:
            error_tb = traceback.format_exc()
            result_queue.put(("error", f"**Error:** {str(e)}\n\n```\n{error_tb}\n```"))

    thread = threading.Thread(target=_run_agent)
    thread.daemon = True
    thread.start()

    # Show progress while waiting
    start_time = time.time()
    while thread.is_alive():
        elapsed = time.time() - start_time
        if elapsed < 5:
            status_placeholder.markdown("🔍 Searching PinkCurve video ads...")
        elif elapsed < 10:
            status_placeholder.markdown("🔍 Still searching...")
        elif elapsed < 20:
            status_placeholder.markdown("🔍 Almost there...")
        else:
            status_placeholder.markdown("🔍 Taking longer than expected...")

        try:
            status, data = result_queue.get(timeout=0.5)
            status_placeholder.empty()
            if status == "success":
                return data, None
            else:
                return None, data
        except queue.Empty:
            continue

    # Thread finished, get result
    try:
        status, data = result_queue.get(timeout=1)
        status_placeholder.empty()
        if status == "success":
            return data, None
        else:
            return None, data
    except queue.Empty:
        status_placeholder.empty()
        return None, "Request timed out"


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
            status_placeholder = st.empty()
            response, error = run_video_agent_with_progress(
                st.session_state.agent_graph, user_input, status_placeholder
            )

            if error:
                st.error("Failed to process your request")
                st.markdown(error)
                response = "Sorry, I encountered an error. Please try again."
            else:
                render_message(response)

        # Save assistant message
        st.session_state.messages.append({"role": "assistant", "content": response})


if __name__ == "__main__":
    main()
