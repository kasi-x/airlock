# Add human approval to Windsurf with Airlock

Gate Windsurf's Cascade agent on real-world side effects — deploys, database writes, outbound messages — behind a human decision in the Airlock inbox.

## 60-second install

Open Windsurf's MCP config (Windsurf Settings → Cascade → MCP Servers → "View raw config", which edits `~/.codeium/windsurf/mcp_config.json`) and add:

```json
{
  "mcpServers": {
    "airlock": {
      "command": "npx",
      "args": ["-y", "@airlock/mcp"],
      "env": {
        "AIRLOCK_API_KEY": "im_your_key_here",
        "AIRLOCK_BASE_URL": "https://api.airlock.dev"
      }
    }
  }
}
```

Self-hosting? Drop the `AIRLOCK_BASE_URL` line entirely — it defaults to `http://localhost:8484` — or point it at your own server (see [self-hosting](self-hosting.md)); get a cloud key at [airlock.dev](https://airlock.dev). Click "Refresh" in the MCP Servers panel and confirm `airlock` shows as connected with 8 tools.

## Tell Cascade to use it

Add to Windsurf's global rules or your project's `.windsurfrules`:

```markdown
## Human approval
Before any action with a real side effect (send, deploy, delete, pay, publish), call
airlock_push_action with a clear preview, then airlock_await_decision before proceeding.
```

## What you see

Cascade keeps working on the rest of its task while the action sits in your Airlock inbox, with the title and preview visible there and, if configured, pushed to Slack/Telegram/ntfy too. Approve, reject, or edit the draft before Cascade acts on the decision.

## Real example call

```
airlock_push_action({
  kind: "infra.terraform_apply",
  title: "terraform apply: resize db.primary to db.r6g.xlarge",
  preview: { format: "diff", body: "Plan: 1 to change, 0 to destroy.\n~ aws_db_instance.primary" },
  editable: []
})
```

Response:

```json
{
  "action_id": "act_2v7d...",
  "status": "pending",
  "inbox_url": "https://app.airlock.dev/inbox/act_2v7d..."
}
```

## Troubleshooting

- **`airlock` doesn't show as connected** — the raw config is JSON; check for a trailing comma or an unescaped path separator on Windows configs.
- **`AIRLOCK_API_KEY is not set` at call time** — the `env` block only applies inside that `mcpServers.airlock` entry; a key exported elsewhere in your shell isn't picked up by Windsurf's own process.
- **Cascade never calls the approval tool** — the model only calls it when instructed; check that `.windsurfrules` (or the global rule) is actually active for the workspace.

## Next

[Read the full human approval pattern](how-to-add-human-approval-to-an-ai-agent.md), or see [gating infra changes](/use-cases/deploy-and-infra-changes).
