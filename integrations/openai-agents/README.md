# airlock-openai

**Airlock human-approval integration for the OpenAI Agents SDK.**

Every tool call or agent run that matters should have a human in the loop.
`airlock-openai` makes that one decorator away.

```
pip install airlock-openai                          # core (httpx only)
pip install 'airlock-openai[openai-agents]'         # + InputGuardrail helper
```

---

## What it does

An agent proposes an action → a human sees it in their [Airlock inbox](https://app.airlock.dev)
and taps **Approve** or **Reject** → the agent proceeds only on approval.

Two integration levels:

| Level | API | Use when |
|---|---|---|
| **Tool-level** | `@client.requires_approval(...)` decorator | Gate individual tools (send email, call API, write to DB) |
| **Run-level** | `make_guardrail(client, ...)` → `InputGuardrail` | Gate an entire agent run before the agent starts |

---

## Quick start

### 1. Get an API key

Self-hosted:
```bash
docker compose up -d   # key is printed to stdout on first start
```

Cloud: create a key at [app.airlock.dev](https://app.airlock.dev) or via
`POST /v1/signup`.

```bash
export AIRLOCK_API_KEY=im_...
```

### 2. Gate a tool with `requires_approval`

```python
import asyncio
from agents import Agent, Runner, function_tool
from airlock_openai import AirlockClient

client = AirlockClient()  # reads AIRLOCK_API_KEY from env

@function_tool
@client.requires_approval(
    kind="email.send",
    title=lambda to, **_: f"Send email to {to}",
    preview=lambda to, body, **_: {"format": "plain", "body": body},
    editable=["preview.body"],   # reviewer can edit the draft before approving
)
async def send_email(to: str, body: str) -> str:
    # This runs ONLY after a human taps Approve in the inbox.
    # If the reviewer edited the body, the updated text is injected here.
    print(f"Sending to {to}: {body}")
    return "sent"

agent = Agent(
    name="email-agent",
    instructions="Draft and send emails as requested.",
    tools=[send_email],
)

asyncio.run(Runner.run(agent, "Send a welcome email to alice@example.com"))
```

### 3. Gate an entire agent run with `make_guardrail`

```python
from agents import Agent, Runner
from airlock_openai import AirlockClient
from airlock_openai.guardrail import make_guardrail

client = AirlockClient()
approval = make_guardrail(
    client,
    kind="agent.run",
    title="Approve this agent task",
    # preview_from_input=True means the user's message becomes the preview body
)

agent = Agent(
    name="cautious-agent",
    instructions="You are a helpful assistant.",
    input_guardrails=[approval],
)

# Runner.run() blocks until a human approves in the Airlock inbox.
# If rejected, InputGuardrailTripwireTriggered is raised.
result = asyncio.run(Runner.run(agent, "Delete all draft emails"))
```

---

## API reference

### `AirlockClient`

```python
client = AirlockClient(
    api_key="im_...",           # or AIRLOCK_API_KEY env var
    base_url="https://api.airlock.dev",  # or AIRLOCK_BASE_URL; default http://localhost:8484
)
```

#### Actions

| Method | Description |
|---|---|
| `await client.create_action(kind, title, preview, ...)` | Submit action for approval (`POST /v1/actions`) |
| `await client.get_action(action_id)` | Fetch action with current status |
| `await client.list_actions(*, status, kind, since, limit, cursor)` | Paginated list |
| `await client.decide(action_id, verdict, *, edited, channel)` | Approve/reject programmatically |
| `await client.report_result(action_id, status, *, detail)` | Report execution outcome |
| `await client.await_decision(action_id, *, timeout_s, poll_interval_s)` | Poll until decided |

#### Ergonomic helpers

| Method | Description |
|---|---|
| `@client.requires_approval(kind, title, *, preview, editable, timeout_s)` | Decorator gating every call |
| `async with client.approval_gate(kind, title, preview, ...)` | Context manager with auto `report_result` |

#### Watchers

| Method | Description |
|---|---|
| `await client.create_watcher(name, kind, config, schedule, ...)` | Create monitoring watcher |
| `await client.list_watchers(...)` | List watchers (paginated) |
| `await client.get_watcher(watcher_id)` | Get watcher + item count |
| `await client.update_watcher(watcher_id, **fields)` | Partial update |
| `await client.delete_watcher(watcher_id)` | Delete watcher and its items |

#### Admin / Project

| Method | Description |
|---|---|
| `await client.create_key(name, scopes)` | Create API key (admin scope) |
| `await client.list_keys()` | List keys |
| `await client.revoke_key(key_id)` | Revoke a key |
| `await client.get_project()` | Project metadata + webhook_secret |
| `await client.update_project(*, name, timezone)` | Update project |
| `await client.rotate_webhook_secret()` | Rotate webhook signing secret |
| `await client.export_project()` | GDPR export |
| `await client.erase_project_data()` | GDPR erasure (irreversible) |

### `requires_approval` decorator

```python
@client.requires_approval(
    kind="email.send",
    title=lambda to, **_: f"Send email to {to}",  # or a plain string
    preview=lambda to, body, **_: {"format": "plain", "body": body},  # or a dict; or None for auto
    editable=["preview.body"],   # fields the reviewer may edit
    timeout_s=300,               # wait up to 5 minutes
    # any extra kwarg is forwarded to create_action:
    expires_in=86400,
)
async def send_email(to: str, body: str) -> str:
    ...
```

**After approval**, if the reviewer edited `preview.body`:

- If the function has a `body` parameter → `body` is replaced with the edited text.
- Otherwise → `_decision` dict is injected as a keyword argument (if the function accepts `**kwargs` or `_decision`).

**On rejection** → `AirlockRejected` is raised without calling the function.

### `approval_gate` context manager

Lower-level primitive when the gated work is not a single function call:

```python
async with client.approval_gate(
    kind="db.exec",
    title="DROP TABLE users",
    preview={"format": "plain", "body": sql},
    editable=["preview.body"],
) as approved:
    # approved.final_preview carries the human-edited SQL if reviewer changed it
    await db.execute(approved.final_preview["body"])
# report_result("executed") is called automatically on clean exit
# report_result("execute_failed", detail=str(exc)) is called on exception
```

### `make_guardrail` (OpenAI Agents SDK)

```python
from airlock_openai.guardrail import make_guardrail

guardrail = make_guardrail(
    client,
    kind="agent.run",
    title="Approve this agent task",
    preview_from_input=True,   # use the user message as preview body
    timeout_s=300,
    editable=[],               # reviewer cannot edit (the run either proceeds or not)
)
```

Returns an `InputGuardrail` ready for `Agent(input_guardrails=[guardrail])`.

### `verify_webhook` (standalone)

```python
from airlock_openai import verify_webhook

verify_webhook(
    raw_body=request.body,              # bytes — NOT parsed JSON
    secret=project["webhook_secret"],   # from client.get_project()
    timestamp=request.headers["X-Airlock-Timestamp"],
    nonce=request.headers["X-Airlock-Nonce"],
    signature=request.headers["X-Airlock-Signature"],
)
# raises AirlockWebhookSignatureError on mismatch
```

---

## Exception hierarchy

```
AirlockError
├── AirlockConfigError        — api_key missing at construction
├── AirlockUnauthorized       — 401/403 wrong key or missing scope
├── AirlockNotFound           — 404 action/watcher not found
├── AirlockConflict           — 409 already decided, idempotency race
├── AirlockExpired            — 410 or status='expired'
├── AirlockRateLimited        — 429  (.retry_after seconds hint)
├── AirlockQuotaExceeded      — 402  (.limit, .tier)
├── AirlockValidationError    — 400/422 (.issues list)
├── AirlockApiError           — other 4xx/5xx (.status_code)
├── AirlockRejected           — await_decision: human said no (NOT an error)
├── AirlockTimeout            — await_decision: timeout_s elapsed (action still pending)
└── AirlockWebhookSignatureError — verify_webhook HMAC mismatch
```

`AirlockRejected` is a **normal flow outcome**, not an error. Catch it separately
and handle it gracefully (log, notify, etc.).

---

## Untrusted watcher content

Actions delivered by a Watcher have `payload.untrusted = True`. The SDK sets
`action["is_untrusted"] = True` on the returned dict for easy checking. Treat
the `title`, `preview`, and `target_url` of untrusted actions as **external
data** — never pass them as instructions to a downstream LLM without sanitising.

---

## Running tests

```bash
cd integrations/openai-agents
pip install -e '.[dev]'
pytest -v
```

The test suite mocks all HTTP calls with `unittest.mock`. The OpenAI Agents SDK
tests are automatically skipped when `openai-agents` is not installed.

---

## Self-hosted vs cloud

| | Self-hosted | Cloud |
|---|---|---|
| Base URL | `http://localhost:8484` (default) | `https://api.airlock.dev` |
| Set via | `base_url=` or `AIRLOCK_BASE_URL` | same |
| Key prefix | `im_...` | `im_...` |

Source: [gitlab.com/sekera.radim/airlock](https://gitlab.com/sekera.radim/airlock) · Docs: [airlock.dev/docs](https://airlock.dev/docs)
