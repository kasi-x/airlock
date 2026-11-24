"""airlock-openai — Airlock human-approval integration for the OpenAI Agents SDK.

Quick start::

    import asyncio
    from agents import function_tool
    from airlock_openai import AirlockClient

    client = AirlockClient()  # reads AIRLOCK_API_KEY from env

    @function_tool
    @client.requires_approval(
        kind='email.send',
        title=lambda to, **_: f'Send email to {to}',
        preview=lambda to, body, **_: {'format': 'plain', 'body': body},
        editable=['preview.body'],
    )
    async def send_email(to: str, body: str) -> str:
        # Only executes after a human approves in the Airlock inbox
        return 'sent'

For run-level (all-or-nothing) gating, use the InputGuardrail helper::

    from airlock_openai.guardrail import make_guardrail
    from agents import Agent

    guardrail = make_guardrail(client, kind='agent.run', title='Approve agent task')
    agent = Agent(name='my-agent', input_guardrails=[guardrail], ...)
"""
from ._client import AirlockClient
from ._errors import (
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
from ._models import ApprovedAction
from ._webhook import verify_webhook

__all__ = [
    # Client
    "AirlockClient",
    # Errors
    "AirlockError",
    "AirlockConfigError",
    "AirlockUnauthorized",
    "AirlockNotFound",
    "AirlockConflict",
    "AirlockExpired",
    "AirlockRateLimited",
    "AirlockQuotaExceeded",
    "AirlockValidationError",
    "AirlockApiError",
    "AirlockRejected",
    "AirlockTimeout",
    "AirlockWebhookSignatureError",
    # Models
    "ApprovedAction",
    # Webhook helper
    "verify_webhook",
]

__version__ = "0.1.0"
