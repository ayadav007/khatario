# Connect leads, sub-project 1: leads table — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Connect a real `leads` table so the pipeline, repeat enquiries, leads without a WhatsApp chat and convert-to-customer all work on leads instead of chats.

**Architecture:** Migration 447 adds `leads`, re-points follow-ups, imports and timeline events, backfills one lead per chat on the board, and adds an auto-won trigger on invoices and sales orders. A new `lib/leads/` module owns every lead write (open, stage, link, close); WhatsApp storage, ads, links, imports, flows and the AI agent call it instead of writing stage columns on `whatsapp_conversations`. The board, dashboard and a new Leads page read `leads`; the chat-facing deal API keeps its shape and resolves the chat's open lead.

**Tech Stack:** Next.js 14 app router, TypeScript, PostgreSQL via `@/lib/db` (`query`, `queryOne`, `queryRows`), Jest DB tests on `kh_phase2_test`, React + Tailwind components in `components/whatsapp/`.

**Spec:** [docs/plan/CONNECT_LEADS.md](CONNECT_LEADS.md), section "Sub-project 1: leads table". Read it with this plan.

## Global Constraints

- `business_id`, `user_id` and `created_by` always come from the session (`withWhatsAppPremiumApi` context), never from the request body.
- Migrations run only against `kh_phase2_test` while building. Never against staging or production.
- Migration number is `447`; if another session has taken 447 by the time you start, use the next free number and rename everywhere in this plan.
- Phone numbers: normalise with `normalizeLeadPhone` (`lib/whatsapp/lead-sources.ts`, digits with country code, bare 10-digit gets `91`). Match a lead to a customer, supplier, staff or chat on the last 10 digits.
- One open lead per business and phone: `closed_at IS NULL` means open.
- Repeat rule constants: `QUIET_DAYS = 30`, lost reason for a stale lead `'Went quiet'`.
- `source` values on a lead: `ctwa_ad`, `link`, `indiamart`, `lead_api`, `manual`, `call`, `walk_in`; `NULL` is Direct.
- `lead_type` values: `new`, `existing` (existing = a customer matched by phone when the lead opened). It never changes afterwards.
- The legacy `whatsapp_conversations.lead_status` keeps being written on every stage change. `stage_id`, `deal_value`, `expected_close_on`, `lost_reason`, `stage_changed_at`, `source`, `source_detail`, `source_at` on chats are no longer written after Task 3; they stay one release for rollback.
- Groups never get leads.
- Stage files by name; never `git add .`. Commit to `main` at the end of each task only if the owner has said to commit during this build; otherwise leave the work staged-free and report.
- DB test command: `INBOX_DB_TEST=1 npx jest <file> --runInBand`. Every DB test file starts with the same env bootstrap and `current_database()` guard as `tests/db/whatsapp-direct-leads.db.test.ts`.

## Deviations from the spec (decided while planning)

- **Auto-won is a database trigger**, not app hooks. Invoices are inserted in at least seven places (`app/api/invoices/route.ts` four times, `createInvoiceInTransaction` and its five callers, `lib/whatsapp-crm.ts`) and sales orders in three. One `AFTER INSERT OR UPDATE` trigger covers them all; it swallows its own errors so an invoice never fails. Same pattern as migration 445's notification trigger.
- **`whatsapp_lead_profiles` does not get `lead_id` yet.** The summary stays per chat; sub-project 2 moves score and summary to the lead. The Leads list and board show the linked chat's temperature and score, as the board does today, instead of leaving them blank.
- **No row checkboxes on the Leads page yet.** Export takes the current filters; picking rows arrives with the broadcast audience in sub-project 3.
- **Permissions** follow what the pipeline uses today: read = `inboxPermission: 'read'`, create/edit/convert/new enquiry = `inboxPermission: 'update'`, export = `inboxPermission: 'export'`.
- **New customers on convert** use the existing `POST /api/customers` from the browser, then link with `POST /api/whatsapp/leads/[id]/convert { customer_id }`. No second customer-create path.
- **Follow-ups and timeline events may have no chat**: `whatsapp_followups.conversation_id` and `whatsapp_automation_events.conversation_id` become nullable with a check that a chat or a lead is set.
- **Imported leads keep their source's labels** in `source_detail.label_ids` and get them when a chat links, since labels live on chats.

## Review Focus

1. **Same person, different phone formats:** an IndiaMART lead `+91-98765 43210` and a later WhatsApp message from `919876543210` must land on one lead. Test in Task 4.
2. **Reopening a closed lead while a newer one is open:** moving a won lead back to an open stage must return 409 `LEAD_ALREADY_OPEN`, not a 500 from the unique index. Test in Task 2.
3. **Agent visibility:** an agent must not list, open, edit or export a lead whose chat they cannot open; unlinked leads are visible only when unowned or owned by them. Test in Task 6.
4. **An invoice must never fail because of leads:** a business with no won stage, or a customer with two open leads somehow, still saves the invoice. Test in Task 7.
5. **CSV export of hostile names:** a contact name like `=HYPERLINK(...)` or `Sharma, "Raju"` must export as text. Test in Task 6.

---

## File map

