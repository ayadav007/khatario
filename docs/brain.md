# Khatario brain

The single front door for agents. Read this at the start of a session, before planning work.

## What to read

| File | What it holds | Rule |
| --- | --- | --- |
| [project.log.md](project.log.md) | Every session: what was asked, what was decided and why, what shipped | **Append only.** Add an entry before the session ends. Never edit or delete earlier entries; correct them with a new entry. |
| [roadmap.md](roadmap.md) | The board. `##` headings are columns, bullets are cards, `[[path]]` opens the card's full brief | Move a card when its state changes. Pick work from **Now** first. |
| [BACKLOG.md](BACKLOG.md) | Designed but parked features, with the agreed approach | Cards in the **Parked** column point here. |
| [IMPLEMENTATION-LOG.md](IMPLEMENTATION-LOG.md) | Older changelog, up to Aug 2026 | Read-only history. New entries go in `project.log.md`. |
| [qa/README.md](qa/README.md) | QA index and next QA task | Required before any QA work (see `AGENTS.md`). |
| [SERVER_INFRASTRUCTURE.md](SERVER_INFRASTRUCTURE.md) | VPS, nginx, APK builds | Required before deploys. |

Plans for larger work live in [plan/](plan/) and are linked from roadmap cards.

## End of session

Before you finish, append one entry to `project.log.md`:

```markdown
## YYYY-MM-DD: short title
- **Asked:** what the user wanted, in their words where possible.
- **Decided:** each decision and why. Include options rejected when the reason matters later.
- **Shipped:** commits (short hash + subject), files, migrations written (not applied), or "nothing committed".
- **Open:** what is left, blocked or unverified.
```

Then update the card on `roadmap.md` if one moved. Skip the entry only for a pure question with no decision.
