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

Security hardening:
- Rate limiting via slowapi
- Input sanitization for prompt injection
"""

import os
import re
import time
from collections import defaultdict
from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn

from graph import run_email_agent

load_dotenv()

PORT = int(os.environ.get("A2A_EMAIL_PORT", 9001))

app = FastAPI(title="PinkCurve Email Agent (A2A)")

# ── RATE LIMITING ──────────────────────────────────────────────
# Simple in-memory rate limiter (for production, use Redis)
class RateLimiter:
    def __init__(self, max_requests: int = 10, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests = defaultdict(list)

    def is_allowed(self, client_ip: str) -> bool:
        now = time.time()
        # Clean old requests
        self.requests[client_ip] = [
            t for t in self.requests[client_ip]
            if now - t < self.window_seconds
        ]
        if len(self.requests[client_ip]) >= self.max_requests:
            return False
        self.requests[client_ip].append(now)
        return True

rate_limiter = RateLimiter(max_requests=10, window_seconds=60)

# ── PROMPT INJECTION DETECTION ─────────────────────────────────
PROMPT_INJECTION_PATTERNS = [
    r"ignore\s+(previous|above|all)\s+(instructions?|prompts?)",
    r"disregard\s+(previous|above|all)\s+(instructions?|prompts?)",
    r"forget\s+(previous|above|all)\s+(instructions?|prompts?)",
    r"new\s+instructions?:",
    r"system\s*:\s*",
    r"\[INST\]",
    r"\[/INST\]",
    r"<\|im_start\|>",
    r"<\|im_end\|>",
    r"###\s*(system|user|assistant)",
    r"you\s+are\s+now\s+",
    r"act\s+as\s+if\s+",
    r"pretend\s+(you|to)\s+",
    r"roleplay\s+as\s+",
    r"jailbreak",
    r"DAN\s*mode",
]

def contains_prompt_injection(text: str) -> bool:
    if not text:
        return False
    for pattern in PROMPT_INJECTION_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return True
    return False


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
def handle_message(payload: A2AMessage, request: Request):
    """A2A task endpoint: accepts a message/task and returns the agent's response."""
    # Rate limiting check
    client_ip = request.client.host if request.client else "unknown"
    if not rate_limiter.is_allowed(client_ip):
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please try again later."
        )

    # Prompt injection check
    if contains_prompt_injection(payload.message):
        raise HTTPException(
            status_code=400,
            detail="Request blocked: potentially malicious input detected."
        )

    response_text = run_email_agent(payload.message)
    return {"response": response_text}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)