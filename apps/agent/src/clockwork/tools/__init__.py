"""Tool registry -- every tool the orchestrator can call. Each is
`@tool`-decorated, typed, and docstringed (first paragraph = description,
`Args:` = parameter docs -- that's how Strands builds the tool schema)."""

from .approvals import create_approval
from .batch_a import (
    draft_reply,
    extract_requirements,
    get_thread,
    log_message,
    qualify_lead,
    recall,
)
from .scheduling import schedule_task

ALL_TOOLS = [
    recall,
    get_thread,
    log_message,
    extract_requirements,
    qualify_lead,
    draft_reply,
    schedule_task,
]

__all__ = ["ALL_TOOLS", "create_approval"]
