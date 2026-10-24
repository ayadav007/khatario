# Khatario assistant knowledge base

Content the AI assistant answers from. Reviewed like code; indexed on every deploy with
`npm run kb:reindex -- --source=markdown` (only changed chunks are re-embedded).

- `prospect/` — sales and product content for people considering Khatario (website, signup).
- `how-to/` — step-by-step guides for people using Khatario (trial users now, all tenant staff in phase 2).
- `_meta/glossary.yml` — Hinglish to English search terms.
- `generated/` — mirrors of database-backed facts (plans, add-ons, support contact). Never edit by hand;
  the assistant indexes these straight from the database.

Rules for writing content:

1. Only state what the product actually does today. If something is not built, say so plainly in
   `prospect/limitations.md` rather than leaving it out; the assistant then answers "no" correctly.
2. Never type prices, plan limits or add-on prices here. They come from `subscription_plans` via the
   generated plans document, so they always match the app.
3. One topic per `##` heading. Headings phrased like questions retrieve best.
4. Frontmatter fields: `title`, `audience` (`prospect`, `tenant_user`, `internal`), `locale`
   (`en`, `hinglish`), `tags`, `url` (citation link), `required_feature`.
