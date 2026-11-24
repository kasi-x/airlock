# @airlock/cli

Command-line interface for [Airlock](https://airlock.dev) — human-in-the-loop approval for AI agents.

## 60-second quickstart

```bash
# 1. Install globally after building
cd sdk/typescript && npm install && npm run build
cd ../cli && npm install && npm run build
npm install -g ./

# 2. Connect to your Airlock instance
airlock init                        # self-hosted (default: http://localhost:8484)
airlock init --cloud                # Airlock Cloud (https://api.airlock.dev)
airlock init --cloud --signup       # create a free cloud project

# 3. Push an action for approval
airlock push --kind db.exec --title "Run migration" --body "ALTER TABLE ..."

# 4. See what needs a decision
airlock inbox

# 5. Approve or reject
airlock approve act_abc123
airlock reject  act_abc123
```

## Commands

### Auth

| Command | Description |
|---|---|
| `airlock init [--cloud] [--signup] [--key <k>] [--demo]` | Interactive onboarding — set base URL + API key |
| `airlock login [--cloud] [--key <k>]` | Re-run onboarding to update credentials |
| `airlock status` | Verify connection and show pending count |

### Actions

| Command | Description |
|---|---|
| `airlock push --kind <k> --title <t> [--body <b>] [--format plain\|markdown\|diff] [--editable preview.body] [--wait] [--timeout <s>] [--json]` | Create an action for human approval |
| `airlock list [--status <s>] [--kind <k>] [--since <iso>] [--q <search>] [--limit <n>] [--json]` | List actions newest-first |
| `airlock inbox [--kind <k>] [--limit <n>] [--json]` | Show only pending actions |
| `airlock get <id> [--json]` | Fetch full detail for one action |
| `airlock approve <id> [--edit <new-body>] [--json]` | Approve an action |
| `airlock reject <id> [--json]` | Reject an action |
| `airlock tail [--kind <k>] [--interval <s>] [--json]` | Stream new pending actions as they arrive |

### Watchers

| Command | Description |
|---|---|
| `airlock presets [--category <c>] [--json]` | List watcher preset templates |
| `airlock watch add <preset-id> [--param k=v]... [--schedule <every>] [--json]` | Create watcher from preset |
| `airlock watchers list [--status <s>] [--kind <k>] [--json]` | List watchers |
| `airlock watchers get <id> [--json]` | Fetch watcher detail with item count |
| `airlock watchers delete <id> [--yes]` | Delete watcher permanently |

### API Keys

| Command | Description |
|---|---|
| `airlock keys list [--json]` | List all keys (admin scope required) |
| `airlock keys create --name <n> --scopes <actions\|watch\|admin>` | Create key — shown exactly once |
| `airlock keys revoke <id> [--yes]` | Revoke a key permanently |

## Configuration

Config file: `~/.airlock/config.json` (permissions: directory 0700, file 0600)

```json
{ "base_url": "https://api.airlock.dev", "api_key": "im_..." }
```

**Precedence** (highest first):
1. `AIRLOCK_API_KEY` / `AIRLOCK_BASE_URL` environment variables
2. `~/.airlock/config.json`
3. Default base URL: `http://localhost:8484`

## Pipe usage

```bash
# Push from stdin
echo "SELECT * FROM users LIMIT 10" | airlock push --kind db.exec --title "Query users"

# JSON output for scripting
airlock inbox --json | jq '.id'
airlock list --status approved --json | jq -r '.id + " " + .kind'
```

## --wait for synchronous flows

```bash
airlock push --kind email.send --title "Send report" --body "..." --wait --timeout 300
# Exits 0 on approval, 1 on rejection or timeout
```

## Building from source

```bash
cd sdk/typescript && npm install && npm run build
cd ../cli && npm install && npm run build
node dist/cli.js --help
```
