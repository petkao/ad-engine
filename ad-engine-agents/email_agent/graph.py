import os
import resend
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langchain_core.messages import SystemMessage
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import ToolNode

load_dotenv()

resend.api_key = os.environ["RESEND_API_KEY"]
EMAIL_FROM = os.environ.get("EMAIL_FROM", "PinkCurve <onboarding@resend.dev>")

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
    subject = f"Check out this video ad: {headline}" if headline else "A video ad from PinkCurve"
    html = f"""
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #ec4899;">{headline or 'A PinkCurve Video Ad'}</h2>
        <p>Here's the video ad you requested:</p>
        <p><a href="{video_url}" style="display:inline-block;padding:10px 20px;
           background:linear-gradient(135deg,#ec4899,#a855f7);color:white;
           text-decoration:none;border-radius:6px;">Watch Video</a></p>
        <p style="color:#94a3b8;font-size:13px;">{video_url}</p>
      </div>
    """
    try:
        resend.Emails.send({
            "from": EMAIL_FROM,
            "to": to_email,
            "subject": subject,
            "html": html,
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
