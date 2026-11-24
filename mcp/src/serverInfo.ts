import { createRequire } from "node:module";

// Shared server-level identity (MCP 2025-06-18 InitializeResult.serverInfo
// name/title/version, plus InitializeResult.instructions). Used by:
//   - mcp/src/index.ts        — the stdio server (npx @airlock/mcp)
//   - server/src/routes/mcp.ts — the hosted streamable-HTTP /mcp endpoint
//   - server's .well-known/mcp/server-card.json
// Keeping these in one place means all three can never drift from each
// other, same reasoning as toolDefs.ts.

// Read from mcp/package.json, not server/package.json: this is the version
// MCP clients see in serverInfo.version and the server card, and it has to
// track @airlock/mcp (the published stdio package + the shared tool
// definitions this hosted endpoint re-exports) — not @airlock/server's own
// internal version, which is what used to leak in here (serverInfo reported
// server/package.json's 0.1.0 while @airlock/mcp was already at 0.1.2).
const _require = createRequire(import.meta.url);
export const VERSION: string = (_require("../package.json") as { version: string }).version;

// Matches @airlock/mcp's own package/npm identity (same convention
// @briefgate/mcp uses for its serverInfo.name) — nothing else depends on
// this string, but directories that have already indexed the server under
// this name would otherwise see it change for no behavioral reason.
export const SERVER_NAME = "@airlock/mcp";
export const SERVER_TITLE = "Airlock";

// MCP 2025-06-18 InitializeResult.instructions — surfaced to the model once
// per session (e.g. by `claude mcp add`), so a client can decide WHEN to
// reach for these tools without first reading every individual tool
// description. Plain and honest, not marketing copy: what Airlock is for,
// when to use it, and the push/await/report loop.
export const INSTRUCTIONS = `
Airlock is a human-in-the-loop approval inbox: before an irreversible or outward-facing action (sending a message, posting publicly, spending money, touching production), submit it with airlock_push_action and wait for a person to approve, edit, or reject it. Use it for decisions only a human should make, not for questions the person in this conversation can already answer.

Flow: airlock_push_action returns an action_id. Call airlock_await_decision(action_id); "pending" after a timeout is normal — call it again. On "approved", use the returned preview/payload (it reflects any reviewer edits), carry out the action, then call airlock_report_result with "executed" or "execute_failed". On "rejected", do not proceed.

airlock_create_watcher and airlock_create_watcher_from_preset set up watchers that feed matching items from external sources (RSS, Reddit, GitHub, URL diffs) into this same approval inbox.
`.trim();
