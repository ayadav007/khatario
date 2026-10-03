# Khatario agent notes

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
