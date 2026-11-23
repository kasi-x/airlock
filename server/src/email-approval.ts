/**
 * Safe email approval tokens — stateless HMAC-signed capability tokens that
 * let an email notification recipient approve or reject an action without a
 * web-inbox session.
 *
 * Design: notify-kit docs/design/email-approval.md.
 *
 * Token format: `<base64url payload>.<base64url sig>`
 *   payload = { v: 1, a: actionId, p: projectId, e: expiresAtUnix }
 *   sig     = HMAC-SHA256(key, "email-approval:v1:" + payloadB64)
 *   key     = projects.webhook_secret ?? WEBHOOK_SECRET
 *
 * No DB row: single-decision is already enforced by UNIQUE(action_id) on
 * decisions plus the status='pending' check in commitInteractiveDecision.
 * The token deliberately stays valid after a decision so re-opening the link
 * shows the receipt instead of an error.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.js';
import { nowSec } from './db.js';
const TOKEN_VERSION = 1;
const MAX_TOKEN_TTL_SEC = 7 * 24 * 3600;
const HMAC_PREFIX = 'email-approval:v1:';

export interface ApprovalPayload {
  v: number;
  a: string; // action id
  p: string; // project id
  e: number; // expires at (unix seconds)
}

/** Action columns the approval page and decision commit need. */
export interface ApprovalActionRow {
  id: string;
  project_id: string;
  status: string;
  title: string;
  kind: string;
  preview: string;   // JSON text
  payload: string | null; // JSON text
  created_at: number;
  expires_at: number | null;
  callback_url: string | null;
}

export type ApprovalTokenState =
  | { state: 'valid'; actionId: string; projectId: string; action: ApprovalActionRow }
  | { state: 'invalid' }
  | { state: 'expired' };

/** HMAC signature over an already-encoded payload. Exported for tests. */
export function signApprovalPayload(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${HMAC_PREFIX}${payloadB64}`)
    .digest('base64url');
}

// Same fallback chain as webhook signing (webhooks.ts): per-project secret
// first, instance WEBHOOK_SECRET for rows that predate it.
function projectSecret(db: Db, projectId: string): string | null {
  const row = db.prepare('SELECT webhook_secret FROM projects WHERE id = ?')
    .get(projectId) as { webhook_secret: string | null } | undefined;
  if (!row) return null;
  return row.webhook_secret ?? process.env.WEBHOOK_SECRET ?? 'change-me-in-production';
}

/** Public origin that fronts the API (/v1). */
export function apiBaseUrl(): string {
  return process.env.BASE_URL
    ?? process.env.APP_URL
    ?? `http://localhost:${Number(process.env.PORT ?? 8484)}`;
}

/**
 * Mint a token for an action. Returns null when the action does not exist.
 * Expiry = min(now + 7d, action.expires_at) so a token never outlives the
 * request it decides (and pending actions without expires_at still expire).
 */
export function mintApprovalToken(db: Db, actionId: string): string | null {
  const action = db.prepare('SELECT id, project_id, expires_at FROM actions WHERE id = ?')
    .get(actionId) as { id: string; project_id: string; expires_at: number | null } | undefined;
  if (!action) return null;

  const cap = nowSec() + MAX_TOKEN_TTL_SEC;
  const exp = action.expires_at !== null && action.expires_at < cap ? action.expires_at : cap;

  const payload: ApprovalPayload = { v: TOKEN_VERSION, a: action.id, p: action.project_id, e: exp };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = signApprovalPayload(payloadB64, projectSecret(db, action.project_id)!);
  return `${payloadB64}.${sig}`;
}

/** Full approval URL for an action, or null when it cannot be minted. */
export function approvalUrlFor(db: Db, actionId: string): string | null {
  const token = mintApprovalToken(db, actionId);
  return token ? `${apiBaseUrl()}/v1/approval?token=${token}` : null;
}

function parsePayload(payloadB64: string): ApprovalPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (p.v !== TOKEN_VERSION) return null;
  if (typeof p.a !== 'string' || typeof p.p !== 'string' || typeof p.e !== 'number') return null;
  return { v: TOKEN_VERSION, a: p.a, p: p.p, e: p.e };
}

/**
 * Verify a token and load its action. The signature is checked under the
 * secret of the project named in the (unverified) payload — a forged `p`
 * cannot help an attacker because the sig must still verify under that
 * project's secret, and the action lookup is project-scoped afterwards.
 */
export function inspectApprovalToken(db: Db, token: string): ApprovalTokenState {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1 || token.indexOf('.', dot + 1) !== -1) {
    return { state: 'invalid' };
  }
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const payload = parsePayload(payloadB64);
  if (!payload) return { state: 'invalid' };

  const secret = projectSecret(db, payload.p);
  if (secret === null) return { state: 'invalid' };
  const expected = signApprovalPayload(payloadB64, secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sig, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { state: 'invalid' };

  if (payload.e <= nowSec()) return { state: 'expired' };

  const action = db.prepare(
    'SELECT id, project_id, status, title, kind, preview, payload, created_at, expires_at, callback_url FROM actions WHERE id = ? AND project_id = ?',
  ).get(payload.a, payload.p) as ApprovalActionRow | undefined;
  if (!action) return { state: 'invalid' };

  return { state: 'valid', actionId: action.id, projectId: action.project_id, action };
}
