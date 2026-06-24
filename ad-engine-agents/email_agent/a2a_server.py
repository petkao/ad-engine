"""
Lightweight A2A-style server for the Email Agent.

Implements the two core A2A concepts directly (rather than via the a2a-sdk
package, whose installed versions had incompatible/shifting APIs):

1. Agent Card discovery — GET /.well-known/agent.json
   Describes this agent's identity and skills, so other agents can discover
   what it does before calling it (the actual A2A discovery convention).

2. Message endpoint — POST /a2a/message
   Accepts a task/message and returns the agent's text response, mirroring
   A2A's task-based message exchange model.
"""

import os
from dotenv import load_dotenv
from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn

from graph import run_email_agent

load_dotenv()

PORT = int(os.environ.get("A2A_EMAIL_PORT", 9001))

app = FastAPI(title="PinkCurve Email Agent (A2A)")


AGENT_CARD = {
    "name": "PinkCurve Email Agent",
    "description": "Sends PinkCurve video ad links via email on request.",
    "url": f"http://localhost:{PORT}/",
    "version": "1.0.0",
    "skills": [
        {
            "id": "send_video_ad_email",
            "name": "Send Video Ad Email",
            "description": (
                "Sends an email containing a PinkCurve video ad link to a "
                "given recipient email address."
            ),
            "examples": [
                "Send https://example.com/video.mp4 to jane@example.com, "
                "headline: Diagnose before you drive"
            ],
        }
    ],
}


@app.get("/.well-known/agent.json")
def agent_card():
    """A2A discovery endpoint: describes this agent's identity and capabilities."""
    return AGENT_CARD


class A2AMessage(BaseModel):
    message: str


@app.post("/a2a/message")
def handle_message(payload: A2AMessage):
    """A2A task endpoint: accepts a message/task and returns the agent's response."""
    response_text = run_email_agent(payload.message)
    return {"response": response_text}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)