| File | Responsibility |
| --- | --- |
| `database/migrations/447_connect_leads.sql` (create) | `leads` table, re-pointed columns, backfill, auto-won trigger |
| `lib/leads/core.ts` (create) | Lead type, errors, find/open/link/touch/stage/patch/close; the only writer of `leads` |
| `lib/leads/chat-deal.ts` (create) | Chat-facing wrappers: deal view, set deal, legacy-key stage (moved from `pipeline.ts`) |
| `lib/leads/inbound.ts` (create) | Repeat rule on each inbound message, activity on outbound |
| `lib/leads/visibility.ts` (create) | `leadVisibilityClause` |
| `lib/leads/list.ts` (create) | List, detail, manual create, new enquiry, CSV |
| `lib/leads/convert.ts` (create) | Customer match and link |
| `lib/whatsapp/pipeline.ts` (modify) | Board, summary, `deleteStage` on leads; drop `loadDeal`/`setDeal`/`setStageByLegacyKey` |
| `lib/whatsapp/lead-sources.ts` (modify) | Ads, links, imports through `lib/leads`; remove `routeLead`, `setSourceOnce`, `attributeNewChat`, `addNewChatToPipeline` |
| `lib/whatsapp/followups.ts` (modify) | Follow-ups carry `lead_id`; no-chat leads |
| `lib/whatsapp-crm.ts`, `lib/whatsapp/flows/actions.ts`, `lib/ai-agent/leads.ts` (modify) | Call `lib/leads` |
| `app/api/whatsapp/leads/**` (create) | Leads APIs |
| `app/api/whatsapp/pipeline/route.ts`, `app/api/whatsapp/conversations/[id]/deal/route.ts`, `app/api/whatsapp/followups/route.ts`, `app/api/whatsapp/conversations/[id]/timeline/route.ts` (modify) | Switch to leads |
| `lib/notifications/notification-href.ts` (modify) | `whatsapp_lead` reference opens the Leads page |
| `components/whatsapp/leads/*` (create), `app/(app)/whatsapp/leads/page.tsx` (create) | Leads page, add form, drawer, convert dialog, chat panel section |
| `components/whatsapp/pipeline/PipelineBoard.tsx`, `components/whatsapp/conversations/ContactPanel.tsx`, `lib/navigation/connect-nav-items.ts` (modify) | Board on leads, chat panel section, nav |
| `tests/db/connect-leads-*.db.test.ts` (create), `tests/db/fixtures/connect-leads.ts` (create) | Tests and shared seeding |

---

### Task 1: Migration 447 — table, re-pointed columns, backfill

**Files:**
- Create: `database/migrations/447_connect_leads.sql`
- Create: `tests/db/fixtures/connect-leads.ts`
- Test: `tests/db/connect-leads-migration.db.test.ts`

**Interfaces:**
- Produces: table `leads` with the spec's columns: `id UUID PK DEFAULT uuid_generate_v4()`, `business_id` (FK businesses CASCADE), `contact_phone VARCHAR(20) NOT NULL`, `contact_name VARCHAR(120)`, `conversation_id` (FK whatsapp_conversations SET NULL), `customer_id` (FK customers SET NULL), `lead_type VARCHAR(8) NOT NULL DEFAULT 'new' CHECK IN ('new','existing')`, `stage_id` (FK whatsapp_pipeline_stages SET NULL), `deal_value NUMERIC(14,2) CHECK >= 0`, `expected_close_on DATE`, `lost_reason VARCHAR(200)`, `stage_changed_at TIMESTAMPTZ`, `owner_id` (FK users SET NULL), `source VARCHAR(16)` (check list from Global Constraints), `source_detail JSONB`, `source_at TIMESTAMPTZ`, `note VARCHAR(1000)`, `opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `closed_at TIMESTAMPTZ`, `last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `created_by` (FK users SET NULL), `created_at`, `updated_at`.
- Produces: unique index `leads_one_open_per_phone ON leads (business_id, contact_phone) WHERE closed_at IS NULL`; indexes from the spec.
- Produces: `whatsapp_followups.lead_id`, `whatsapp_lead_imports.lead_id`, `whatsapp_automation_events.lead_id` (all nullable FK leads ON DELETE CASCADE for follow-ups/events, SET NULL for imports); `whatsapp_followups.conversation_id` and `whatsapp_automation_events.conversation_id` drop NOT NULL with `CHECK (conversation_id IS NOT NULL OR lead_id IS NOT NULL)`.
- Produces (fixture): `seedBusiness(tag: string): Promise<{ businessId: string; agentId: string; supervisorId: string }>`, `seedChat(businessId: string, opts?: { phone?: string; name?: string }): Promise<{ id: string; phone: string }>`, `cleanupBusinesses(ids: string[]): Promise<void>` (deletes leads, follow-ups, events, messages, chats, stages, customers, suppliers, settings, users, roles, businesses in FK order).

- [ ] **Step 1: Write the fixture and the failing test** `tests/db/connect-leads-migration.db.test.ts`:
  - `test('backfill makes one lead per chat on the board, with its deal, source, owner and follow-ups')`: seed stages with `ensureStages`, three chats: A in "Interested" with `deal_value 5000`, `expected_close_on '2026-12-01'`, `source 'link'`, `source_detail {link_id:'x'}`, `assigned_to = agentId`, a pending follow-up; B in "Lost" with `lost_reason 'price'`, `stage_changed_at '2026-10-01'`; C with no stage. Run the migration file (`query(fs.readFileSync('database/migrations/447_connect_leads.sql','utf8'))`). Assert: 2 leads for the business; A's lead has `stage_id`, `deal_value 5000`, `expected_close_on '2026-12-01'`, `source 'link'`, `owner_id agentId`, `conversation_id A`, `closed_at NULL`, `opened_at = A.source_at ?? A.created_at`; the follow-up's `lead_id` = A's lead; B's lead has `closed_at = '2026-10-01'`, `lost_reason 'price'`; no lead for C.
  - `test('running the migration again changes nothing')`: run it a second time; lead count unchanged.
  - `test('one open lead per phone')`: inserting a second open lead for A's phone rejects with code `23505`; inserting one with `closed_at = NOW()` succeeds.
  - `test('a follow-up or event needs a chat or a lead')`: inserting a follow-up with both `conversation_id` and `lead_id` NULL rejects with code `23514`.
- [ ] **Step 2: Run** `INBOX_DB_TEST=1 npx jest tests/db/connect-leads-migration.db.test.ts --runInBand`. Expected: FAIL, migration file missing.
- [ ] **Step 3: Write the migration.** Header comment in the style of migration 446. Every statement re-runnable (`IF NOT EXISTS`, `DO $$ ... IF NOT EXISTS (pg_constraint) ...`). Backfill: `INSERT INTO leads (...) SELECT ... FROM whatsapp_conversations c WHERE c.stage_id IS NOT NULL AND NOT COALESCE(c.is_group,false) AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.conversation_id = c.id)`, with `contact_phone` = digits of `from_number`, `contact_name` = `whatsapp_display_name`, `lead_type` = `CASE WHEN c.customer_id IS NOT NULL THEN 'existing' ELSE 'new' END`, `closed_at` = `c.stage_changed_at` when the stage kind is won or lost, `last_activity_at` = `COALESCE(c.last_message_at, c.updated_at, NOW())`. If two chats share a phone and are both open, keep the most recently active one open and close the other as it is (`closed_at = NOW()`, no stage change) so the unique index holds. Then `UPDATE whatsapp_followups f SET lead_id = l.id FROM leads l WHERE l.conversation_id = f.conversation_id AND f.lead_id IS NULL AND l.closed_at IS NULL` (fall back to the newest lead for the chat), same for `whatsapp_lead_imports`.
- [ ] **Step 4: Apply to the test DB and run the test.** Expected: PASS (4 tests).
- [ ] **Step 5: Commit** `database/migrations/447_connect_leads.sql`, `tests/db/fixtures/connect-leads.ts`, `tests/db/connect-leads-migration.db.test.ts`.

