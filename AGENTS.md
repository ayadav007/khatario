# Khatario agent notes

Start every session at `docs/brain.md`: it links the project log (append an entry before you finish) and the roadmap board.

## Guardrails
- Never run migrations against staging or production. Tests use only the disposable DB `kh_phase2_test`.
- Commit, push or deploy only when asked. Stage files by name; never `git add .`, reset, stash or clean user changes.
- Never trust client-sent `business_id`, `user_id` or `created_by`. Never print DB passwords or payment secrets.
- Browser automation (Playwright MCP) only on `localhost` or `https://staging.khatario.com`, never production.

## Infrastructure & deploy
Before VPS deploy, nginx changes or Android APK builds, read `docs/SERVER_INFRASTRUCTURE.md`.
- Staging: `https://staging.khatario.com`, APK via `npm run cap:android:staging:install`.
- Production: `https://khatario.com`, second VPS clone `/var/www/khatario-prod`. Do not deploy production until `scripts/setup-khatario-production.sh` has been run.

## Tooling
Library docs, Playwright e2e and Strix usage: see `.cursor/rules/ide-mcp.mdc`.

## Code graph (graphify)
`graphify-out/graph.json` maps files, symbols and their links. Use it before Read/Grep/Glob to find where something lives and what touches it; the `graphify` MCP server (`.mcp.json`, `.cursor/mcp.json`) or the CLI both work:
- `graphify explain "<file or symbol>"`: what it uses and what uses it (sharpest; use exact names)
- `graphify query "<keywords>"`: the part of the graph around those words (matches names, so loose questions give loose results)
- `graphify path "<A>" "<B>"`: how two symbols connect
If `GRAPH_REPORT.md` names a commit far behind `git rev-parse HEAD`, or after you change code, run `graphify update .` (no API cost). Pass this rule to subagents that explore code. Full rule: `.cursor/rules/graphify.mdc`.

## QA
Before any QA, test-audit, or regression task, read `docs/qa/README.md` and follow `.cursor/rules/qa-governance.mdc`. Do not start a new module or recreate inventories when that index already records the next task.
