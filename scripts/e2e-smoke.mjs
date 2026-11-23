#!/usr/bin/env node
// End-to-end smoke test for the P0 core loop (roadmap week-1 exit condition).
//
// Boots the built server against a throwaway SQLite file, then exercises:
//   1. signup -> admin key
//   2. REST loop:  create (idempotent) -> approve-with-edit -> 409 on
//      double-decision -> report executed -> 409 on second result
//   3. reject path: create -> reject -> agent must not act
//   4. MCP tool loop: pushAction -> awaitDecision -> reportResult via the
//      same client functions the stdio package exposes
//
// Run: npm run build --workspace=mcp && npm run build --workspace=server
//      node scripts/e2e-smoke.mjs          (or: npm run test:e2e)

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import { pushAction, awaitDecision, reportResult, inboxStatus } from '../mcp/dist/tools.js';

const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..';
const PORT = 8499;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function api(path, method = 'GET', body, key) {
  const res = await fetch(`${BASE}/v1${path}`, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function waitForHealth(proc) {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    if (proc.exitCode !== null) throw new Error(`server exited early (${proc.exitCode})`);
    await sleep(200);
  }
  throw new Error('server did not become healthy in 10s');
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'impri-e2e-'));
  const server = spawn('node', ['server/dist/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DB_PATH: join(tmp, 'e2e.db'),
      PORT: String(PORT),
      HOST: '127.0.0.1',
      ALLOW_SIGNUP: '1',
      DISABLE_WATCHER_SCHEDULER: '1',
      BASE_URL: BASE,
      WEBHOOK_SECRET: 'e2e-webhook-secret-0123456789abcdef',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (line) => process.stdout.write(`  [server] ${line}`);
  server.stdout.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach(log));
  server.stderr.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach(log));

  try {
    await waitForHealth(server);
    console.log('✓ server healthy');

    // -- 1. signup ------------------------------------------------------------
    const signup = await api('/signup', 'POST', { name: 'e2e-project' });
    assert.equal(signup.status, 201, `signup failed: ${JSON.stringify(signup.json)}`);
    const key = signup.json.key;
    assert.match(key, /^im_/, 'signup returned a key with the im_ prefix');
    console.log('✓ signup returned an admin key');

    // -- 2. REST loop -----------------------------------------------------------
    const task = {
      kind: 'email.send',
      title: 'E2E: welcome email',
      preview: { format: 'markdown', body: 'Hi Jane — welcome!' },
      editable: ['preview.body'],
      idempotency_key: 'e2e-loop-1',
    };
    const created = await api('/actions', 'POST', task, key);
    assert.equal(created.status, 201, `create failed: ${JSON.stringify(created.json)}`);
    const id = created.json.id;
    assert.equal(created.json.status, 'pending');

    const replay = await api('/actions', 'POST', task, key);
    assert.equal(replay.status, 200, 'idempotent replay returns 200 (first create is 201)');
    assert.equal(replay.json.id, id, 'idempotency_key dedupes to the same action id');
    console.log('✓ create action + idempotency_key dedupe');

    // Human approves WITH an edit; the agent must receive the edited body.
    const decision = await api(`/actions/${id}/decision`, 'POST', {
      decision: 'approve',
      edited: { 'preview.body': 'Hi Jane — welcome! (edited by reviewer)' },
      channel: 'e2e',
    }, key);
    assert.equal(decision.status, 200, `decision failed: ${JSON.stringify(decision.json)}`);
    assert.equal(decision.json.status, 'approved');
    assert.equal(
      decision.json.final_preview.body,
      'Hi Jane — welcome! (edited by reviewer)',
      'approve carries the edited preview back',
    );

    const double = await api(`/actions/${id}/decision`, 'POST', { decision: 'reject' }, key);
    assert.equal(double.status, 409, 'second decision on a decided action conflicts (409)');
    console.log('✓ approve-with-edit; double-decision returns 409');

    const result = await api(`/actions/${id}/result`, 'POST', {
      status: 'executed',
      detail: 'queued by e2e',
      payload: { ids: ['msg_1'] },
    }, key);
    assert.equal(result.status, 200, `result failed: ${JSON.stringify(result.json)}`);
    assert.equal(result.json.status, 'executed');

    const secondResult = await api(`/actions/${id}/result`, 'POST', { status: 'executed' }, key);
    assert.equal(secondResult.status, 409, 'result only applies to approved actions (409 after)');
    console.log('✓ report executed; duplicate result returns 409');

    // -- 3. reject path ---------------------------------------------------------
    const rej = await api('/actions', 'POST', {
      kind: 'deploy.prod',
      title: 'E2E: deploy that must be rejected',
      preview: { format: 'plain', body: 'deploy v3 to production' },
    }, key);
    assert.equal(rej.status, 201);
    const rejDecision = await api(`/actions/${rej.json.id}/decision`, 'POST', { decision: 'reject' }, key);
    assert.equal(rejDecision.status, 200);
    assert.equal(rejDecision.json.status, 'rejected');
    const rejFinal = await api(`/actions/${rej.json.id}`, 'GET', undefined, key);
    assert.equal(rejFinal.json.status, 'rejected', 'agent polling sees rejected');
    console.log('✓ reject path leaves the action terminal at rejected');

    // -- 4. MCP tool loop (same client functions the stdio package exposes) -----
    const config = { apiKey: key, baseUrl: BASE };
    const pushed = await pushAction(config, {
      kind: 'slack.post',
      title: 'E2E: MCP-pushed action',
      preview: { format: 'markdown', body: '**posted by the MCP tool loop**' },
      editable: ['preview.body'],
    });
    assert.equal(pushed.isError, undefined, `pushAction failed: ${pushed.text}`);
    const mcpId = JSON.parse(pushed.text).action_id;

    // Approve from the "human" side while awaitDecision polls.
    setTimeout(() => {
      api(`/actions/${mcpId}/decision`, 'POST', { decision: 'approve' }, key)
        .then((r) => assert.equal(r.status, 200))
        .catch((e) => { throw e; });
    }, 300);

    const waited = await awaitDecision(config, { action_id: mcpId, timeout_s: 20 }, 300);
    const decisionJson = JSON.parse(waited.text);
    assert.equal(decisionJson.status, 'approved', `awaitDecision: ${waited.text}`);

    const reported = await reportResult(config, {
      action_id: mcpId,
      status: 'executed',
      detail: 'mcp loop done',
    });
    assert.match(reported.text, /executed/, `reportResult: ${reported.text}`);

    const inbox = await inboxStatus(config);
    assert.ok(inbox.text, 'inboxStatus responds');
    console.log('✓ MCP tool loop (pushAction -> awaitDecision -> reportResult)');

    console.log('\nE2E smoke: ALL PASS');
  } finally {
    server.kill('SIGTERM');
    await sleep(300);
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('\nE2E smoke FAILED:', e.message);
  process.exit(1);
});