### Task 2: `lib/leads/core.ts` — the only writer of leads

**Files:**
- Create: `lib/leads/core.ts`, `lib/leads/chat-deal.ts`
- Modify: `lib/whatsapp/pipeline.ts` (remove `loadDeal`, `setDeal`, `setStageByLegacyKey`, keep `DealPatch`, `DealActor`, `DealView`, `PipelineError` exported), `app/api/whatsapp/conversations/[id]/deal/route.ts`, `lib/whatsapp/flows/actions.ts`, `lib/ai-agent/leads.ts`, `app/api/whatsapp/conversations/[id]/timeline/route.ts`
- Test: `tests/db/connect-leads-core.db.test.ts`; update `tests/db/whatsapp-pipeline.db.test.ts` imports and the deal/flow/AI tests to read the lead

**Interfaces:**
- Consumes: Task 1 schema and fixture; `ensureStages`, `PipelineStage`, `DealPatch`, `DealActor`, `DealView`, `PipelineError` from `lib/whatsapp/pipeline.ts`; `normalizeLeadPhone` from `lib/whatsapp/lead-sources.ts`; `broadcastOwnership`, `isEligibleInboxAgent` from `lib/whatsapp/inbox-ownership.ts`.
- Produces (`lib/leads/core.ts`):
  - `export const QUIET_DAYS = 30; export const WENT_QUIET_REASON = 'Went quiet';`
  - `export const LEAD_SOURCE_KEYS = ['ctwa_ad','link','indiamart','lead_api','manual','call','walk_in'] as const; export type LeadSourceKey = (typeof LEAD_SOURCE_KEYS)[number];`
  - `export interface Lead { id: string; business_id: string; contact_phone: string; contact_name: string | null; conversation_id: string | null; customer_id: string | null; lead_type: 'new' | 'existing'; stage_id: string | null; deal_value: number | null; expected_close_on: string | null; lost_reason: string | null; stage_changed_at: string | null; owner_id: string | null; source: LeadSourceKey | null; source_detail: Record<string, unknown> | null; source_at: string | null; note: string | null; opened_at: string; closed_at: string | null; last_activity_at: string; created_by: string | null }`
  - `export class LeadError extends Error { constructor(message: string, readonly status: 400 | 403 | 404 | 409, readonly code: string) }`
  - `export async function loadLead(businessId: string, leadId: string): Promise<Lead | null>`
  - `export async function findOpenLead(businessId: string, phone: string): Promise<Lead | null>` (phone normalised inside)
  - `export interface OpenLeadInput { phone: string; name?: string | null; conversationId?: string | null; source?: LeadSourceKey | null; sourceDetail?: Record<string, unknown> | null; stageId?: string | null; ownerId?: string | null; note?: string | null; createdBy?: string | null; actor: DealActor }`
  - `export async function openLead(businessId: string, input: OpenLeadInput): Promise<{ lead: Lead; created: boolean }>` — bad phone → `LeadError 400 BAD_PHONE`; foreign stage → `LeadError 404 STAGE_NOT_FOUND`; owner not an eligible inbox agent → `LeadError 400 BAD_OWNER`; default stage = first open stage; `lead_type`/`customer_id` from a customer matched on the last 10 digits; `INSERT ... ON CONFLICT (business_id, contact_phone) WHERE closed_at IS NULL DO NOTHING`, on no row read the open lead back and return `created: false` (link `conversationId` if it was empty); on create write a `stage_changed` event (`from_stage: null`) with `lead_id` and the chat's id.
  - `export async function setLeadStage(businessId: string, leadId: string, stageId: string | null, actor: DealActor, lostReason?: string | null): Promise<Lead>` — won/lost stage sets `closed_at = NOW()`, open or null clears it; a unique violation on reopen → `LeadError 409 LEAD_ALREADY_OPEN`; writes `lead_status` on the linked chat with today's `legacyStatusFor`; event as today plus `lead_id`; `broadcastOwnership` when a chat is linked.
  - `export interface LeadPatch extends DealPatch { ownerId?: string | null; contactName?: string | null; note?: string | null }`
  - `export async function patchLead(businessId: string, leadId: string, patch: LeadPatch, actor: DealActor): Promise<Lead>` — value/date/reason rules as today's `setDeal`; `stageId` delegates to `setLeadStage`; touches `last_activity_at` for agent actors.
  - `export async function closeLeadAsWentQuiet(businessId: string, leadId: string): Promise<void>` — first lost stage by position, reason `WENT_QUIET_REASON`, actor `{ source: 'auto' }`.
  - `export async function linkChatToLead(businessId: string, leadId: string, conversationId: string): Promise<void>` — only when the lead has no chat; applies `source_detail.label_ids` to the chat; sets chat `customer_id` when the lead has one and the chat has none.
  - `export async function touchLead(businessId: string, leadId: string): Promise<void>`
- Produces (`lib/leads/chat-deal.ts`):
  - `export async function openLeadForChat(businessId: string, conversationId: string): Promise<Lead | null>` — by `conversation_id`, else by the chat's phone.
  - `export async function loadChatDeal(businessId: string, conversationId: string): Promise<(DealView & { lead_id: string | null }) | null>` — `null` chat → `null`; no open lead → all deal fields null, `lead_id: null`.
  - `export async function setChatDeal(businessId: string, conversationId: string, patch: DealPatch, actor: DealActor): Promise<DealView & { lead_id: string | null }>` — no open lead and a `stageId` → `openLead` for the chat's phone; no open lead and no `stageId` → `PipelineError 400 NO_LEAD` "Put this chat on the pipeline first"; groups → `PipelineError 400 GROUP_CHAT`.
  - `export async function setChatStageByLegacyKey(businessId: string, conversationId: string, key: LegacyLeadStatus, actor: DealActor): Promise<void>`

