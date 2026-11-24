"""airlock-crewai — human-in-the-loop approval gate for CrewAI agents.

Quickstart:

    from airlock_crewai import AirlockClient, AirlockApprovalTool, AirlockRejected

    client = AirlockClient(api_key="im_...")   # or set AIRLOCK_API_KEY env var
    tool = AirlockApprovalTool(client=client, action_kind="email.send")

    # Add `tool` to a CrewAI Agent's tools list, then:
    # - The agent calls the tool with a title + body to request human approval.
    # - The call blocks until the human approves or rejects.
    # - On approval, the agent receives the (possibly edited) content.
    # - On rejection, AirlockRejected is raised.
"""
from ._client import AirlockClient, verify_webhook
from ._exceptions import (
    AirlockApiError,
    AirlockConfigError,
    AirlockConflict,
    AirlockError,
    AirlockExpired,
    AirlockNotFound,
    AirlockQuotaExceeded,
    AirlockRateLimited,
    AirlockRejected,
    AirlockTimeout,
    AirlockUnauthorized,
    AirlockValidationError,
    AirlockWebhookSignatureError,
)
from .callback import AirlockApprovalCallback
from .tool import AirlockApprovalTool

__all__ = [
    # Client
    "AirlockClient",
    "verify_webhook",
    # CrewAI integration
    "AirlockApprovalTool",
    "AirlockApprovalCallback",
    # Exceptions (all inherit from AirlockError)
    "AirlockError",
    "AirlockConfigError",
    "AirlockUnauthorized",
    "AirlockNotFound",
    "AirlockConflict",
    "AirlockExpired",
    "AirlockRateLimited",
    "AirlockQuotaExceeded",
    "AirlockRejected",
    "AirlockTimeout",
    "AirlockValidationError",
    "AirlockApiError",
    "AirlockWebhookSignatureError",
]
