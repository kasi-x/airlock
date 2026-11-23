/**
 * GET/POST /v1/approval/:token — public email approval pages.
 *
 * The token (see email-approval.ts) is the credential: an HMAC-signed
 * capability bound to one action and one project, expiring with the action
 * (max 7 days). No API key, no session.
 *
 * Safety properties:
 *   - GET NEVER mutates: mail scanners and link previews only ever see the
 *     form. The decision commits exclusively via POST.
 *   - POST is a browser form post (application/x-www-form-urlencoded); a
 *     cross-site Origin or Sec-Fetch-Site is rejected, and the page CSP
 *     restricts form-action to 'self'.
 *   - Single decision is enforced by commitInteractiveDecision
 *     (UNIQUE(action_id) + status='pending'); a second POST gets a 409
 *     receipt, never a second decision row.
 *   - IP rate limit shared by GET and POST (30/min), same as the channel
 *     verification pages.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db.js';
import { checkRateLimit } from '../auth.js';
import { htmlEscape } from '../notify.js';
import { sendHtmlPage } from '../html-page.js';
import { scheduleWebhookDelivery } from '../webhooks.js';
import { commitInteractiveDecision, type ActionRow } from '../interactive-decision.js';
import {
  apiBaseUrl,
  inspectApprovalToken,
  type ApprovalActionRow,
} from '../email-approval.js';

const RATE_LIMIT = 30; // requests per minute per IP, GET and POST combined bucket
const PREVIEW_MAX = 4000;

function clientIp(request: FastifyRequest): string {
  // Same order as signup/recovery/verification: Fly and Cloudflare set these,
  // clients cannot override them.
  return (
    (request.headers['fly-client-ip'] as string | undefined) ??
    (request.headers['cf-connecting-ip'] as string | undefined) ??
    request.ip ??
    'unknown'
  );
}

function limited(reply: FastifyReply) {
  return sendHtmlPage(reply, 429, 'Too many attempts', '<p>Please wait a minute and try again.</p>');
}

function invalidPage(reply: FastifyReply) {
  return sendHtmlPage(
    reply,
    404,
    'This link is not valid',
    '<p>It may have expired or already been replaced. Ask the requester to send a new notification if you still need to decide.</p>',
  );
}

function expiredPage(reply: FastifyReply) {
  return sendHtmlPage(
    reply,
    410,
    'This link has expired',
    '<p>Approval links are valid until the request expires (or 7 days, whichever comes first). Ask the requester to send a new action if you still need to decide.</p>',
  );
}

const STATUS_LABEL: Record<string, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
  executed: 'Executed',
  execute_failed: 'Execution failed',
  cancelled: 'Cancelled',
};

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

function fmtTime(unix: number | null): string {
  return unix === null ? '—' : new Date(unix * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
/** Read-only payload/preview block for the details disclosure. */
function previewHtml(action: ApprovalActionRow): string {
  const raw = action.payload ?? action.preview;
  let text: string;
  try {
    text = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    text = raw;
  }
  if (text.length > PREVIEW_MAX) text = `${text.slice(0, PREVIEW_MAX)}\n… (truncated)`;
  return (
    '<details><summary>Show request payload (read-only)</summary>' +
    `<pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;color:#9aa0ae;margin:10px 0 0;max-height:220px;overflow:auto">${htmlEscape(text)}</pre>` +
    '</details>'
  );
}

function receiptHtml(action: ApprovalActionRow): string {
  const label = statusLabel(action.status);
  const border = action.status === 'approved' ? '#2ea36b' : action.status === 'rejected' ? '#c0504d' : '#7c5cff';
  return (
    `<div style="border-left:3px solid ${border};padding:4px 0 4px 14px">` +
    `<p><b>${htmlEscape(label)}</b></p>` +
    `<p>“${htmlEscape(action.title)}” — status: ${htmlEscape(action.status)}. ` +
    'You can close this page.</p>' +
    '</div>'
  );
}

function decisionPage(action: ApprovalActionRow, token: string): string {
  const actionPath = `/v1/approval?token=${encodeURIComponent(token)}`;
  const inboxUrl = `${process.env.APP_URL ?? apiBaseUrl()}/inbox/${action.id}`;
  return (
    `<p><b>${htmlEscape(action.title)}</b><br>` +
    `kind: ${htmlEscape(action.kind)} · created ${fmtTime(action.created_at)}` +
    ` · expires ${fmtTime(action.expires_at)}</p>` +
    previewHtml(action) +
    `<p>` +
    `<form method="post" action="${htmlEscape(actionPath)}" style="display:inline">` +
    '<input type="hidden" name="verdict" value="approve">' +
    '<button type="submit" style="background:#2ea36b">Approve</button></form> ' +
    `<form method="post" action="${htmlEscape(actionPath)}" style="display:inline">` +
    '<input type="hidden" name="verdict" value="reject">' +
    '<button type="submit" style="background:#c0504d">Reject</button></form>' +
    '</p>' +
    `<p style="font-size:12.5px;color:#8b909c">Anyone who has this link can approve or reject this request — don't forward it. ` +
    `<a href="${htmlEscape(inboxUrl)}">Sign in for full audit details</a></p>`
  );
}

