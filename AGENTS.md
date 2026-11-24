# Agent Guide for `airlock` (fork)

This fork grows [sekera-radim/impri](https://github.com/sekera-radim/impri)
(MIT) — a human-in-the-loop approval inbox for AI agents — into the
request-agreement layer described in the `notify-kit` product docs
(`docs/strategy.md`, `docs/roadmap.md`, `docs/contract-spec.md` there).
Upstream is fast-followed, not replaced: keep the fork diff minimal and
rebrandable.

## Remotes and upstream sync

- `origin` — `kasi-x/airlock` (push here)
- `upstream` — `sekera-radim/impri` (fetch fixes from here)
- Sync: `git fetch upstream && git merge upstream/main` (keep history; do not
  rebase fork-only commits onto upstream).

## Commands

Node >= 18 (dev on 22). npm workspaces at the root cover `server` + `mcp`;
`ui`, `cli`, and `sdk/typescript` are standalone packages with their own
lockfiles and `node_modules`.

```sh
npm ci                                   # root: server + mcp deps
npm install-scripts approve better-sqlite3 argon2   # only if npm blocks native builds
npm run build --workspace=mcp            # MUST precede server tests (see below)
npm run typecheck --workspace=server     # tsc --noEmit
npm run lint --workspace=server
npm test --workspace=server              # vitest, ~730 tests, ~60s

cd mcp && npm ci && npm run check        # typecheck + lint + test + build
cd ui && npm ci && npm run build         # vue-tsc + vite build; also lint/test
cd sdk/typescript && npm ci && npm run build   # MUST precede cli checks
cd cli && npm ci && npm run test         # needs @airlock/sdk dist/ to exist
cd sdk/python && pytest                  # zero-dep Python client SDK
npm run test:e2e                         # E2E smoke: boots the built server on :8499
                                         # with a throwaway SQLite file and drives
                                         # signup -> push -> decide -> report; needs
                                         # server/dist + mcp/dist built first
```

### Gotchas

- **npm >= 12 blocks dependency install scripts by default.** `better-sqlite3`
  and `argon2` need their native builds, which is why `allowScripts` in the
  root `package.json` exists. `esbuild` / `fsevents` also print "blocked"
  warnings on every install — expected and harmless (their platform binaries
  come from optionalDependencies; builds and tests pass without the scripts).
- **Build order matters:** server imports `@airlock/mcp/*` from the mcp
  package's `dist/`, and cli imports `@airlock/sdk` from the sdk's `dist/`.
  A fresh clone fails ~29/33 server test files until `mcp` is built, and cli
  fails until `sdk/typescript` is built.
- Root `npm run test` / `lint` / `typecheck` delegate to **server only**. Run
  the ui/cli/sdk commands inside their own directories.
- `docker compose up` (repo root) runs server (":8484") + ui (":8080").

## Directory layout

| Path | What |
| --- | --- |
| `server/src/` | Fastify REST API, SQLite (`better-sqlite3`) schema in `db.ts`, routes in `routes/`, auth, notifications, scheduler, billing |
| `server/src/routes/mcp.ts` + `mcp/serverCard.ts` | Streamable-HTTP MCP endpoint served by the same process via `app.inject` |
| `mcp/src/` | Published `@airlock/mcp` stdio MCP server (tools: push_action, await_decision, report_result, inbox_status, watchers) |
| `ui/src/` | Vue 3 + Vuetify inbox SPA (not a workspace; own `npm ci`) |
| `cli/src/` | `airlock` CLI (`commander`), uses `sdk/typescript` |
| `sdk/typescript/`, `sdk/python/` | Client SDKs over the REST API |
| `integrations/` | Claude Agent SDK / CrewAI / LangChain / OpenAI Agents adapters |
| `docs/` | Public product docs (Markdown, built to www by `scripts/build-docs.mjs`) |
| `www/` | Marketing site sources (built artifacts are committed) |
| `deploy/` | Production compose + Caddy; `docker-compose.yml` is the self-host default |
| `status/` | Cloudflare Worker status page (upstream ops; candidate for removal) |

## Constraints and caveats

- **License:** MIT, `(c) 2026 Radim Sekera`. Keep `LICENSE` verbatim; preserve
  attribution in `NOTICE` when rebranding.
- **Rebrand status:** rebrand to "Airlock" is DONE except demo assets. Keep MIT
  attribution rule (LICENSE + NOTICE verbatim). Keep upstream-sync section.
  New code must not hardcode product domains — read from env/config.
- **Secrets are env-driven, never hardcoded:** `SENTRY_DSN`, `STRIPE_*`,
  `SMTP_*`, `SLACK_*`, VAPID keys all arrive via environment (see
  `deploy/.env.example`). Keep it that way; never commit real keys.
- **DB:** single-file SQLite in WAL mode; schema lives in
  `server/src/db.ts` (`SCHEMA_SQL` + idempotent `migrate()`). Additive
  migrations only, guarded by `PRAGMA table_info`.
- **Tests:** vitest everywhere; server tests bind no real ports (they use
  `app.inject`) but some are timing-sensitive (scheduler) — avoid weakening
  timeouts. Keep the suite green before every push.
- **Worktrees:** develop in `.worktrees/<branch>` via `dev-wt`; the main
  checkout stays on `main`. Conventional Commits (`feat:`, `fix:`, `chore:` …).
