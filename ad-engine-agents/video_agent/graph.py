import httpx
import os
import asyncio
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langchain_core.messages import SystemMessage
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import ToolNode
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

load_dotenv()

MCP_URL = os.environ["PINKCURVE_MCP_URL"]

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
    """Call a tool on the remote PinkCurve MCP server and return the text result."""
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

EMAIL_AGENT_URL = os.environ.get("EMAIL_AGENT_A2A_URL", "http://localhost:9001")


@tool
def send_video_ad_via_email(to_email: str, video_url: str, headline: str = "") -> str:
    """Send a video ad to a recipient's email by calling the Email Agent via A2A.

    Args:
        to_email: The recipient's email address.
        video_url: The video ad URL to send.
        headline: Optional headline of the ad.
    """
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
    """Node: send the conversation so far to the LLM, including the system prompt."""
    messages = state["messages"]
    if not any(isinstance(m, SystemMessage) for m in messages):
        messages = [SystemMessage(content=SYSTEM_PROMPT)] + messages
    response = llm.invoke(messages)
    return {"messages": [response]}


def should_continue(state: MessagesState):
    """Edge logic: if the LLM asked to call a tool, route to the tool node; else end."""
    last_message = state["messages"][-1]
    if getattr(last_message, "tool_calls", None):
        return "tools"
    return END


tool_node = ToolNode(tools)

# Build the graph by hand: agent <-> tools loop
builder = StateGraph(MessagesState)
builder.add_node("agent", call_model)
builder.add_node("tools", tool_node)
builder.add_edge(START, "agent")
builder.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
builder.add_edge("tools", "agent")

graph = builder.compile()


def run_video_agent(user_message: str) -> str:
    """Run one turn of the video agent and return its final text response."""
    result = graph.invoke({"messages": [{"role": "user", "content": user_message}]})
    return result["messages"][-1].content


if __name__ == "__main__":
    response = run_video_agent("Show me something for my car")
    print(response)