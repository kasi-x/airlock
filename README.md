# impri (fork)

**Human-in-the-loop approval inbox for AI agents.**

Your agent wants to send the email, post the reply, run the migration.
You want to see it before it happens. This inbox sits in between: the agent
pushes a proposed action, a human approves, edits, or rejects it, and only an
`approved` verdict makes execution reachable.

This is a fork of [sekera-radim/impri](https://github.com/sekera-radim/impri)
(MIT), kept as the implementation substrate for a request-agreement layer
(counter-proposals, deterministic evidence, delegation tiers — see the
`notify-kit` product docs). The fork tracks upstream; the product story,
branding, and hosted cloud are its own.

```
Agent (Claude Code / any MCP client)  →  approval inbox  →  You approve, edit, or reject
        ↑                                                      |
        └────────────── agent executes, reports result ────────┘
```

## Status

Development fork — not published, not rebranded yet. Upstream's hosted
endpoints (`impri.dev`, `api.impri.dev`) are **not referenced** by any
runtime code or deploy template; everything runs self-hosted or against a
server you point at explicitly.

## Self-host in 60 seconds

```sh
git clone https://github.com/kasi-x/impri.git
cd impri
npm ci                                   # server + mcp workspaces
npm install-scripts approve better-sqlite3 argon2   # npm >= 12 blocks install scripts
npm run build --workspace=mcp            # server imports @impri/mcp from dist
docker compose up                        # or: npm run dev (server on :8484, ui separately)
```

Server on `http://localhost:8484`, web inbox on `http://localhost:8080`.
The bootstrap admin API key prints to the server logs on first start.

## The loop

```bash
ACTION=$(curl -s -X POST http://localhost:8484/v1/actions \
  -H "Authorization: Bearer $IMPRI_API_KEY" -H "Content-Type: application/json" \
  -d '{"kind":"email.send","title":"Outreach: Acme","preview":{"format":"markdown","body":"Hi Sarah, ..."}}')
ID=$(echo "$ACTION" | jq -r .id)

# a human approves in the web inbox (or via Slack/Telegram/Discord buttons)
DECISION=$(curl -s "http://localhost:8484/v1/actions/$ID" -H "Authorization: Bearer $IMPRI_API_KEY")

# only now, and only if approved
[ "$(echo "$DECISION" | jq -r .status)" = "approved" ] && send_email ...
```

Or from any MCP client (stdio, pointing at your self-hosted server):

```bash
claude mcp add impri --env IMPRI_API_KEY=im_... -- npx -y @impri/mcp
```

## Layout

| Package | What |
|---|---|
| `server/` | Fastify REST API + SQLite, hosted streamable-HTTP `/mcp` endpoint |
| `mcp/` | stdio MCP server (`@impri/mcp`): push_action, await_decision, report_result, inbox_status |
| `ui/` | Vue 3 + Vuetify approval inbox |
| `cli/`, `sdk/typescript/`, `sdk/python/` | Clients over the REST API |
| `integrations/` | Claude Agent SDK / CrewAI / LangChain / OpenAI Agents adapters |
| `docs/` | Product documentation (inherited from upstream) |

See [AGENTS.md](AGENTS.md) for build/test commands, gotchas, and the
rebrand boundary (what must be replaced before any release).

## License

MIT — inherits upstream's license
([LICENSE](LICENSE), © 2026 Radim Sekera). Upstream project:
<https://github.com/sekera-radim/impri> · docs: <https://impri.dev> (upstream).
