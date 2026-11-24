/**
 * @airlock/claude-agent-sdk
 *
 * Human-in-the-loop approval for Claude Agent SDK tool calls via Airlock.
 *
 * Main exports:
 *   - AirlockClient           — full REST API client
 *   - withAirlockApproval     — gate a Claude Agent SDK tool behind Airlock approval
 *   - makeToolResult        — build a tool_result message param
 *   - verifyWebhook         — verify an Airlock webhook delivery (standalone)
 *   - AirlockError and all subclasses
 */

// Client
export { AirlockClient } from "./client.js";
export type { RequiresApprovalOpts } from "./client.js";

// Tool wrapper
export { makeToolResult, withAirlockApproval } from "./tool.js";
export type {
  AnthropicTool,
  GatedTool,
  GatedToolOptions,
  ToolExecutor,
  ToolUseBlock,
} from "./tool.js";

// Webhook verification
export { verifyWebhook } from "./webhook.js";
export type { VerifyWebhookParams } from "./webhook.js";

// Error classes — export all so callers can narrow catches
export {
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
} from "./errors.js";

// All API types
export type {
  Action,
  ActionCreated,
  ActionStatus,
  ApiKey,
  ApiKeyCreated,
  ApprovalGateOpts,
  ApprovedAction,
  CreateActionParams,
  CreateWatcherParams,
  DecideParams,
  Decision,
  DecisionResult,
  AirlockClientConfig,
  KeyScope,
  ListActionsParams,
  ListWatchersParams,
  PagedResult,
  Preview,
  Project,
  ProjectExport,
  ReportResultParams,
  ResultAck,
  ScoringRule,
  UpdateWatcherParams,
  Watcher,
  WatcherConfig,
  WatcherKind,
  WatcherSchedule,
  WatcherStatus,
  WebhookDelivery,
} from "./types.js";
