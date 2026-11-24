/**
 * Safe email approval links — token mint/verify + public GET/POST routes.
 *
 * Covers (design: notify-kit docs/design/email-approval.md):
 *  - mintApprovalToken: payload binding (action + project), expiry = min(7d, expires_at)
 *  - GET /v1/approval?token=… renders a form and NEVER mutates (mail-scanner safe)
 *  - malformed / tampered / expired tokens → 404 / 410 pages
 *  - POST verdict=approve|reject commits through commitInteractiveDecision,
 *    schedules the callback webhook, writes audit + pii rows
 *  - second POST → 409 receipt; exactly one decisions row (no double execution)
 *  - cross-site Origin → 403; IP rate limit → 429
 *  - token for project A cannot decide an action owned by project B
 *  - decided token still renders the receipt (link stays valid for re-reads)
 *  - email channel single send carries /v1/approval/ link
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDb, nowSec, type Db } from '../src/db.js';
import { bootstrapAdminKey, createProjectWithAdminKey } from '../src/auth.js';
import { createApp } from '../src/index.js';
import {
  mintApprovalToken,
  approvalUrlFor,
  inspectApprovalToken,
  signApprovalPayload,
} from '../src/email-approval.js';

process.env.DISABLE_WATCHER_SCHEDULER = '1';
process.env.BASE_URL = 'https://api.example.test';

const sendMail = vi.hoisted(() => vi.fn());
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail }) },
}));

interface SentMail { to: string; subject: string; text: string }

interface Ctx {
  db: Db;
  app: FastifyInstance;
  adminKey: string;
  projectId: string;
}

function mails(): SentMail[] {
  return sendMail.mock.calls.map(c => c[0] as SentMail);
}

// Create/PATCH send the confirmation email after responding. The mocked
// sendMail settles on a microtask, so one macrotask turn lets it finish.
function flushQueuedSends(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
}

async function setup(): Promise<Ctx> {
  const db = createDb(':memory:');
  const bootstrap = await bootstrapAdminKey(db);
  const app = await createApp(db);
  await app.ready();
  return { db, app, adminKey: bootstrap!.key, projectId: bootstrap!.projectId };
}

function auth(key: string) {
  return { Authorization: `Bearer ${key}` };
}

interface CreatedAction { id: string; status: string }

async function createAction(
  ctx: Pick<Ctx, 'app'>,
  key: string,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<CreatedAction> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/v1/actions',
    headers: auth(key),
    payload: {
      kind: 'test.kind',
      title,
      preview: { format: 'plain', body: title },
      ...extra,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as CreatedAction;
}

function actionStatus(db: Db, id: string): string {
  const row = db.prepare('SELECT status FROM actions WHERE id = ?').get(id) as { status: string };
  return row.status;
}

function decisionRows(db: Db, id: string): Record<string, unknown>[] {
  return db.prepare('SELECT * FROM decisions WHERE action_id = ?').all(id) as Record<string, unknown>[];
}

function getPage(ctx: Pick<Ctx, 'app'>, token: string) {
  return ctx.app.inject({ method: 'GET', url: `/v1/approval?token=${encodeURIComponent(token)}` });
}

function postDecision(
  ctx: Pick<Ctx, 'app'>,
  token: string,
  verdict: string,
  headers: Record<string, string> = {},
) {
  return ctx.app.inject({
    method: 'POST',
    url: `/v1/approval?token=${encodeURIComponent(token)}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    payload: `verdict=${encodeURIComponent(verdict)}`,
  });
}

beforeEach(() => {
  process.env.SMTP_HOST = 'smtp.test.invalid';
  sendMail.mockReset();
  sendMail.mockResolvedValue({ messageId: 'test' });
});

afterEach(() => {
  delete process.env.SMTP_HOST;
});

// ---------------------------------------------------------------------------
// Token unit tests
// ---------------------------------------------------------------------------

describe('mintApprovalToken / inspectApprovalToken', () => {
  it('mints a token bound to action + project; inspect returns valid', async () => {
    const ctx = await setup();
    const action = await createAction(ctx, ctx.adminKey, 'Token unit');

    const token = mintApprovalToken(ctx.db, action.id);
    expect(token).toBeTruthy();
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const state = inspectApprovalToken(ctx.db, token!);
    expect(state.state).toBe('valid');
    if (state.state === 'valid') {
      expect(state.actionId).toBe(action.id);
      expect(state.projectId).toBe(ctx.projectId);
    }

    // URL helper points at the API origin (BASE_URL), not the UI.
    const url = approvalUrlFor(ctx.db, action.id);
    expect(url).toBe(`https://api.example.test/v1/approval?token=${encodeURIComponent(token)}`);
  });

  it('returns null for unknown action', async () => {
    const ctx = await setup();
    expect(mintApprovalToken(ctx.db, 'act_nonexistent')).toBeNull();
    expect(approvalUrlFor(ctx.db, 'act_nonexistent')).toBeNull();
  });

  it('token expires at action.expires_at when sooner than 7d', async () => {
    const ctx = await setup();
    // expires_in minimum is 300s → expires_at ~5min out, well under 7d.
    const action = await createAction(ctx, ctx.adminKey, 'Short lived', { expires_in: 300 });
    const token = mintApprovalToken(ctx.db, action.id)!;
    const payloadB64 = token.split('.')[0];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as { e: number };
    const row = ctx.db.prepare('SELECT expires_at FROM actions WHERE id = ?').get(action.id) as { expires_at: number };
    expect(payload.e).toBe(row.expires_at);
  });

  it('inspect rejects malformed and tampered tokens', async () => {
    const ctx = await setup();
    const action = await createAction(ctx, ctx.adminKey, 'Tamper');
    const token = mintApprovalToken(ctx.db, action.id)!;

    expect(inspectApprovalToken(ctx.db, 'garbage').state).toBe('invalid');
    expect(inspectApprovalToken(ctx.db, `${token}x`).state).toBe('invalid');

    const [p, s] = token.split('.');
    const flipped = s.startsWith('A') ? `B${s.slice(1)}` : `A${s.slice(1)}`;
    expect(inspectApprovalToken(ctx.db, `${p}.${flipped}`).state).toBe('invalid');

    // Payload from another token under this signature also fails.
    const other = await createAction(ctx, ctx.adminKey, 'Other');
    const otherToken = mintApprovalToken(ctx.db, other.id)!;
    const [op] = otherToken.split('.');
    expect(inspectApprovalToken(ctx.db, `${op}.${s}`).state).toBe('invalid');
  });

  it('inspect reports expired when exp is in the past', async () => {
    const ctx = await setup();
    const action = await createAction(ctx, ctx.adminKey, 'Expire me');
    // Force the action's expiry into the past, then mint: e = expires_at < now.
    ctx.db.prepare('UPDATE actions SET expires_at = ? WHERE id = ?').run(nowSec() - 10, action.id);
    const token = mintApprovalToken(ctx.db, action.id)!;
    expect(inspectApprovalToken(ctx.db, token).state).toBe('expired');
  });
});

// ---------------------------------------------------------------------------
// GET page
// ---------------------------------------------------------------------------

describe('GET /v1/approval?token=…', () => {
  it('renders title, payload preview and both decision forms; does not mutate', async () => {
    const ctx = await setup();
    const action = await createAction(ctx, ctx.adminKey, 'Deploy v2.4', {
      payload: { service: 'api', env: 'production' },
    });
    const token = mintApprovalToken(ctx.db, action.id)!;

    const res = await getPage(ctx, token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-security-policy']).toContain("form-action 'self'");
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.body).toContain('Deploy v2.4');
    expect(res.body).toContain('test.kind');
    expect(res.body).toContain('production');
    expect(res.body).toContain('method="post"');
    expect(res.body).toContain('value="approve"');
    expect(res.body).toContain('value="reject"');
    expect(res.body).toContain("don't forward it");

    // GET never decides — this is what mail scanners do.
    expect(actionStatus(ctx.db, action.id)).toBe('pending');
    expect(decisionRows(ctx.db, action.id)).toHaveLength(0);
  });

  it('404s on malformed and tampered tokens', async () => {
    const ctx = await setup();
    const action = await createAction(ctx, ctx.adminKey, 'X');
    const token = mintApprovalToken(ctx.db, action.id)!;
    const [p, s] = token.split('.');

    for (const bad of ['garbage', `${p}.${s}x`, `${p}x.${s}`]) {
      const res = await getPage(ctx, bad);
      expect(res.statusCode).toBe(404);
      expect(res.body).toContain('not valid');
    }
  });

  it('410s on an expired token', async () => {
    const ctx = await setup();
    const action = await createAction(ctx, ctx.adminKey, 'Expired');
    ctx.db.prepare('UPDATE actions SET expires_at = ? WHERE id = ?').run(nowSec() - 10, action.id);
    const token = mintApprovalToken(ctx.db, action.id)!;
    const res = await getPage(ctx, token);
    expect(res.statusCode).toBe(410);
    expect(res.body).toContain('expired');
  });
});

// ---------------------------------------------------------------------------
// POST decision
// ---------------------------------------------------------------------------

describe('POST /v1/approval?token=…', () => {
  it('approve commits the decision, schedules webhook, writes audit', async () => {
    const ctx = await setup();
    const action = await createAction(ctx, ctx.adminKey, 'Approve me', {
      callback_url: 'http://127.0.0.1:9876/hook',
    });
    const token = mintApprovalToken(ctx.db, action.id)!;

    const res = await postDecision(ctx, token, 'approve');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Approved');
    expect(actionStatus(ctx.db, action.id)).toBe('approved');

    const decisions = decisionRows(ctx.db, action.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].verdict).toBe('approve');
    expect(decisions[0].channel).toBe('email');
    expect(decisions[0].decided_by).toBe('email:link');

    const audit = ctx.db.prepare(
      "SELECT * FROM audit_log WHERE action_id = ? AND event = 'action.approved'",
    ).get(action.id) as Record<string, unknown>;
    expect(audit).toBeTruthy();
    expect(audit.channel).toBe('email');

    const pii = ctx.db.prepare(
      "SELECT * FROM pii_log WHERE action_id = ? AND event = 'action.approved'",
    ).get(action.id) as Record<string, unknown> | undefined;
    expect(pii).toBeTruthy();

    // One delivery at action creation (upstream behavior) + one at decision.
    const deliveries = ctx.db.prepare(
      'SELECT * FROM webhook_deliveries WHERE action_id = ? ORDER BY created_at',
    ).all(action.id) as Record<string, unknown>[];
    expect(deliveries).toHaveLength(2);
    for (const d of deliveries) {
      expect(d.callback_url).toBe('http://127.0.0.1:9876/hook');
    }
  });

  it('reject commits a rejection', async () => {
    const ctx = await setup();
    const action = await createAction(ctx, ctx.adminKey, 'Reject me');
    const token = mintApprovalToken(ctx.db, action.id)!;

    const res = await postDecision(ctx, token, 'reject');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Rejected');
    expect(actionStatus(ctx.db, action.id)).toBe('rejected');
    const decisions = decisionRows(ctx.db, action.id);
    expect(decisions[0].verdict).toBe('reject');
  });

  it('second decision returns 409 receipt and keeps exactly one row', async () => {
    const ctx = await setup();
    const action = await createAction(ctx, ctx.adminKey, 'Once only');
    const token = mintApprovalToken(ctx.db, action.id)!;

    expect((await postDecision(ctx, token, 'approve')).statusCode).toBe(200);

    const again = await postDecision(ctx, token, 'reject');
    expect(again.statusCode).toBe(409);
    expect(again.body).toContain('Already decided');
    expect(again.body).toContain('approved');
    expect(actionStatus(ctx.db, action.id)).toBe('approved');
    expect(decisionRows(ctx.db, action.id)).toHaveLength(1);
  });

  it('decided token still renders a receipt on GET', async () => {
    const ctx = await setup();
    const action = await createAction(ctx, ctx.adminKey, 'Receipt');
    const token = mintApprovalToken(ctx.db, action.id)!;
    await postDecision(ctx, token, 'approve');

    const res = await getPage(ctx, token);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Approved');
    expect(res.body).not.toContain('value="approve"');
  });

  it('rejects cross-site Origin posts', async () => {
    const ctx = await setup();
    const action = await createAction(ctx, ctx.adminKey, 'CSRF');
    const token = mintApprovalToken(ctx.db, action.id)!;

    const res = await postDecision(ctx, token, 'approve', {
      origin: 'https://evil.example.com',
    });
    expect(res.statusCode).toBe(403);
    expect(actionStatus(ctx.db, action.id)).toBe('pending');
  });

  it('accepts same-origin Origin posts', async () => {
    const ctx = await setup();
    const action = await createAction(ctx, ctx.adminKey, 'Same origin');
    const token = mintApprovalToken(ctx.db, action.id)!;

    const res = await postDecision(ctx, token, 'approve', {
      origin: 'https://api.example.test',
    });
    expect(res.statusCode).toBe(200);
  });

  it('rate limits by IP after 30 requests', async () => {
    const ctx = await setup();
    const action = await createAction(ctx, ctx.adminKey, 'Rate');
    const token = mintApprovalToken(ctx.db, action.id)!;

    for (let i = 0; i < 30; i++) {
      const res = await getPage(ctx, token);
      expect(res.statusCode).toBe(200);
    }
    const blocked = await getPage(ctx, token);
    expect(blocked.statusCode).toBe(429);
  });

  it('rejects an invalid verdict value', async () => {
    const ctx = await setup();
    const action = await createAction(ctx, ctx.adminKey, 'Bad verdict');
    const token = mintApprovalToken(ctx.db, action.id)!;

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/approval?token=${encodeURIComponent(token)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'verdict=maybe',
    });
    expect(res.statusCode).toBe(400);
    expect(actionStatus(ctx.db, action.id)).toBe('pending');
  });

  it("a token signed for project B cannot decide project A's action", async () => {
    const ctx = await setup();
    const other = await createProjectWithAdminKey(ctx.db, 'Other Project');
    const action = await createAction(ctx, ctx.adminKey, 'Cross project');

    // Forge a token claiming projectId=other.projectId but pointing at A's action,
    // signed with B's webhook secret (readable here; an attacker would not know it).
    const secretRow = ctx.db.prepare('SELECT webhook_secret FROM projects WHERE id = ?')
      .get(other.projectId) as { webhook_secret: string };
    const payload = { v: 1, a: action.id, p: other.projectId, e: nowSec() + 3600 };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const forged = `${payloadB64}.${signApprovalPayload(payloadB64, secretRow.webhook_secret)}`;

    // Signature is valid under B's secret, but the action is not in B's project.
    const res = await postDecision(ctx, forged, 'approve');
    expect(res.statusCode).toBe(404);
    expect(actionStatus(ctx.db, action.id)).toBe('pending');
    expect(decisionRows(ctx.db, action.id)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Email integration
// ---------------------------------------------------------------------------

describe('email channel approval link', () => {
  async function createVerifiedEmailChannel(ctx: Ctx, address: string) {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/notification-channels',
      headers: auth(ctx.adminKey),
      payload: { name: 'Ops mail', type: 'email', config: { address } },
    });
    expect(res.statusCode).toBe(201);
    await flushQueuedSends();

    const confirmMail = mails().find(m => m.subject === 'Confirm your email for Airlock notifications');
    expect(confirmMail).toBeTruthy();
    const m = /token=([A-Za-z0-9_-]{43})/.exec(confirmMail!.text);
    expect(m).toBeTruthy();
    const confirm = await ctx.app.inject({
      method: 'POST',
      url: '/v1/notification-channels/verify',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `token=${m![1]}`,
    });
    expect(confirm.statusCode).toBe(200);
  }

  it('single email send includes an /v1/approval/ link that decides the action', async () => {
    const ctx = await setup();
    await createVerifiedEmailChannel(ctx, 'owner@example.com');
    sendMail.mockClear();

    const actionPromise = createAction(ctx, ctx.adminKey, 'Emailed action');
    // notifyChannels is fire-and-forget; wait for the SMTP mock, not a fixed delay.
    await vi.waitFor(() => {
      expect(mails().some(m => m.subject.startsWith('[Airlock] '))).toBe(true);
    });
    const action = await actionPromise;

    const mail = mails().find(m => m.subject.startsWith('[Airlock] '));
    expect(mail).toBeTruthy();
    const linkMatch = /https:\/\/api\.example\.test\/v1\/approval\?token=([A-Za-z0-9_.-]+)/.exec(mail!.text);
    expect(linkMatch).toBeTruthy();
    expect(mail!.text).toContain(`/inbox/${action.id}`);

    // The emailed link actually works end to end.
    const token = linkMatch![1];
    const page = await getPage(ctx, token);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Emailed action');

    const res = await postDecision(ctx, token, 'approve');
    expect(res.statusCode).toBe(200);
    expect(actionStatus(ctx.db, action.id)).toBe('approved');
  });
});
