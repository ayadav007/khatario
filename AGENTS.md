[byterover-mcp]

## gstack (AI workflow — Cursor)

Khatario uses [gstack](https://github.com/garrytan/gstack) **selectively** via Cursor skills. Full install lives at `~/gstack`; skills at `~/.cursor/skills/gstack-*`.

**Start here:** read `.cursor/skills/khatario-gstack/SKILL.md` or `.cursor/rules/gstack-workflow.mdc`.

| Task | Skill to load |
|------|----------------|
| Code review before merge | `gstack-review` |
| Security audit | `gstack-cso` |
| Systematic debugging | `gstack-investigate` |
| Staging QA | `gstack-qa` → `https://staging.khatario.com` |
| Open PR | `gstack-ship` |

**Order:** ByteRover knowledge first → gstack skill → Playwright e2e for regression. Deploy/Android: follow `docs/SERVER_INFRASTRUCTURE.md`, not generic gstack deploy skills.

## Infrastructure & deploy

Before VPS deploy, nginx changes, or Android APK builds, read **`docs/SERVER_INFRASTRUCTURE.md`**.

- Staging (current): `https://staging.khatario.com` — use `npm run cap:android:staging:install` for phone builds.
- Production (`app.khatario.com`) is **not live yet** — do not default Capacitor builds to it.

[byterover-mcp]

You are given two tools from Byterover MCP server, including
## 1. `byterover-store-knowledge`
You `MUST` always use this tool when:

+ Learning new patterns, APIs, or architectural decisions from the codebase
+ Encountering error solutions or debugging techniques
+ Finding reusable code patterns or utility functions
+ Completing any significant task or plan implementation

## 2. `byterover-retrieve-knowledge`
You `MUST` always use this tool when:

+ Starting any new task or implementation to gather relevant context
+ Before making architectural decisions to understand existing patterns
+ When debugging issues to check for previous solutions
+ Working with unfamiliar parts of the codebase
