"""
PinkCurve Video Discovery - Streamlit Community Cloud App

A video ad discovery assistant powered by LangGraph with MCP server integration.
"""

import re
import json
import traceback
import streamlit as st
import httpx

# Page configuration - must be first Streamlit command
st.set_page_config(
    page_title="PinkCurve Video Discovery",
    page_icon="🎬",
    layout="wide"
)

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

MCP_URL = "https://ad-engine-mcp-610270819686.us-west1.run.app/mcp"


# -----------------------------------------------------------------------------
# MCP Client
# -----------------------------------------------------------------------------

def _call_mcp_tool(tool_name: str, arguments: dict) -> dict:
    """
    Call an MCP tool on the PinkCurve MCP server.
    Uses SSE streaming with explicit timeout and breaks on first data line.
    """
    try:
        with httpx.stream(
            "POST",
            MCP_URL,
            json={
                "jsonrpc": "2.0",
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": arguments
                },
                "id": 1
            },
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream"
            },
            timeout=httpx.Timeout(connect=10.0, read=20.0, write=5.0, pool=5.0)
        ) as response:
            for line in response.iter_lines():
                if line.startswith("data: "):
                    data = json.loads(line[6:])
                    if "result" in data:
                        # Parse the content from MCP response
                        content = data["result"].get("content", [{}])
                        if content:
                            text = content[0].get("text", "{}")
                            return json.loads(text)
                    elif "error" in data:
                        return {"error": data["error"]}
                    # Break after first data line (SSE streams one result)
                    break

    except httpx.TimeoutException:
        return {"error": "MCP timeout - try again"}
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON from MCP: {str(e)}"}
    except Exception as e:
        return {"error": f"MCP error: {str(e)}"}

    return {"error": "No response from MCP server"}


# -----------------------------------------------------------------------------
# Helpers
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
    required = ["OPENAI_API_KEY"]
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
    st.markdown("""
---
### Configure in Streamlit Cloud:
1. App settings → Secrets
2. Add in TOML format:
```toml
OPENAI_API_KEY = "sk-..."
```
    """)




# -----------------------------------------------------------------------------
# Video Agent Logic
# -----------------------------------------------------------------------------

def setup_agent():
    """Initialize the LangGraph video agent. Returns (graph, error_message)."""
    try:
        from langchain_openai import ChatOpenAI
        from langchain_core.tools import tool
        from langchain_core.messages import SystemMessage
        from langgraph.graph import StateGraph, MessagesState, START, END
        from langgraph.prebuilt import ToolNode
    except ImportError as e:
        return None, f"Missing dependency: {e}"

    OPENAI_API_KEY = get_secret("OPENAI_API_KEY")

    SYSTEM_PROMPT = """You are PinkCurve's Video Discovery Agent. Help users find video ads from sellers.

INTENT ROUTING - Choose the right tool based on user intent:

1. SPECIFIC SEARCH (use search_video_ads):
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

    @tool
    def search_video_ads(query: str) -> str:
        """Search for video ads matching a buyer's shopping intent using semantic matching.
        Use when user describes what they're looking for."""
        result = _call_mcp_tool("search_video_ads_for_buyer", {"query": query, "limit": 6})
        if "error" in result:
            return f"Error searching ads: {result['error']}"
        if not result.get("ads"):
            return f'No video ads found matching "{query}". Try browsing featured ads instead.'
        return json.dumps(result, indent=2)

    @tool
    def get_featured_video_ads() -> str:
        """Get currently featured video ads. Use for browsing when user has no specific intent."""
        result = _call_mcp_tool("get_featured_video_ads", {"limit": 10})
        if "error" in result:
            return f"Error fetching featured ads: {result['error']}"
        if not result.get("ads"):
            return "No video ads currently available."
        return json.dumps(result, indent=2)

    @tool
    def get_video_ads_by_category(category: str) -> str:
        """Get video ads filtered by category. Use when user asks for a specific category."""
        result = _call_mcp_tool("get_video_ads_by_category", {"category": category, "limit": 6})
        if "error" in result:
            return f"Error fetching ads by category: {result['error']}"
        if not result.get("ads"):
            return f'No video ads found in category "{category}". Try listing categories to see what\'s available.'
        return json.dumps(result, indent=2)

    @tool
    def list_categories() -> str:
        """List all available ad categories. Use to help users discover what's available."""
        result = _call_mcp_tool("list_categories", {})
        if "error" in result:
            return f"Error fetching categories: {result['error']}"
        return json.dumps(result, indent=2)

    tools = [search_video_ads, get_featured_video_ads, get_video_ads_by_category, list_categories]

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
        if elapsed < 3:
            status_placeholder.markdown("🔍 Searching PinkCurve video ads...")
        elif elapsed < 8:
            status_placeholder.markdown("🔍 Processing results...")
        else:
            status_placeholder.markdown("🔍 Almost there...")

        try:
            status, data = result_queue.get(timeout=0.3)
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
