import os
import re
import html
import resend
from dotenv import load_dotenv

# Optional: psycopg2 for database allowlist verification
try:
    import psycopg2
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False
    print("Warning: psycopg2 not installed. Email allowlist will use environment variable fallback.")
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langchain_core.messages import SystemMessage
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import ToolNode

load_dotenv()

resend.api_key = os.environ["RESEND_API_KEY"]
EMAIL_FROM = os.environ.get("EMAIL_FROM", "PinkCurve <onboarding@resend.dev>")

# ── DATABASE CONNECTION FOR ALLOWLIST ──────────────────────────
def get_db_connection():
    """Get database connection for allowlist verification."""
    if not HAS_PSYCOPG2:
        return None
    try:
        return psycopg2.connect(
            host=os.environ.get("DB_HOST", "localhost"),
            port=os.environ.get("DB_PORT", "5432"),
            database=os.environ.get("DB_NAME", "postgres"),
            user=os.environ.get("DB_USER", "postgres"),
            password=os.environ.get("DB_PASSWORD", ""),
        )
    except Exception as e:
        print(f"Database connection error: {e}")
        return None

# ── RECIPIENT ALLOWLIST CHECK ──────────────────────────────────
def is_allowed_recipient(email: str) -> bool:
    """Verify email recipient exists in sellers table."""
    if not email:
        return False

    # Normalize email
    email = email.lower().strip()

    # Try database check first
    conn = get_db_connection()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM sellers WHERE LOWER(email) = %s LIMIT 1",
                    (email,)
                )
                result = cur.fetchone()
                return result is not None
        except Exception as e:
            print(f"Allowlist check error: {e}")
        finally:
            conn.close()

    # Fallback to environment variable allowlist
    env_allowlist = os.environ.get("EMAIL_ALLOWLIST", "")
    if env_allowlist:
        allowed_emails = [e.strip().lower() for e in env_allowlist.split(",")]
        return email in allowed_emails

    # If no database and no env allowlist, fail closed
    print("Warning: No allowlist configured, blocking email")
    return False

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
    """Check if text contains prompt injection patterns."""
    if not text:
        return False
    for pattern in PROMPT_INJECTION_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return True
    return False

def sanitize_for_email(text: str) -> str:
    """Sanitize text for safe inclusion in email HTML."""
    if not text:
        return text
    # HTML escape special characters
    return html.escape(text)

SYSTEM_PROMPT = (
    "You are PinkCurve's Email Assistant. You receive a video ad URL (and "
    "optionally a headline/description) along with a recipient email address, "
    "and send an email containing the video ad link. Always confirm the email "
    "address with the user if it's missing before sending. Use the send_video_ad_email "
    "tool to actually send the email. Keep responses concise."
)


@tool
def send_video_ad_email(to_email: str, video_url: str, headline: str = "") -> str:
    """Send an email containing a PinkCurve video ad link to the given recipient.

    Args:
        to_email: The recipient's email address.
        video_url: The URL of the video ad to include.
        headline: Optional headline/title of the ad, for the email subject/body.
    """
    # Security check: prompt injection in inputs
    if contains_prompt_injection(headline) or contains_prompt_injection(video_url):
        return "Email blocked: potentially malicious content detected in input."

    # Security check: recipient allowlist
    if not is_allowed_recipient(to_email):
        return f"Email blocked: {to_email} is not in the allowed recipients list."

    # Sanitize inputs for email content
    safe_headline = sanitize_for_email(headline)
    safe_video_url = sanitize_for_email(video_url)

    subject = f"Check out this video ad: {safe_headline}" if safe_headline else "A video ad from PinkCurve"
    email_html = f"""
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #ec4899;">{safe_headline or 'A PinkCurve Video Ad'}</h2>
        <p>Here's the video ad you requested:</p>
        <p><a href="{video_url}" style="display:inline-block;padding:10px 20px;
           background:linear-gradient(135deg,#ec4899,#a855f7);color:white;
           text-decoration:none;border-radius:6px;">Watch Video</a></p>
        <p style="color:#94a3b8;font-size:13px;">{safe_video_url}</p>
      </div>
    """
    try:
        resend.Emails.send({
            "from": EMAIL_FROM,
            "to": to_email,
            "subject": subject,
            "html": email_html,
        })
        return f"Email sent successfully to {to_email}."
    except Exception as e:
        return f"Failed to send email: {e}"


tools = [send_video_ad_email]
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

graph = builder.compile()


def run_email_agent(user_message: str) -> str:
    """Run one turn of the email agent and return its final text response."""
    result = graph.invoke({"messages": [{"role": "user", "content": user_message}]})
    return result["messages"][-1].content


if __name__ == "__main__":
    response = run_email_agent(
        "Send this video ad to petkao@gmail.com: "
        "https://storage.googleapis.com/ad-engine-media-pka/ads/videos/716c5b49-1685-4291-9da2-b38393a4d89d.mp4 "
        "Headline: Diagnose before you drive"
    )
    print(response)
