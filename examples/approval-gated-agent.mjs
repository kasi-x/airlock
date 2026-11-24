#!/usr/bin/env node
// Example Airlock agent — no dependencies, Node 18+.
//
// It demonstrates the loop every Airlock-integrated agent follows:
//   1. propose an action       POST /v1/actions
//   2. wait for a human        poll GET /v1/actions/:id
//   3. act only if approved    then POST /v1/actions/:id/result
//
// Run it:
//   AIRLOCK_API_KEY=im_xxx AIRLOCK_BASE_URL=https://api.airlock.dev node approval-gated-agent.mjs
//
// Then open your Airlock inbox and Approve or Reject the request that appears.

const API_KEY = process.env.AIRLOCK_API_KEY;
const BASE = (process.env.AIRLOCK_BASE_URL ?? 'http://localhost:8484').replace(/\/+$/, '');

if (!API_KEY) {
  console.error('Set AIRLOCK_API_KEY (it starts with im_).');
  process.exit(1);
}

async function api(path, method = 'GET', body) {
  const res = await fetch(`${BASE}/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${json.message ?? json.error ?? ''}`);
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- The task this agent wants to do. Edit freely. ---
const task = {
  kind: 'email.send',
  title: 'Send welcome email to jane@acme.com',
  preview: {
    format: 'markdown',
    body:
      '**To:** jane@acme.com\n**Subject:** Welcome to Acme 👋\n\n' +
      'Hi Jane, thanks for signing up! Reply if you need anything.',
  },
};

// The real side effect. Swap this for your email / deploy / refund / API call.
async function performAction() {
  console.log('   -> running the action (this is where your real code goes)...');
  // await sendEmail(...)
  return 'message queued';
}

async function main() {
  console.log(`\nProposing an action to Airlock at ${BASE} ...`);
  const action = await api('/actions', 'POST', task);
  console.log(`  - created ${action.id} (status: ${action.status})`);
  console.log('  - open your Airlock inbox and Approve or Reject it.\n');

  let current = action;
  while (current.status === 'pending') {
    await sleep(3000);
    current = await api(`/actions/${action.id}`);
    process.stdout.write(`  - waiting for a human... (${current.status})   \r`);
  }
  console.log(`\n  - decision: ${current.status.toUpperCase()}`);

  if (current.status === 'approved') {
    try {
      const detail = await performAction();
      await api(`/actions/${action.id}/result`, 'POST', { status: 'executed', detail });
      console.log('  OK approved -> action performed and reported back to Airlock.');
    } catch (err) {
      await api(`/actions/${action.id}/result`, 'POST', {
        status: 'execute_failed',
        detail: String(err),
      });
      console.log('  approved but the action failed -> reported as execute_failed.');
    }
  } else {
    console.log('  not approved -> the agent did nothing. That is the whole point.');
  }
}

main().catch((e) => {
  console.error('agent error:', e.message);
  process.exit(1);
});
