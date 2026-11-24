# Airlock — LangChain / LangGraph integration

Human-in-the-loop approval gate for LangChain tools and LangGraph graphs.
Before a gated tool runs, the proposed call is submitted to your Airlock inbox
as a pending action. The agent blocks (polling `GET /v1/actions/:id`) until a
human approves or rejects in the web inbox. On approval the wrapped tool
executes; on rejection `AirlockRejected` propagates back to the agent.

**No third-party dependencies for the core client** — uses Python stdlib only
(`urllib.request`, `json`, `time`). `langchain-core` is needed only for
`AirlockApprovalTool`.

---

## Installation

```bash
# Core client only (no langchain required)
cp -r integrations/langchain /your/project/airlock_langchain

# With LangChain tool support
pip install langchain-core
# or for LangGraph:
pip install langgraph langchain-anthropic
```

Set your API key:

```bash
export AIRLOCK_API_KEY=im_...          # get one at https://app.airlock.dev
export AIRLOCK_BASE_URL=https://api.airlock.dev   # or leave unset for self-hosted localhost:8484
```

---

## Runnable snippet — basic approval gate

This snippet works without LangChain. Run it with `AIRLOCK_API_KEY` set:

```python
import os
from airlock_langchain import AirlockClient, AirlockRejected, AirlockTimeout

client = AirlockClient()  # reads AIRLOCK_API_KEY / AIRLOCK_BASE_URL from env

# 1. Propose an action for human review
action = client.create_action(
    kind="email.send",
    title="Send welcome email to alice@example.com",
    preview={
        "format": "plain",
        "body": "Hi Alice,\n\nWelcome to the platform! Let us know if you have questions.\n\nBest,\nThe Team",
    },
    editable=["preview.body"],   # reviewer may reword before approving
    target_url="https://mail.example.com/drafts/1234",
)
print(f"Pending: {action['inbox_url']}")   # open this to review the action

# 2. Block until the human decides (polls every 5 s, times out after 5 min)
try:
    approved = client.await_decision(action["id"], timeout_s=300)
except AirlockRejected as exc:
    print("Rejected — stopping.")
    raise SystemExit(0)
except AirlockTimeout:
    print("No decision yet — try again later.")
    raise SystemExit(1)

# 3. Use decision.final_preview — reviewer may have edited the body
final_body = approved["decision"]["final_preview"]["body"]

# 4. Execute (your real send logic here)
print(f"Approved. Sending:\n{final_body}")
send_email("alice@example.com", final_body)

# 5. Report outcome — closes the audit loop in the inbox
client.report_result(action["id"], "executed")
```

---

## LangChain tool wrapper

Wrap any `BaseTool` with an Airlock approval gate. The wrapped tool's `name`,
`description`, and `args_schema` are inherited, so the LLM sees identical
metadata — only the execution path changes.

```python
from langchain_community.tools.shell import ShellTool
from airlock_langchain import AirlockClient, AirlockApprovalTool, AirlockRejected

client = AirlockClient()

# Wrap ShellTool so every shell command needs human sign-off
safe_shell = AirlockApprovalTool.wrap(
    ShellTool(),
    client=client,
    kind="shell.exec",
    preview_format="plain",
    editable=["preview.body"],   # reviewer may edit the command before approving
    timeout_s=300,
)

# Use directly (blocks until approval)
try:
    result = safe_shell.run("ls -la /tmp")
    print(result)
except AirlockRejected:
    print("Human rejected the shell command.")
```

---

## LangGraph integration

`AirlockApprovalTool` is a standard `BaseTool` subclass — register it in
`ToolNode` exactly like any other tool. The graph pauses at the `tools` node
until the inbox action is decided.

