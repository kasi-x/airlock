"""Airlock LangChain / LangGraph integration.

Provides a human-approval gate for LangChain tools: before a wrapped tool runs,
the proposed call is submitted to the Airlock inbox for review. The agent blocks
until a human approves or rejects.

Public surface::

    from integrations.langchain import AirlockClient, AirlockApprovalTool
    from integrations.langchain import (
        AirlockError, AirlockRejected, AirlockTimeout,
        AirlockConfigError, AirlockUnauthorized,
    )

Requires Python 3.10+. The HTTP layer uses stdlib only (``urllib.request``).
``langchain-core`` is optional — ``AirlockClient`` works without it; only
``AirlockApprovalTool`` requires ``langchain-core``.
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
)
from .tool import AirlockApprovalTool

__all__ = [
    # Client
    "AirlockClient",
    # Tool wrapper (requires langchain-core)
    "AirlockApprovalTool",
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
]

__version__ = "0.1.0"
