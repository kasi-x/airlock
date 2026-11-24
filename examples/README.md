# Airlock examples

## `approval-gated-agent.mjs`

A complete, dependency-free agent (Node 18+) that shows the core Airlock loop:
it proposes an action, waits for you to approve or reject it in the Airlock
inbox, and only runs the action if you approve — then reports the result back.

```bash
AIRLOCK_API_KEY=im_your_key \
AIRLOCK_BASE_URL=https://api.airlock.dev \
node approval-gated-agent.mjs
```

- Get `AIRLOCK_API_KEY` from your Airlock operator (it starts with `im_`).
- Use `AIRLOCK_BASE_URL=http://localhost:8484` for a local self-hosted server.

Edit the `task` object to change what the agent proposes, and replace
`performAction()` with the real thing you want gated behind human approval
(send an email, deploy, issue a refund, delete data, spend money, …).

### Prefer an LLM agent?

If your agent is an LLM (Claude and others), you usually don't write this loop
by hand — you give it the Airlock MCP server so it can request approval as a
tool call:

```json
{
  "mcpServers": {
    "airlock": {
      "command": "npx",
      "args": ["-y", "@airlock/mcp"],
      "env": { "AIRLOCK_API_KEY": "im_your_key", "AIRLOCK_BASE_URL": "https://api.airlock.dev" }
    }
  }
}
```

See the [main README](../README.md) for the full tool list and the [docs](https://airlock.dev/docs?utm_source=github&utm_medium=readme&utm_campaign=airlock) for everything else (watchers, notification channels, self-hosting).