```python
import os
from typing import Literal

from langchain_anthropic import ChatAnthropic
from langchain_community.tools.shell import ShellTool
from langgraph.graph import StateGraph, MessagesState
from langgraph.prebuilt import ToolNode

from airlock_langchain import AirlockClient, AirlockApprovalTool, AirlockRejected

# ── Build the approval-gated tool ──────────────────────────────────────────
client = AirlockClient()
safe_shell = AirlockApprovalTool.wrap(
    ShellTool(),
    client=client,
    kind="shell.exec",
    editable=["preview.body"],
)

# ── LangGraph graph ────────────────────────────────────────────────────────
tools = [safe_shell]
llm = ChatAnthropic(model="claude-opus-4-5").bind_tools(tools)


def call_model(state: MessagesState):
    return {"messages": [llm.invoke(state["messages"])]}


def should_continue(state: MessagesState) -> Literal["tools", "__end__"]:
    last = state["messages"][-1]
    return "tools" if last.tool_calls else "__end__"


builder = StateGraph(MessagesState)
builder.add_node("agent", call_model)
builder.add_node("tools", ToolNode(tools))
builder.set_entry_point("agent")
builder.add_conditional_edges("agent", should_continue)
builder.add_edge("tools", "agent")
graph = builder.compile()

# ── Run ───────────────────────────────────────────────────────────────────
from langchain_core.messages import HumanMessage
try:
    result = graph.invoke({"messages": [HumanMessage("List the files in /tmp")]})
    print(result["messages"][-1].content)
except AirlockRejected:
    print("The human reviewer rejected the proposed shell command.")
```

---

## Using `create_action` / `await_decision` directly in a LangGraph node

For cases where the gated work is not a single tool call — for example, a
multi-step database migration — use the client primitives directly inside a
custom graph node:

```python
from airlock_langchain import AirlockClient, AirlockRejected

client = AirlockClient()


def human_gate_node(state):
    """Custom LangGraph node that requires human approval before continuing."""
    sql = state["pending_sql"]

    action = client.create_action(
        kind="db.exec",
        title=f"Execute SQL: {sql[:80]}",
        preview={"format": "plain", "body": sql},
        editable=["preview.body"],
    )

    try:
        approved = client.await_decision(action["id"], timeout_s=600)
    except AirlockRejected:
        return {"status": "rejected", "sql": sql}

    # Use the human-approved (possibly edited) SQL
    final_sql = approved["decision"]["final_preview"]["body"]
    try:
        db.execute(final_sql)
        client.report_result(action["id"], "executed")
        return {"status": "executed", "sql": final_sql}
    except Exception as exc:
        client.report_result(action["id"], "execute_failed", detail=str(exc))
        raise
```

---

## Configuration reference

| Parameter | Env var | Default |
|-----------|---------|---------|
| `api_key` | `AIRLOCK_API_KEY` | — (required) |
| `base_url` | `AIRLOCK_BASE_URL` | `http://localhost:8484` |

Cloud endpoint: `https://api.airlock.dev` — set `AIRLOCK_BASE_URL=https://api.airlock.dev`.

---

## Error reference

| Exception | When |
|-----------|------|
| `AirlockConfigError` | `api_key` missing at construction time |
| `AirlockUnauthorized` | 401/403 — wrong key or missing scope (`actions` required) |
| `AirlockNotFound` | 404 — unknown `action_id` or wrong project |
| `AirlockConflict` | 409 — action already decided or idempotency race |
| `AirlockExpired` | 410 — approval window closed |
| `AirlockRateLimited` | 429 — per-key rate limit (60 POST/min, 300 GET/min) |
| `AirlockQuotaExceeded` | 402 — monthly limit reached (cloud tiers) |
| `AirlockValidationError` | 400/422 — bad request body |
| `AirlockApiError` | Other 4xx/5xx — carries `.status_code` |
| `AirlockRejected` | `await_decision` when human rejected — **not an error; handle as a branch** |
| `AirlockTimeout` | `await_decision` when `timeout_s` elapsed; action still pending |

All exceptions inherit from `AirlockError`.

```python
from airlock_langchain import AirlockError, AirlockRejected, AirlockTimeout

try:
    approved = client.await_decision(action_id)
except AirlockRejected:
    # Normal outcome — the reviewer said no. Don't log as an error.
    return stop_task()
except AirlockTimeout:
    # Still pending — retry later or alert the operator.
    schedule_retry(action_id)
except AirlockError as exc:
    # Unexpected API / config problem.
    logger.error("Airlock error: %s", exc)
    raise
```

---

## Running the tests

No external dependencies needed:

```bash
# From repo root
python3 -m pytest integrations/langchain/tests/test_core.py -v

# 37 tests, stdlib mocks only, langchain not required
```
