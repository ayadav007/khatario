# Khatario AI assistant

Answers questions from Khatario's own guides, in English and Hinglish, on the website, the signup page, Khatario's WhatsApp number and inside the app for every plan. It books demos, recommends a plan, captures leads and hands off to the team. The business owner also gets their own figures (in the app and on their business WhatsApp number), and each shop's WhatsApp bot answers shoppers from that shop's catalog and policies.

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
| App, trial subscriptions | `trial_app` | tenant_user | `/api/assistant/*` (JWT) |
| App, paid plans | `in_app` | tenant_user | `/api/assistant/*` (JWT) |
| Khatario's WhatsApp number | `whatsapp` | prospect, or tenant_user (how-to only) when the number belongs to an active user | `platform-incoming` queue job |
| Owner's phone, business's own WhatsApp number | `whatsapp` | tenant_owner | `owner-command` queue job |
| Shoppers, business's own WhatsApp number (QR or Cloud API) | — | tenant_customer knowledge | the shop's AI sales agent (`lib/services/sales-agent-chatbot.ts`) |

Channels are switched on and off in **/admin/assistant → Overview** (admin role).

## Business figures for the owner

The primary admin (`users.is_primary_admin`) can ask about their own business in the app or on WhatsApp: "sales today", "who owes me the most", "top products this month", "overdue invoices", "low stock", "GST alerts". Staff asking the same thing are pointed to the Dashboard and reports; they still get how-to help.

The model only picks which figures to fetch (`chooseTools` in `lib/rag/llm.ts`, Groq tool calling with the rewrite model). Every number comes from SQL in `lib/insights/tools.ts`, which reuses the report and ageing queries, and is formatted by code. Short commands ("sales today") and any model failure use keyword matching (`lib/insights/commands.ts`), so figures still work without a model key. Each tool checks the plan (`reports_basic`, `reports_advanced`, `reports_gst`) and says "Not on your plan" rather than failing. In the app the answer shows as cards linking to the full report.

### Owner updates on WhatsApp

Set up in **Settings → WhatsApp → Owner updates** (primary admin only). Messages go through the business's own number, never Khatario's:

1. **Link my phone** shows a 4-digit code valid for 15 minutes. The owner sends `LINK 1234` to the business number from their phone. On a QR-connected number where the owner's phone *is* the business number, they send it in the "Message yourself" chat.
2. After linking, any message from that phone (or that self-chat) goes to the owner assistant instead of the CRM inbox or the shop's bot. Every other sender is unaffected. 20 questions an hour.
3. **Evening summary** (default on, 21:00 Indian time) is sent by `/api/cron/owner-daily-summary` (every 15 minutes, see `docs/SERVER_INFRASTRUCTURE.md`). On QR it is a normal message. On Meta Cloud API, Meta only allows free text within 24 hours of the owner's last message; outside that the summary uses the `khatario_daily_summary` UTILITY template, created on the business's own WhatsApp Business Account with **Create summary template** and approved by Meta.

For Cloud API businesses, subscribe the tenant's Meta app webhook (`/api/webhooks/meta-whatsapp?business_id=<id>`) to the **messages** field as well as template status, and save the app secret in the Meta Cloud API form: tenant webhooks are only accepted with the tenant's own signature.

Our replies start with an invisible marker (U+2063) and their message ids are recorded in `whatsapp_inbound_events`, so in QR self-chat the assistant never answers itself. A QR self-chat that WhatsApp reports only by its LID (no phone number) isn't recognised as self-chat; link from a separate phone in that case.

## Khatario's WhatsApp number

Messages to the platform number (Meta webhook without `business_id`) are de-duplicated and answered by `answerTurn` on the `whatsapp` channel: prospects get the sales assistant, and a number that belongs to an active Khatario user gets how-to help. Business figures are never sent from this number; a user asking for them is pointed to Owner updates. Replies are plain WhatsApp text of about 1,000 characters with the first source link, and buttons become links (`/book-demo`, `/signup?src=whatsapp`, `/pricing`). 30 messages an hour per phone. Switch it off with the `whatsapp` channel in /admin/assistant. Setup: subscribe the platform Meta app's webhook to the **messages** field.

## Shop customer bot

Each business's own catalog and policies are indexed as `tenant_customer` knowledge with the `business_id` set (`lib/rag/ingest/tenant-sources.ts`): items listed in the online store (or every active item if the shop lists none) with price, MRP, a stock band and description, plus about, contact, refund, terms and delivery settings. Shop knowledge is **keyword-only** (no embeddings), so it never uses the shared Gemini quota.

- Built on the shop's first customer message, then re-indexed about a minute after item, store-settings or business-profile saves (debounced per business), and nightly. `npm run kb:reindex -- --source=tenant --business=<id>` rebuilds one shop.
- The sales agent answers from the retrieved chunks with the shop's own AI key, keeps the `CREATE_ORDER:` flow, and adds online-store order status, looked up only for the sender's own WhatsApp number (`SO-…` numbers must also match that phone).
- Cloud API shops: replies go back from the same number and appear in the WhatsApp inbox.
- Daily cap on AI replies per business: `assistant_settings` scope `business:<id>`, `{"customerBotDailyLimit": 500}` (`0` turns it off; default `CUSTOMER_BOT_DAILY_LIMIT` or 500).
- Retrieval always filters `tenant_customer` chunks by `business_id` in SQL; `tests/lib/whatsapp/customer-bot.test.ts` covers isolation.

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
