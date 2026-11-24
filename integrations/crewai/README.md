# airlock-crewai

Human-in-the-loop approval gate for [CrewAI](https://crewai.com) agents, powered by [Airlock](https://airlock.dev).

An agent proposes an action. A human approves or rejects it in the Airlock inbox. The agent executes only after approval — the tool call blocks until the human decides.

---

## Installation

```bash
pip install airlock-crewai crewai        # from source until published to PyPI
# or, with the extras shorthand:
pip install "airlock-crewai[crewai]"
```

The core package has **zero runtime dependencies** beyond stdlib. CrewAI is an optional dependency — the module imports cleanly without it (useful in test environments).

---

## Quick start

```python
import os
from crewai import Agent, Task, Crew
from airlock_crewai import AirlockClient, AirlockApprovalTool, AirlockRejected

# 1. Configure the client. Falls back to the AIRLOCK_API_KEY env var.
client = AirlockClient(
    api_key=os.environ["AIRLOCK_API_KEY"],
    # base_url defaults to http://localhost:8484 (self-hosted)
    # use "https://api.airlock.dev" for the cloud
)

# 2. Create the approval tool. action_kind groups actions in the inbox.
approval_tool = AirlockApprovalTool(
    client=client,
    action_kind="email.send",
    timeout_s=600,  # wait up to 10 minutes for a human decision
)

# 3. Give the tool to your agent.
agent = Agent(
    role="Marketing assistant",
    goal="Draft and send campaign emails, always requesting human approval first.",
    backstory=(
        "You are careful and thorough. Before sending any email, you use the "
        "airlock_approval_gate tool to submit your draft for human review."
    ),
    tools=[approval_tool],
    verbose=True,
)

task = Task(
    description=(
        "Draft a short welcome email to onboard@acme.com. "
        "Use the airlock_approval_gate tool to submit it for review. "
        "If approved, confirm it has been sent."
    ),
    expected_output="Confirmation that the draft was approved and sent.",
    agent=agent,
)

crew = Crew(agents=[agent], tasks=[task])

try:
    result = crew.kickoff()
    print(result)
except AirlockRejected as exc:
    # The human pressed Reject in the inbox — not an error, a valid outcome.
    print(f"Action rejected: {exc}")
```

Open your Airlock inbox (`http://localhost:8080` self-hosted, or `https://app.airlock.dev` cloud) to approve or reject the card that appears.

---

## Two integration patterns

### Pattern A — `AirlockApprovalTool` (recommended)

The agent explicitly requests approval via a tool call. Best when:
- The agent decides which actions need a human gate.
- You want the human-edited content fed back into the agent's reasoning.

The tool's `_run` method:
1. POSTs the action to Airlock (`POST /v1/actions`).
2. Polls `GET /v1/actions/:id` every 5 s until the human decides.
3. On approval: returns `"APPROVED. Proceed with:\n\n{final_content}"` — the agent reads this and proceeds.
4. On rejection: raises `AirlockRejected` — CrewAI surfaces this as a tool error, and the agent can handle or stop.

```python
tool = AirlockApprovalTool(
    client=client,
    action_kind="db.exec",    # free-form kind string, shown in the inbox
    timeout_s=300,            # raise AirlockTimeout after this many seconds
    editable=["preview.body"],# fields the reviewer may edit before approving
)
```

### Pattern B — `AirlockApprovalCallback`

Wire into CrewAI's `step_callback` or `task_callback` to gate every output automatically, without changing agent prompts or tool lists:

```python
from airlock_crewai import AirlockApprovalCallback

gate = AirlockApprovalCallback(
    client,
    action_kind="agent.output",
    title_prefix="Review before publishing",
    timeout_s=300,
)

crew = Crew(
    agents=[agent],
    tasks=[task],
    task_callback=gate,   # called once per completed task
    # step_callback=gate  # called after every intermediate step
)
```

**Limitation:** CrewAI ignores callback return values, so the human-edited content is not injected back into the agent flow. The callback is best for hard-blocking on rejection. For round-trip edit feedback, use `AirlockApprovalTool`.

---

## Configuration

| Parameter | Source (priority order) | Default |
|---|---|---|
| `api_key` | Constructor → `AIRLOCK_API_KEY` env var | *(required)* |
| `base_url` | Constructor → `AIRLOCK_BASE_URL` env var | `http://localhost:8484` |

```bash
# Self-hosted
export AIRLOCK_API_KEY=im_...

# Airlock cloud
export AIRLOCK_API_KEY=im_...
export AIRLOCK_BASE_URL=https://api.airlock.dev
```

---

## Handling outcomes

```python
from airlock_crewai import AirlockRejected, AirlockTimeout, AirlockExpired

try:
    result = crew.kickoff()
except AirlockRejected as exc:
    # Human pressed Reject. Not an error — log it and move on.
    print(f"Rejected: action_id={exc.action_id}")

except AirlockTimeout as exc:
    # No human decision within timeout_s. Action is still pending on the server.
    # You can call await_decision again with the same action_id to keep waiting.
    print(f"Timed out waiting for {exc.action_id}")

except AirlockExpired:
    # The action's expires_at timestamp passed with no decision.
    # Create a new action if the task is still relevant.
    print("Approval window closed.")
```

---

## Webhook signature verification

If you set a `callback_url` on your actions and want to verify Airlock's signed webhook deliveries:

```python
from airlock_crewai import verify_webhook, AirlockWebhookSignatureError

# In your webhook handler (framework-agnostic):
raw_body: bytes = request.body            # do not decode
timestamp: str  = request.headers["X-Airlock-Timestamp"]
nonce: str      = request.headers["X-Airlock-Nonce"]
signature: str  = request.headers["X-Airlock-Signature"]
secret: str     = os.environ["AIRLOCK_WEBHOOK_SECRET"]  # from GET /v1/project

try:
    verify_webhook(raw_body, secret, timestamp, nonce, signature)
except AirlockWebhookSignatureError:
    return 403
```

---

## Running the tests

```bash
cd integrations/crewai
pip install pytest
pytest                    # runs without crewai — CrewAI tests are skipped
pip install crewai
pytest                    # runs all tests
```

Tests use an injectable transport, so there are no network calls and no patching of stdlib internals.

---

## How it works

```
Agent                Airlock inbox               Human
  │                       │                      │
  │── tool call ──────────►                      │
  │   (create_action)     │                      │
  │                       │── notification ──────►
  │   (polling...)        │                      │
  │                       │◄── approve/reject ───│
  │◄── tool result ───────│
  │   (or AirlockRejected)  │
```

The agent never executes without an explicit human decision. `AirlockApprovalTool._run` blocks synchronously during the polling loop, keeping the integration stateless from the agent's perspective.

---

## License

MIT — same as the Airlock core. See [LICENSE](../../LICENSE).