- [ ] **Step 1: Write failing tests** in `tests/db/connect-leads-core.db.test.ts`:
  - `openLead creates once per phone`: two `openLead` calls with `'+91 98765 00001'` and `'919876500001'` → first `created: true`, second `created: false`, same `id`, `contact_phone '919876500001'`, stage name `'New'`.
  - `concurrent openLead makes one lead`: `Promise.all` of 5 `openLead` for one phone → one distinct id, exactly one `created: true`.
  - `lead_type existing when the phone is a customer`: customer phone `'98765 00002'` → `lead_type 'existing'`, `customer_id` set.
  - `won closes, reopening with another open lead is refused` (Review Focus 2): lead L1 → Won (`closed_at` set, chat `lead_status 'converted'`); `openLead` same phone → L2; `setLeadStage(L1, interested)` rejects `LeadError` with `status 409`, `code 'LEAD_ALREADY_OPEN'`.
  - `stage event carries lead_id and works with no chat`: lead without chat → `setLeadStage` → one `whatsapp_automation_events` row with `lead_id` = L, `conversation_id` NULL, `event_data.to_stage 'Interested'`.
  - `setChatDeal opens a lead for a chat with none, refuses value-only`: `setChatDeal(chat, { dealValue: 10 })` rejects `code 'NO_LEAD'`; `setChatDeal(chat, { stageId })` → `lead_id` set, `loadChatDeal` returns that stage.
  - `closeLeadAsWentQuiet`: lead ends in the lost stage with `lost_reason 'Went quiet'` and `closed_at` set.
  - `rejects another business's stage and a non-agent owner`: codes `STAGE_NOT_FOUND`, `BAD_OWNER`.
