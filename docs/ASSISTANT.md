# Khatario AI assistant

Answers questions from Khatario's own guides, in English and Hinglish, on the website, the signup page and inside the app for trial users. It books demos, recommends a plan, captures leads and hands off to the team. Phase 2 (all tenant staff, Khatario's WhatsApp number) and phase 3 (tenant customer bots) reuse the same pipeline.

## How it works

1. **Knowledge** lives in `knowledge/` as Markdown with frontmatter (`id`, `title`, `audience`, `locale`, `required_feature`, `tags`). Plans and prices are generated from the database (`npm run kb:generate`) and published website pages are read from the site builder, so prices are never typed by hand. `tests/rag/knowledge-lint.test.ts` fails on hand-typed ₹ amounts.
2. **Indexing** (`lib/rag/ingest/`) splits sources into chunks, hashes them and embeds only changed chunks with Gemini (`gemini-embedding-001`, 768 dimensions). Unchanged sources are skipped.
3. **Retrieval** (`lib/rag/retrieve.ts`) merges pgvector similarity, Postgres full-text and trigram search. Every query is filtered by audience and business in SQL (`scopeFilter`). Without pgvector or an embedding key it runs on keyword search alone.
4. **Answering** (`lib/rag/answer.ts`) rewrites the question, retrieves, and streams an answer from Groq (Gemini as fallback) that cites sources as [1], [2]. When retrieval isn't confident it says so and offers a demo or a human. Without any model key, or over the daily token budget, it quotes the best matching guide section instead.
5. **Actions** (demo booking with WhatsApp OTP, plan recommendation, lead capture, talk to a human) come from intent detection, never from model output.

## GST law

`knowledge/gst-law/` holds the official text of the CGST, IGST, UTGST and Compensation Acts and the CGST and IGST Rules, downloaded from the [CBIC Tax Information Portal](https://taxinformation.cbic.gov.in/). These files have the audience `gst_law`, which is never a conversation audience, so prospects and shoppers can't retrieve them.

For signed-in business users (`tenant_user`) only, `answerTurn` runs a second search over the law when the question looks legal (`lib/rag/gst-law.ts`: sections, rules, penalties, time limits, ITC, reverse charge, registration and so on), or when Khatario's guides have no confident answer. Explicit law questions lead with the law; GST topics keep the Khatario guide first and add up to two law sections. When law sources are used, the model explains in plain words, cites the provision ("CGST Act, Section 31"), avoids stating rates or notified dates, and ends by suggesting the user check with their CA.

Refresh the text after a Finance Act or major amendment:

```bash
npm run kb:fetch-gst-law                  # all six; --only=cgst-act for one
npm run kb:reindex -- --source=markdown
```

The text omits amendment footnotes and doesn't include notifications, circulars or rate schedules. Keyword-only search (no embeddings) ranks legal text loosely; staging and production should run with embeddings.

## Where it appears

| Surface | Channel | Audience | Route |
|---|---|---|---|
| Landing, pricing, `/book-demo` | `web` | prospect | `/api/public/assistant/*` |
| `/signup` | `signup` | prospect | `/api/public/assistant/*?channel=signup` |
| App, trial subscriptions only | `trial_app` | tenant_user | `/api/assistant/*` (JWT) |

Channels are switched on and off in **/admin/assistant → Overview** (admin role).

## Keeping knowledge current

| Change | What re-indexes it |
|---|---|
| Edit a file in `knowledge/` | Deploy (`scripts/deploy-vps.sh` runs a re-index after migrations) |
| Save a plan, its limits or features in /admin | Queued automatically (`plans`) |
| Publish a website page in the site builder | Queued automatically (`marketing`, that page) |
| Anything else / safety net | Nightly 03:00 IST job, or **/admin/assistant → Knowledge sources** |

Jobs go to the BullMQ `kb-index` queue when Redis is up (`npm run worker:kb`). Without Redis they run inside the web process. The same nightly job deletes conversations idle longer than `ASSISTANT_RETENTION_DAYS`; leads are kept. Servers without the worker can call `POST /api/cron/assistant-maintenance` with the cron Bearer secret instead.

Unanswered questions and thumbs-down answers show up in /admin/assistant. Fix them by adding or editing a guide in `knowledge/`, then add the question to `tests/rag/eval-set.yml`.

## Commands

```bash
npm run kb:reindex                        # everything; add --source=markdown|plans|marketing, --force, --dry-run
npm run kb:generate                       # regenerate knowledge/generated/plans.md from the DB
npm run kb:fetch-gst-law                  # re-download the GST Acts and Rules from CBIC into knowledge/gst-law/
npm run kb:eval                           # retrieval hit rate + MRR against tests/rag/eval-set.yml (fails below 85%)
npm run kb:ask -- --audience=tenant_user "GST report kaise nikale"
npm run kb:enable-vector                  # add the embedding column + HNSW index after installing pgvector
npm run worker:kb                         # queue worker + nightly job
npm run test:rag                          # unit + isolation tests (also runs in CI on knowledge/ or lib/rag changes)
npx playwright test e2e/assistant.spec.ts
```

## Environment

| Variable | Default | Notes |
|---|---|---|
| `GROQ_API_KEY` | — | Chat answers and question rewrite |
| `GEMINI_API_KEY` | — | Embeddings, and chat fallback |
| `GROQ_RAG_MODEL` | `openai/gpt-oss-120b` | Answer model |
| `GROQ_REWRITE_MODEL` | `openai/gpt-oss-20b` | Rewrite / intent model |
| `ASSISTANT_GEMINI_MODEL` | `gemini-3.5-flash` | Chat fallback. Separate from `GEMINI_MODEL`, which the invoice scanner uses |
| `GEMINI_EMBED_MODEL` | `gemini-embedding-001` | Changing it needs `kb:reindex --force` |
| `ASSISTANT_DAILY_TOKEN_BUDGET` | `2000000` | Platform-wide per IST day; `0` = unlimited |
| `ASSISTANT_RETENTION_DAYS` | `90` | Conversation retention |
| `ASSISTANT_ENABLED` | `true` | `false` hides the assistant everywhere |
| `ASSISTANT_MIN_VECTOR_SIMILARITY`, `ASSISTANT_MIN_TERM_COVERAGE` | `0.55`, `0.5` | Confidence thresholds; re-run `kb:eval` after changing |

## Limits and safety

- Public chat: 10 messages a minute per visitor, 20 a minute and 300 a day per IP. In-app: 15 a minute per user, 400 a day per business. Limits are in memory per process.
- Messages are capped at 1,000 characters. The widget tells users not to share passwords or OTPs.
- Conversations resume only for the visitor cookie (`kh_av`) or logged-in user that started them.
- Unverified lead submissions only fill empty fields; contact details change only after a WhatsApp-verified demo booking.
- `tests/security/rag-isolation.test.ts` covers scope filtering, ownership, lead overwrite and prompt-injection containment.