/**
 * CSRF guard for the decision POST. The token is the credential, but a
 * cross-site auto-submitting form must not decide anything: reject when the
 * browser tells us the request is cross-site, or when an Origin header's host
 * matches neither the request Host nor the configured API origin.
 */
function crossSitePost(request: FastifyRequest): boolean {
  const fetchSite = request.headers['sec-fetch-site'];
  if (typeof fetchSite === 'string' && fetchSite === 'cross-site') return true;

  const origin = request.headers.origin;
  if (typeof origin !== 'string' || origin === '') return false;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true; // unparseable Origin — treat as hostile
  }
  const allowed = new Set<string>();
  const host = request.headers.host;
  if (typeof host === 'string' && host !== '') allowed.add(host);
  try {
    allowed.add(new URL(apiBaseUrl()).host);
  } catch {
    // BASE_URL unset/invalid — the Host check above still applies.
  }
  return !allowed.has(originHost);
}

function verdictFromBody(request: FastifyRequest): string {
  // The urlencoded parser keeps the raw string (Slack signature needs it)
  // and leaves body empty — same as the verification form.
  if (typeof request.rawSlackBody === 'string') {
    return new URLSearchParams(request.rawSlackBody).get('verdict') ?? '';
  }
  const body = request.body as { verdict?: unknown } | undefined;
  return typeof body?.verdict === 'string' ? body.verdict : '';
}

export function registerEmailApprovalRoutes(app: FastifyInstance, db: Db): void {
  // GET — render only. Mail scanners and link previews must never decide.
  app.get<{ Querystring: { token?: string } }>('/v1/approval', async (request, reply) => {
    if (!(await checkRateLimit(db, `ip:${clientIp(request)}`, 'email-approval', RATE_LIMIT))) {
      return limited(reply);
    }

    const token = typeof request.query.token === 'string' ? request.query.token : '';
    const state = inspectApprovalToken(db, token);
    if (state.state === 'invalid') return invalidPage(reply);
    if (state.state === 'expired') return expiredPage(reply);

    const { action } = state;
    if (action.status !== 'pending') {
      return sendHtmlPage(reply, 200, statusLabel(action.status), receiptHtml(action));
    }
    return sendHtmlPage(reply, 200, 'Approve this action?', decisionPage(action, token));
  });

  // POST — the only mutation path.
  app.post<{ Querystring: { token?: string } }>('/v1/approval', async (request, reply) => {
    if (!(await checkRateLimit(db, `ip:${clientIp(request)}`, 'email-approval', RATE_LIMIT))) {
      return limited(reply);
    }
    if (crossSitePost(request)) {
      return sendHtmlPage(reply, 403, 'Forbidden', '<p>Cross-site requests cannot decide actions.</p>');
    }

    const verdictRaw = verdictFromBody(request);
    const verdict = verdictRaw === 'approve' ? 'a' : verdictRaw === 'reject' ? 'r' : null;
    if (verdict === null) {
      return sendHtmlPage(reply, 400, 'Bad request', '<p>Unknown decision.</p>');
    }

    const token = typeof request.query.token === 'string' ? request.query.token : '';
    const state = inspectApprovalToken(db, token);
    if (state.state === 'invalid') return invalidPage(reply);
    if (state.state === 'expired') return expiredPage(reply);

    const { action, projectId } = state;
    const actionRow: ActionRow = {
      id: action.id,
      project_id: action.project_id,
      status: action.status,
      preview: action.preview,
      callback_url: action.callback_url,
    };

    if (action.status !== 'pending') {
      return sendHtmlPage(reply, 409, 'Already decided', receiptHtml(action));
    }

    const outcome = commitInteractiveDecision(
      db,
      actionRow,
      verdict,
      'email:link',
      'email',
      projectId,
      clientIp(request),
      'Email approval link',
    );

    if (outcome.kind !== 'ok') {
      const current = outcome.kind === 'already_decided' ? outcome.currentStatus : action.status;
      const receiptAction: ApprovalActionRow = { ...action, status: current };
      return sendHtmlPage(reply, 409, 'Already decided', receiptHtml(receiptAction));
    }

    if (action.callback_url) {
      scheduleWebhookDelivery(db, action.id, action.callback_url);
    }

    const decidedAction: ApprovalActionRow = { ...action, status: outcome.newStatus };
    return sendHtmlPage(
      reply,
      200,
      outcome.newStatus === 'approved' ? 'Approved' : 'Rejected',
      receiptHtml(decidedAction),
    );
  });
}