- [ ] **Step 2: Run** `INBOX_DB_TEST=1 npx jest tests/db/connect-leads-core.db.test.ts --runInBand`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `lib/leads/core.ts` and `lib/leads/chat-deal.ts` per the Interfaces. Move `legacyStatusFor`, `parseDealValue`, `parseCloseDate` from `pipeline.ts` into `core.ts` (export the latter two for `chat-deal.ts`).
- [ ] **Step 4: Switch callers.** Deal route GET/PATCH use `loadChatDeal`/`setChatDeal` and return `{ deal, stages }` / `{ deal }` as today (`deal` now also has `lead_id`). `flows/actions.ts` calls `setChatDeal(businessId, conversationId, { stageId }, { source: 'flow' })`. `ai-agent/leads.ts` calls `setChatStageByLegacyKey`. Timeline route: a `stage_changed` event with `event_data.reference` reads `Won: ${reference}` (used by Task 7).
- [ ] **Step 5: Run** the core test, `tests/db/whatsapp-pipeline.db.test.ts` (fix its deal/flow/AI assertions to read the chat's lead instead of `whatsapp_conversations.stage_id`) and `npx tsc --noEmit -p tsconfig.json`. Expected: PASS, 0 errors.
- [ ] **Step 6: Commit** the files above.

### Task 3: Inbound and outbound messages follow the repeat rule; ads and links open leads

**Files:**
- Create: `lib/leads/inbound.ts`
- Modify: `lib/whatsapp-crm.ts` (new-chat block at the `attributeNewChat`/`addNewChatToPipeline` call, and the scheduling points in `storeIncomingMessage` / `storeOutgoingMessage`), `lib/whatsapp/lead-sources.ts` (`applyAdReferral`; remove `routeLead`, `setSourceOnce`, `attributeNewChat`, `addNewChatToPipeline`; add `linkRoutingForText`)
- Test: `tests/db/connect-leads-inbound.db.test.ts`; update `tests/db/whatsapp-direct-leads.db.test.ts` and the ad/link cases in `tests/db/whatsapp-lead-sources.db.test.ts` to read leads

**Interfaces:**
- Consumes: Task 2 `findOpenLead`, `openLead`, `linkChatToLead`, `touchLead`, `closeLeadAsWentQuiet`, `QUIET_DAYS`; `isKnownNumber`, `getDirectChatSetting`, `extractRefCode` from `lead-sources.ts`.
- Produces (`lead-sources.ts`): `export async function linkRoutingForText(businessId: string, text: string | null | undefined): Promise<{ linkId: string; name: string; code: string; stageId: string | null; ownerId: string | null; labelIds: string[] } | null>` (counts nothing; same lookup as today's `attributeNewChat`).
- Produces (`lib/leads/inbound.ts`):
  - `export type InboundLeadAction = 'joined' | 'opened' | 'reopened_after_quiet' | 'none';`
  - `export async function leadForInboundMessage(businessId: string, conversationId: string, phone: string, text: string | null): Promise<{ leadId: string | null; action: InboundLeadAction }>` — rules in this order: (1) open lead active within `QUIET_DAYS` → link chat if unlinked, touch, `joined`; (2) open but stale → `closeLeadAsWentQuiet`, remember it; (3) a link code in `text` → `openLead` with source `link`, `sourceDetail { link_id, name, code, label_ids }`, the link's stage and owner; (4) else not `isKnownNumber` and the "New numbers" switch on → `openLead` with source `null`; (5) else `none`. Result is `reopened_after_quiet` when (2) happened and a lead opened. Never throws (logs and returns `none`).
  - `export async function touchLeadForChat(businessId: string, conversationId: string): Promise<void>` — the chat's open lead by chat id or phone: link if unlinked, touch. Never throws.
- Changes `applyAdReferral(businessId, conversationId, ref)` to: open lead for the chat's phone (or reuse the open one) and set `source = 'ctwa_ad'`, `source_detail`, `source_at` only when the lead's `source` is NULL and it opened in the last 10 minutes (the message that carried the ad just opened it), else leave it. Same `detail` shape as today.

- [ ] **Step 1: Write failing tests** in `tests/db/connect-leads-inbound.db.test.ts` (call `storeIncomingMessage` / `storeOutgoingMessage` from `@/lib/whatsapp-crm` with the same mocks as `whatsapp-direct-leads.db.test.ts`):
  - `new number's first message opens a Direct lead linked to the chat`: lead `source NULL`, `lead_type 'new'`, `conversation_id` = chat, stage `'New'`.
  - `a second message joins the open lead`: still one lead, `last_activity_at` moved forward.
  - `quiet 30 days: old lead lost as went quiet, a new one opens`: set the lead's `last_activity_at = NOW() - INTERVAL '31 days'`, send a message → old lead `closed_at` set, `lost_reason 'Went quiet'`; a new open lead on the same chat; action `reopened_after_quiet`.
  - `29 days quiet still joins`: `last_activity_at = NOW() - INTERVAL '29 days'` → same lead.
  - `after a won lead, a non-customer's message opens a new lead`.
  - `a customer's message opens nothing, even after a closed lead`: customer by phone, message → no open lead.
  - `link code on a returning number opens a link lead with the link's stage and owner`.
  - `ad referral sets the source on the lead just opened, not on an old one`: new number message then `applyAdReferral` → lead `source 'ctwa_ad'`, `source_detail.ad_id`; for a lead opened 2 days ago, `applyAdReferral` leaves `source` NULL.
  - `an outbound message touches and links the open lead`: lead with no chat for phone P (insert via `openLead`), `storeOutgoingMessage` on a new chat for P → lead `conversation_id` = chat.
  - `chats get no stage columns written`: after the above, `whatsapp_conversations.stage_id` and `source` stay NULL on new chats.
  - `groups never get a lead`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** `lib/leads/inbound.ts` and `linkRoutingForText`; rewrite `applyAdReferral`.
- [ ] **Step 4: Wire `lib/whatsapp-crm.ts`.** In `storeIncomingMessage`, for non-group chats, after the message is stored and before `scheduleLeadSummary`: `await leadForInboundMessage(businessId, conversation.id, normalizedFrom, messageText)`. Remove the new-chat `attributeNewChat` / `addNewChatToPipeline` block. In `storeOutgoingMessage`, before `scheduleLeadSummary`: `await touchLeadForChat(businessId, conversationId)`.
- [ ] **Step 5: Run** the inbound test, then `tests/db/whatsapp-direct-leads.db.test.ts` and `tests/db/whatsapp-lead-sources.db.test.ts` after updating their assertions to read `leads` (rename the direct-leads expectations: `addNewChatToPipeline` cases become `leadForInboundMessage` cases with the same known-number and switch rules). `npx tsc --noEmit -p tsconfig.json`. Expected: PASS, 0 errors.
- [ ] **Step 6: Commit.**

### Task 4: IndiaMART and webhook leads without a chat; link counts from leads

**Files:**
- Modify: `lib/whatsapp/lead-sources.ts` (`importLead`, `receiveWebhookLead`, `listEntryLinks` stats, `SourceForImport` unchanged)
- Test: `tests/db/connect-leads-imports.db.test.ts`; update the IndiaMART/webhook/dashboard cases in `tests/db/whatsapp-lead-sources.db.test.ts`

**Interfaces:**
- Consumes: Task 2 `openLead`; Task 3 `leadForInboundMessage`.
- Produces: `export async function importLead(src: SourceForImport, lead: IncomingLead): Promise<{ leadId: string; created: boolean } | null>` — claims the import row as today, then `openLead` with `phone`, `name`, `source` (`indiamart` or `lead_api`), `sourceDetail { lead_source_id, name, ...lead.detail, message, label_ids: src.label_ids }`, `stageId: src.stage_id`, `ownerId: src.assign_to`, `note` = the enquiry summary, actor `{ source: 'auto' }`; sets `whatsapp_lead_imports.lead_id`. No chat row, no custom field. An open lead for the number is reused (`created: false`) and keeps its own source.
- Produces: `receiveWebhookLead(token, body): Promise<{ leadId: string; duplicate: boolean }>`. The public webhook route's response stays `{ ok, duplicate }`; ids are not exposed to outside callers.

- [ ] **Step 1: Write failing tests:**
  - `IndiaMART lead has no chat, then links when the buyer messages` (Review Focus 1): fake fetch returns `SENDER_MOBILE '+91-98765 43210'` → one lead, `conversation_id NULL`, `source 'indiamart'`, no new `whatsapp_conversations` row for that phone; `storeIncomingMessage` from `919876543210@s.whatsapp.net` → same lead, now linked, and gets the source's labels on the chat.
  - `the same IndiaMART query twice imports once`.
  - `webhook lead for a number with an open lead reuses it`: `duplicate false`, `created false`, lead source unchanged.
  - `link stats count leads`: a link lead won → `listEntryLinks` shows `chats 1, won 1` (field names kept).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces; `listEntryLinks` stats read `leads l LEFT JOIN whatsapp_pipeline_stages s` with `l.source = 'link' AND l.source_detail->>'link_id' = el.id::text`.
- [ ] **Step 4: Run** the new test and `tests/db/whatsapp-lead-sources.db.test.ts`; `tsc`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 5: Board, dashboard, stage delete and follow-ups on leads

**Files:**
- Create: `lib/leads/visibility.ts`
- Modify: `lib/whatsapp/pipeline.ts` (`BoardCard`, `loadBoard`, `loadPipelineSummary`, `deleteStage`), `lib/whatsapp/followups.ts`, `app/api/whatsapp/followups/route.ts`, `lib/notifications/notification-href.ts`
- Test: `tests/db/connect-leads-board.db.test.ts`; update `tests/db/whatsapp-pipeline.db.test.ts` board, stage-admin, follow-up and dashboard cases

**Interfaces:**
- Consumes: `visibilityClause`, `InboxViewer` from `inbox-ownership.ts`; Task 2 `openLeadForChat`.
- Produces (`lib/leads/visibility.ts`): `export function leadVisibilityClause(viewer: InboxViewer, leadAlias: string, chatAlias: string, nextParam: number): { sql: string; params: unknown[] }` — supervisor → `TRUE`; else `(${l}.conversation_id IS NOT NULL AND <visibilityClause(viewer, chatAlias, nextParam)>) OR (${l}.conversation_id IS NULL AND (${l}.owner_id IS NULL OR ${l}.owner_id = $n::uuid))`. The caller `LEFT JOIN`s the chat as `chatAlias`.
- Changes `BoardCard`: `id` is the lead id; adds `conversation_id: string | null`, `lead_type: 'new' | 'existing'`; `owner_id`/`owner_name` from `leads.owner_id`; `is_customer` = `customer_id IS NOT NULL`; `name` = customer name, else `contact_name`, else the chat's WhatsApp name, else phone; `last_message_text`/`last_message_at`, `summary`, `temperature`, `lead_score` from the linked chat (NULL without one). Board filters unchanged in meaning: `ownerId` → `l.owner_id`, `source` → `l.source` (`'direct'` = NULL), `labelId` → the linked chat's labels.
- Changes `PipelineSummary.by_source` to count leads by `l.opened_at` in the window (`leads` = opened, `on_board` = with a stage); `by_agent` groups by `l.owner_id`.
- Changes `deleteStage(businessId, stageId, moveToId)` to move leads.
- Changes follow-ups: `FollowupRow` adds `lead_id: string | null`, `conversation_id: string | null`; `createFollowup(viewer, input: { conversationId?: string | null; leadId?: string | null; dueAt; note?; assignedTo?; cancelOnReply? })` — with a chat, `lead_id` = the chat's open lead (may be null); with only a lead, `conversation_id` NULL and `cancelOnReply` forced false; `listFollowups` query gains `leadId?: string`; contact name falls back to the lead's `contact_name`/`contact_phone` via `LEFT JOIN leads`; the cron notifies with reference `whatsapp_lead` + lead id when there is no chat. `notification-href.ts`: `refType === 'whatsapp_lead' && id` → `/whatsapp/leads?lead=${id}`. The follow-ups route accepts `lead_id` (checked visible with `leadVisibilityClause`) or `conversation_id`.

- [ ] **Step 1: Write failing tests** in `tests/db/connect-leads-board.db.test.ts`:
  - `board shows leads, including one with no chat`: a chat lead and a manual-style lead (via `openLead` without chat) in "New" → two cards; the no-chat card has `conversation_id null`, `name` = its `contact_name`.
  - `an agent sees chat leads they could open and unowned or own no-chat leads`: agent viewer; a no-chat lead owned by the supervisor is hidden; an unowned one is shown.
  - `owner filter uses the lead owner`.
  - `deleting a stage moves its leads`: two leads in "Follow up", `deleteStage(…, followUp, interested)` → both in "Interested".
  - `dashboard counts leads by source and owner`.
  - `a follow-up on a no-chat lead notifies with a lead link`: `createFollowup(viewer, { leadId, dueAt })`, make it due, `runDueFollowupReminders()` → a `notifications` row with `reference_type 'whatsapp_lead'`; `notificationHref({ reference_type: 'whatsapp_lead', reference_id: id })` is `/whatsapp/leads?lead=<id>`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** the new test, `tests/db/whatsapp-pipeline.db.test.ts`, `tests/lib/notification-href.test.ts`; `tsc`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 6: Leads list, detail, manual add, new enquiry, export — library and APIs

**Files:**
- Create: `lib/leads/list.ts`, `app/api/whatsapp/leads/route.ts`, `app/api/whatsapp/leads/[id]/route.ts`, `app/api/whatsapp/leads/[id]/new-enquiry/route.ts`, `app/api/whatsapp/leads/export/route.ts`
- Test: `tests/db/connect-leads-list.db.test.ts`

**Interfaces:**
- Consumes: Task 2 core, Task 5 `leadVisibilityClause`, `listFollowups`.
- Produces (`lib/leads/list.ts`):
  - `export const LEADS_PAGE_SIZE = 50; export const LEADS_EXPORT_CAP = 5000;`
  - `export interface LeadFilters { leadType?: 'new' | 'existing'; stageId?: string; source?: string; ownerId?: string; openedFrom?: string; openedTo?: string; search?: string; status?: 'open' | 'closed' | 'all'; offset?: number }` (dates `YYYY-MM-DD`, inclusive; `source 'direct'` = NULL; default `status 'all'`; bad values ignored, as `loadBoard` does)
  - `export interface LeadRow { id: string; name: string; phone: string; conversation_id: string | null; message_count: number | null; lead_type: 'new' | 'existing'; source: string | null; stage_id: string | null; stage_name: string | null; stage_kind: 'open' | 'won' | 'lost' | null; temperature: string | null; lead_score: number | null; owner_id: string | null; owner_name: string | null; customer_id: string | null; opened_at: string; last_activity_at: string; closed_at: string | null }`
  - `export async function listLeads(viewer: InboxViewer, filters: LeadFilters): Promise<{ rows: LeadRow[]; total: number }>` — newest `opened_at` first; `message_count` counted only for the page's rows.
  - `export interface LeadDetail extends LeadRow { deal_value: number | null; expected_close_on: string | null; lost_reason: string | null; note: string | null; source_detail: Record<string, unknown> | null; summary: string | null; followups: FollowupRow[]; other_leads: Array<{ id: string; opened_at: string; closed_at: string | null; stage_name: string | null }> }`
  - `export async function loadLeadDetail(viewer: InboxViewer, leadId: string): Promise<LeadDetail | null>` — `null` when not visible.
  - `export async function createManualLead(viewer: InboxViewer, input: { name: unknown; phone: unknown; source: unknown; note?: unknown; stageId?: unknown; ownerId?: unknown }): Promise<{ lead: Lead; existing: boolean }>` — `source` must be `'call' | 'walk_in' | 'manual'` (`LeadError 400 BAD_SOURCE`); name required, max 120 (`BAD_NAME`); `existing: true` returns the open lead untouched.
  - `export async function startNewEnquiry(viewer: InboxViewer, leadId: string, confirmCloseOpen: boolean): Promise<Lead>` — the number's open lead exists and `!confirmCloseOpen` → `LeadError 409 LEAD_OPEN`; confirmed → that lead goes to the first lost stage with reason `'New enquiry'`; then `openLead` copying phone, name, chat and customer, source NULL, `createdBy` the viewer.
  - `export function leadsCsv(rows: LeadRow[]): string` — header `Name,Phone,Type,Source,Stage,Owner,Opened,Last activity,Messages`; RFC 4180 quoting; a cell starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'`.
  - `export async function exportLeads(viewer: InboxViewer, filters: LeadFilters): Promise<string>` — up to `LEADS_EXPORT_CAP` rows.
- Produces (routes, all `withWhatsAppPremiumApi`): `GET /api/whatsapp/leads` (`inboxPermission: 'read'`; query `type, stage_id, source, owner, from, to, search, status, offset`) → `{ rows, total, is_supervisor }`; `POST /api/whatsapp/leads` (`'update'`; body `{ name, phone, source, note, stage_id, owner_id }`) → 201 `{ lead }` or 200 `{ lead, existing: true }`; `GET /api/whatsapp/leads/[id]` (`'read'`) → `{ lead: LeadDetail }` or 404; `PATCH /api/whatsapp/leads/[id]` (`'update'`; body `stage_id, deal_value, expected_close_on, lost_reason, owner_id, contact_name, note`) → `{ lead }`, visibility checked first; `POST /api/whatsapp/leads/[id]/new-enquiry` (`'update'`; `{ confirm_close_open }`) → 201 `{ lead }`; `GET /api/whatsapp/leads/export` (`'export'`) → `text/csv` attachment `leads-<timestamp>.csv`. `LeadError`/`PipelineError` → their status and `{ error, code }`.

- [ ] **Step 1: Write failing tests:**
  - `filters: type, stage, source (direct), owner, opened range, search`: seed five leads with distinct values; one assertion per filter on the returned ids; `total` matches.
  - `message_count is null without a chat and counts messages with one`.
  - `agents cannot list, open or export leads they cannot see` (Review Focus 3): agent viewer; `listLeads` omits the hidden lead, `loadLeadDetail` returns `null`, `exportLeads` does not contain its phone.
  - `manual add refuses a bad phone, returns the open lead for a known one`: `'12345'` → `BAD_PHONE`; a phone with an open lead → `existing: true`, same id.
  - `new enquiry refuses while one is open, closes it when confirmed`: `LEAD_OPEN`, then confirmed → old lead lost with reason `'New enquiry'`, new lead open on the same chat, `other_leads` of the new one lists the old one.
  - `CSV escapes hostile names` (Review Focus 5): `leadsCsv` of names `'=HYPERLINK("x")'` and `'Sharma, "Raju"'` → contains `"'=HYPERLINK(""x"")"` and `"Sharma, ""Raju"""`.
  - `another business's lead is invisible`: `loadLeadDetail(viewerOfOther, id)` is `null`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `lib/leads/list.ts` and the routes.
- [ ] **Step 4: Run** the test; `tsc`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 7: Convert to customer and auto-won

**Files:**
- Create: `lib/leads/convert.ts`, `app/api/whatsapp/leads/[id]/convert/route.ts`
- Modify: `database/migrations/447_connect_leads.sql` (append the trigger), re-apply to `kh_phase2_test`
- Test: `tests/db/connect-leads-convert.db.test.ts`

**Interfaces:**
- Consumes: Task 2 `loadLead`; Task 5 `leadVisibilityClause`.
- Produces (`lib/leads/convert.ts`):
  - `export async function findCustomerForLead(businessId: string, leadId: string): Promise<{ id: string; name: string } | null>` — last 10 digits of `contact_phone` against `customers.phone`, newest first.
  - `export async function linkLeadToCustomer(viewer: InboxViewer, leadId: string, customerId: string): Promise<Lead>` — lead not visible → `LeadError 404 NOT_FOUND`; customer of another business → `LeadError 404 CUSTOMER_NOT_FOUND`; sets `leads.customer_id`; sets the chat's `customer_id` when it is NULL; `lead_type` unchanged.
- Produces (route): `GET /api/whatsapp/leads/[id]/convert` (`'read'`) → `{ match: { id, name } | null }`; `POST` (`'update'`; `{ customer_id }`) → `{ lead }`.
- Produces (SQL): `CREATE OR REPLACE FUNCTION leads_auto_won() RETURNS trigger` and triggers `invoices_leads_auto_won AFTER INSERT OR UPDATE OF status, customer_id ON invoices` and `sales_orders_leads_auto_won AFTER INSERT OR UPDATE OF status, customer_id ON sales_orders`, `FOR EACH ROW`. Qualifying document: invoices with `status = 'final'`, `deleted_at IS NULL`, `COALESCE(document_type,'tax_invoice') NOT IN ('proforma_invoice','estimate','quotation','delivery_challan')`; sales orders with `status NOT IN ('draft','cancelled')`; `customer_id` not NULL. Effect: the business's open leads for that `customer_id` with `opened_at::date <= <document date>` move to the first won stage by position (`stage_changed_at`, `closed_at`, `last_activity_at` = NOW()); one `stage_changed` event each with `{ from_stage, to_stage, source: 'auto', reference: <invoice_number or order_number>, lead_id }`, the lead's chat id and `lead_id`; linked chat `lead_status = 'converted'`. No won stage → nothing. The body sits in `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING 'leads_auto_won: %', SQLERRM; END;` and the function returns NULL.

- [ ] **Step 1: Write failing tests:**
  - `finds a customer by phone and links lead and chat`: customer `'098765 00010'`, lead `'919876500010'` with a chat → `findCustomerForLead` returns it; `linkLeadToCustomer` sets `customer_id` on both; `lead_type` still `'new'`.
  - `refuses another business's customer`: `CUSTOMER_NOT_FOUND`.
  - `a final invoice after the lead opened wins it`: insert a minimal `invoices` row (`status 'final'`, `document_type 'tax_invoice'`, `invoice_number 'INV-0123'`, `invoice_date` today, the customer) → lead in "Won", `closed_at` set, a timeline row whose description from the timeline route is `'Won: INV-0123'`.
  - `an invoice dated before the lead opened, a draft or a quotation does nothing`.
  - `a confirmed sales order wins it; a draft does not`.
  - `an invoice still saves when the business has no won stage` (Review Focus 4): delete the won stage, insert a final invoice → the insert succeeds; lead unchanged.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `convert.ts`, the route, and the trigger; re-apply 447 to `kh_phase2_test`; re-run Task 1's migration test (it must still pass, the trigger is re-runnable).
- [ ] **Step 4: Run** the convert and migration tests, plus `tests/db/order-fulfilment.db.test.ts` and `tests/db/whatsapp-paid-order.db.test.ts` (invoice paths with the trigger present); `tsc`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 8: Screens — Leads page, add, drawer, convert, chat panel, board

**Files:**
- Create: `app/(app)/whatsapp/leads/page.tsx` (same Connect gate as `app/(app)/whatsapp/lead-sources/page.tsx`), `components/whatsapp/leads/LeadsPage.tsx`, `components/whatsapp/leads/AddLeadDialog.tsx`, `components/whatsapp/leads/LeadDrawer.tsx`, `components/whatsapp/leads/ConvertLeadDialog.tsx`, `components/whatsapp/leads/ChatLeadsSection.tsx`, `components/whatsapp/leads/leadLabels.ts` (source/type labels and badge classes shared by the page, drawer and board)
- Modify: `lib/navigation/connect-nav-items.ts` (`{ href: '/whatsapp/leads', label: 'Leads', module: 'whatsapp_inbox' }` before Pipeline), `components/whatsapp/pipeline/PipelineBoard.tsx`, `components/whatsapp/conversations/ContactPanel.tsx`

**Interfaces:**
- Consumes: Task 6 and 7 routes; `BoardCard` from Task 5; `NewConversationModal` (`initialPhoneNumber`, `onSuccess(phone, conversationId)`) for a no-chat lead's message action; `DealSection` stays as is for the chat's open lead.
- Behaviour:
  - **LeadsPage:** filters bar (type, stage, source, owner, opened from/to, search, status) kept in the URL query; table columns Name, Number, Messages, Type badge (`New` emerald, `Existing` orange, as in `ContactPanel`), Source, Stage, Temperature/score, Owner, Opened, Last activity; 50 per page with Load more; Export downloads the current filters (row checkboxes come with sub-project 3, where selecting rows means a broadcast audience); "Add lead" button; `?lead=<id>` opens the drawer (notification links land here). Phone width: the table scrolls inside its card, no page scroll.
  - **AddLeadDialog:** name, phone, source select (Call, Walk-in, Other → `call`, `walk_in`, `manual`), note, stage, owner (agents list from `/api/whatsapp/users`); on `existing: true` shows "This number already has an open lead" and opens it.
  - **LeadDrawer:** contact, type, source with detail, stage select and deal fields (PATCH lead), owner, note, summary, follow-ups (add one via `/api/whatsapp/followups` with `lead_id`), other leads from this number, "Open chat" when linked or "Message" (opens `NewConversationModal` prefilled), "Convert to customer", "New enquiry" (confirm dialog when this lead is open).
  - **ConvertLeadDialog:** GET match; with a match shows "Link to <name>"; without one shows name/phone (prefilled), GSTIN, address, posts `/api/customers`, then `POST convert { customer_id }`; errors from either call shown inline.
  - **ChatLeadsSection** (in `ContactPanel` under the existing deal section): this number's leads newest first from `GET /api/whatsapp/leads?search=<phone>&status=all`, each opening the drawer; "New enquiry" and "Convert to customer" for the open lead.
  - **PipelineBoard:** cards keyed by lead id; moving calls `PATCH /api/whatsapp/leads/<id> { stage_id }` (and `lost_reason` from the existing lost prompt); a card with `conversation_id` links to `/whatsapp/conversations?c=<conversation_id>`, without one it shows "No chat yet" and its name opens the drawer; a 409 shows the server's message in the existing toast.

- [ ] **Step 1: Build** the components and page per Behaviour. Use the existing `api()` helper pattern from `LeadSourcesPage.tsx`, `Card`, `Button`, `Toast`, `ListPageHeader`.
- [ ] **Step 2: Typecheck** `npx tsc --noEmit -p tsconfig.json`. Expected: 0 errors.
- [ ] **Step 3: Browser check** on the `khatario-hub-testdb-3015` launch config (test DB), signed in as the local test account: Leads page lists the backfilled leads; each filter narrows the list; export downloads a CSV; Add lead (Call) appears with "No chat yet" on the board and in the list; drawer stage change moves the board card; Message on a no-chat lead opens the new-conversation modal with the number; chat panel shows the Leads section; Convert links an existing customer and creates a new one; New enquiry asks to confirm and then shows two leads for the number; a won lead moved back while another is open shows the 409 message; at 375 px the page has no horizontal page scroll. Screenshot the Leads page and the board.
- [ ] **Step 4: Commit** the component, page and nav files.

### Task 9: Whole-suite check, docs and log

**Files:**
- Modify: `docs/plan/CONNECT_LEADS.md` (Status line: built, test-DB only, migration 447 pending staging), `docs/roadmap.md` (card text), `docs/project.log.md` (entry), `docs/SERVER_INFRASTRUCTURE.md` (note: migration 447 adds triggers on `invoices` and `sales_orders`)

- [ ] **Step 1: Run** every Connect DB suite: `INBOX_DB_TEST=1 npx jest tests/db/connect-leads-*.db.test.ts tests/db/whatsapp-pipeline.db.test.ts tests/db/whatsapp-lead-sources.db.test.ts tests/db/whatsapp-direct-leads.db.test.ts tests/db/order-fulfilment.db.test.ts tests/db/whatsapp-paid-order.db.test.ts --runInBand`; `npx jest tests/lib/notification-href.test.ts`; `npx tsc --noEmit -p tsconfig.json`. Expected: all PASS, 0 errors. Record the counts.
- [ ] **Step 2: Update the docs** listed above with what was built, the counts, and what is open (staging migration with owner approval; a later migration drops the old chat columns; sub-projects 2 and 3).
- [ ] **Step 3: Commit** the docs.
