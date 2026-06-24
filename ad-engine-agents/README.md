# PinkCurve Multi-Agent Demo (LangGraph + MCP + A2A)

A two-agent system demonstrating agent-to-agent collaboration, built for interview demo purposes. Both agents are independently implemented LangGraph StateGraphs, connected via MCP (agent-to-tool) and a custom A2A-style protocol (agent-to-agent).

## Architecture

Video Agent (LangGraph, Streamlit UI :8501)
  --> MCP --> PinkCurve MCP Server (public, Cloud Run): search_video_ads, get_video_ads
  --> A2A (custom): GET /.well-known/agent.json (discovery), POST /a2a/message (task)
      --> Email Agent (LangGraph, A2A server :9001, Streamlit UI :8502)
          --> Resend API (sends real email)

## Components

- `video_agent/graph.py` — LangGraph StateGraph (hand-built, not using create_agent). Two tools: search_video_ads / get_featured_video_ads, both calling the public PinkCurve MCP server over the Streamable HTTP transport. A third tool, send_video_ad_via_email, calls the Email Agent via A2A.
- `video_agent/chat_ui.py` — Streamlit chatbot for buyers to search video ads. Renders any .mp4 URLs in responses as inline playable video.
- `email_agent/graph.py` — LangGraph StateGraph with one tool, send_video_ad_email, which sends an email via Resend containing a video ad link.
- `email_agent/chat_ui.py` — Streamlit chatbot for manually testing the email agent.
- `email_agent/a2a_server.py` — Exposes the Email Agent over HTTP for agent-to-agent calls, implementing the two core A2A protocol concepts:
  - GET /.well-known/agent.json — Agent Card discovery (the real A2A discovery convention)
  - POST /a2a/message — task/message exchange

**Note on A2A implementation:** the official a2a-sdk Python package (tested versions 1.1.0 and 0.2.16) did not expose the AgentExecutor / A2AStarletteApplication classes referenced in public A2A tutorials — both installed versions had a different internal structure (gRPC/database-oriented). Rather than fight an SDK version mismatch, the A2A server here is a small custom FastAPI implementation of the same two core concepts (Agent Card discovery + message-based task exchange), built directly on the protocol spec.

## Why raw StateGraph instead of create_agent

Both agents use LangGraph's StateGraph directly — defining agent and tools nodes and wiring the conditional edges by hand — rather than LangChain's create_agent/create_react_agent convenience wrapper. This was a deliberate choice to demonstrate full control over the agent loop (the classic ReAct pattern: call LLM, check for tool calls, execute tools, loop) for interview purposes, even though create_agent would have been faster to write.

## Demo Flow

1. Open the Video Agent chat (localhost:8501), ask something like "Show me car gadgets" — get back real PinkCurve video ads with inline video players.
2. Ask "Email the dash cam one to someone@example.com" — the Video Agent calls send_video_ad_via_email, which performs A2A discovery against the Email Agent, then sends the task.
3. The Email Agent's own LangGraph reasons about the request, calls Resend, and sends a real email with the video link.
4. Confirm delivery in the recipient's inbox.

## Setup

cd ad-engine-agents
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

Create a .env file with:

OPENAI_API_KEY=your_key
RESEND_API_KEY=your_key
EMAIL_FROM=PinkCurve <onboarding@resend.dev>
PINKCURVE_MCP_URL=https://ad-engine-mcp-610270819686.us-west1.run.app/mcp
EMAIL_AGENT_A2A_URL=http://localhost:9001

## Running

Three processes, each in its own terminal:

# Terminal 1 — Email Agent's A2A server
cd email_agent && python a2a_server.py

# Terminal 2 — Video Agent's chatbot UI
cd video_agent && streamlit run chat_ui.py

# Terminal 3 (optional) — Email Agent's own chatbot UI, for manual testing
cd email_agent && streamlit run chat_ui.py --server.port 8502

## Tech Stack

- LangGraph — agent state machines (both agents)
- LangChain (langchain-openai) — LLM integration (GPT-4o-mini)
- MCP (mcp Python SDK) — Video Agent's connection to PinkCurve's public video ad data
- FastAPI — custom A2A-style server for the Email Agent
- Streamlit — chatbot UIs
- Resend — transactional email delivery