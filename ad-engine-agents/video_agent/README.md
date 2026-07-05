# PinkCurve Video Discovery Agent

A LangGraph-powered video ad discovery assistant that helps users find relevant video ads from PinkCurve sellers.

## Features

- Search video ads by keyword/intent
- Browse featured video ads
- Send video ads via email (A2A integration)
- Inline video player rendering in chat

## Architecture

- **LangGraph** - AI agent orchestration with tool calling
- **MCP** - Connects to PinkCurve's Model Context Protocol server
- **OpenAI GPT-4o-mini** - Language model for understanding queries
- **Streamlit** - Chat UI with video rendering

## Deploy to Streamlit Community Cloud

### 1. Fork/Push to GitHub

Ensure your repository is on GitHub with the `video_agent/` directory.

### 2. Create New App on Streamlit Cloud

1. Go to [share.streamlit.io](https://share.streamlit.io)
2. Click "New app"
3. Select your repository
4. Set the main file path to: `ad-engine-agents/video_agent/streamlit_app.py`
5. Click "Deploy"

### 3. Configure Secrets

In your Streamlit Cloud app settings:

1. Click "Settings" → "Secrets"
2. Add your secrets in TOML format:

```toml
OPENAI_API_KEY = "sk-your-openai-api-key"
PINKCURVE_MCP_URL = "https://ad-engine-api-610270819686.us-west1.run.app/mcp"
EMAIL_AGENT_A2A_URL = "https://your-email-agent-url"  # Optional
```

### Required Secrets

| Secret | Description | Required |
|--------|-------------|----------|
| `OPENAI_API_KEY` | Your OpenAI API key | Yes |
| `PINKCURVE_MCP_URL` | PinkCurve MCP server endpoint | Yes |
| `EMAIL_AGENT_A2A_URL` | Email agent A2A endpoint | No |

## Local Development

### 1. Install Dependencies

```bash
cd ad-engine-agents/video_agent
pip install -r requirements.txt
```

### 2. Configure Secrets

```bash
cp .streamlit/secrets.toml.example .streamlit/secrets.toml
# Edit secrets.toml with your actual values
```

### 3. Run the App

```bash
streamlit run streamlit_app.py
```

The app will be available at `http://localhost:8501`

## Files

| File | Description |
|------|-------------|
| `streamlit_app.py` | Main Streamlit app (for Cloud deployment) |
| `chat_ui.py` | Original local chat UI |
| `graph.py` | LangGraph agent definition |
| `requirements.txt` | Python dependencies |
| `.streamlit/secrets.toml.example` | Secrets template |

## Live Deployment

🚀 **Live App**: [PinkCurve Video Discovery](https://pinkcurve-video.streamlit.app)

*(Update this link after deployment)*
