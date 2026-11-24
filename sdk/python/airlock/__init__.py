"""Airlock Python SDK — human-in-the-loop approval API client.

Quickstart::

    import airlock
    client = airlock.AirlockClient()          # reads AIRLOCK_API_KEY from env
    action = client.create_action(
        kind="email.send",
        title="Send weekly digest to alice@example.com",
        preview={"format": "plain", "body": "Hi Alice, here's this week's digest..."},
        editable=["preview.body"],
    )
    approved = client.await_decision(action["id"])
    client.report_result(action["id"], "executed")

Cloud endpoint: set AIRLOCK_BASE_URL=https://api.airlock.dev (default: http://localhost:8484).
"""
from .client import AirlockClient, verify_webhook
from .errors import (
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
from .models import (
    Action,
    ActionCreated,
    ActionStatus,
    ApiKey,
    ApiKeyCreated,
    ApprovedAction,
    AuditEvent,
    AuditPage,
    BulkDecisionRequest,
    BulkDecisionResponse,
    BulkDecisionResult,
    ChannelTestResult,
    ChannelType,
    CreateNotificationChannelParams,
    DecisionResult,
    NotificationChannel,
    PagedResult,
    Preview,
    Project,
    ProjectExport,
    ResultAck,
    ScoringRule,
    UpdateNotificationChannelParams,
    Watcher,
    WatcherConfig,
    WatcherKind,
    WatcherPreset,
    WatcherPresetList,
    WatcherPresetParam,
    WatcherSchedule,
)

__all__ = [
    # Client
    "AirlockClient",
    "verify_webhook",
    # Errors
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
    # Models
    "AuditEvent",
    "AuditPage",
    "Preview",
    "ActionStatus",
    "ActionCreated",
    "Action",
    "DecisionResult",
    "BulkDecisionRequest",
    "BulkDecisionResult",
    "BulkDecisionResponse",
    "ResultAck",
    "PagedResult",
    "ApprovedAction",
    "ScoringRule",
    "WatcherConfig",
    "WatcherSchedule",
    "WatcherKind",
    "Watcher",
    "WatcherPresetParam",
    "WatcherPreset",
    "WatcherPresetList",
    "ApiKey",
    "ApiKeyCreated",
    "Project",
    "ProjectExport",
    # Notification channels
    "ChannelType",
    "NotificationChannel",
    "ChannelTestResult",
    "CreateNotificationChannelParams",
    "UpdateNotificationChannelParams",
]

__version__ = "0.1.0"
