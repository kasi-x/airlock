// @airlock/sdk — TypeScript SDK for the Airlock human-in-the-loop approval API

export { AirlockClient } from './client.js'
export type { AirlockClientOptions } from './client.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type {
  Action,
  ActionCreated,
  ActionStatus,
  ApiKey,
  ApiKeyCreated,
  ApprovedAction,
  AuditEvent,
  AuditExportFormat,
  BulkDecisionRequest,
  BulkDecisionResponse,
  BulkDecisionResult,
  ChannelConfig,
  ChannelTestResult,
  ChannelType,
  CreateActionParams,
  CreateNotificationChannelParams,
  CreateWatcherFromPresetParams,
  CreateWatcherParams,
  Decision,
  DecisionResult,
  DiscordChannelConfig,
  EmailChannelConfig,
  ExportAuditParams,
  KeyScope,
  ListActionsParams,
  ListAuditParams,
  ListWatchersParams,
  NotificationChannel,
  NtfyChannelConfig,
  PagedResult,
  Preview,
  PresetParam,
  PreviewFormat,
  Project,
  ProjectExport,
  ResultAck,
  ScoringRule,
  SlackChannelConfig,
  TelegramChannelConfig,
  UpdateNotificationChannelParams,
  UpdateProjectParams,
  UpdateWatcherParams,
  Watcher,
  WatcherConfig,
  WatcherKind,
  WatcherPreset,
  WatcherSchedule,
  WatcherStatus,
  WatcherWithItemCount,
  WebhookChannelConfig,
  WebhookDelivery,
} from './types.js'

// ─── Errors ───────────────────────────────────────────────────────────────────

export {
  AirlockError,
  AirlockConfigError,
  AirlockUnauthorized,
  AirlockNotFound,
  AirlockConflict,
  AirlockExpired,
  AirlockRateLimited,
  AirlockQuotaExceeded,
  AirlockRejected,
  AirlockTimeout,
  AirlockValidationError,
  AirlockApiError,
  AirlockWebhookSignatureError,
} from './errors.js'

// ─── Webhook ──────────────────────────────────────────────────────────────────

export { verifyWebhook } from './webhook.js'
