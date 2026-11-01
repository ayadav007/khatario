# Connect leads: a leads table, a lead score you can trust, and broadcast by segment

Status: design agreed 2026-10-29; sub-project 1 (leads table) built and committed on `main` (plan: [CONNECT_LEADS_1_PLAN.md](CONNECT_LEADS_1_PLAN.md)). Migration 447 is applied to `kh_phase2_test` only; staging is pending owner approval. Sub-projects 2 and 3 not started.

## As built (sub-project 1)

- **Modules** (`lib/leads/`): `core.ts` is the main writer of leads (open, move, close, reopen, patch, link chat). A few narrow writes live elsewhere: `convert.ts` (link a customer), `list.ts` `startNewEnquiry` (carry the customer onto the new lead), `lib/whatsapp/pipeline.ts` `deleteStage` and `updateStage` (move, close or take leads off the board when a stage goes or changes kind), `lib/whatsapp/lead-sources.ts` `applyAdReferral` (ad source on an open lead) and the `leads_auto_won` trigger (below). `inbound.ts` (repeat rule on live messages, outbound touch), `chat-deal.ts` (the chat's deal panel on its lead), `list.ts` (list, detail, CSV), `convert.ts`, `visibility.ts`, `timeline.ts`, `phone.ts`. Imports and tracked links in `lib/whatsapp/lead-sources.ts` now open leads; `lib/whatsapp/pipeline.ts` reads leads.
- **APIs** (`app/api/whatsapp/leads`): list and manual add, `[id]` detail and PATCH, `[id]/convert`, `[id]/new-enquiry`, `export` (CSV).
- **Screens**: the Leads page (`/whatsapp/leads`, `components/whatsapp/leads/*`) with filters kept in the URL, a drawer per lead, manual add and export; a Leads section in the chat panel; the board and the phone pipeline move cards through the lead PATCH.
- **Trigger**: migration 447 also adds `leads_auto_won` on `invoices` and `sales_orders` (AFTER INSERT/UPDATE). It swallows its own errors and uses `FOR UPDATE SKIP LOCKED`, so a document never fails and never waits on a lead another write holds.

Where the build changed behaviour from the spec above:

- **Deal panel (R9, R11):** the chat's deal panel edits the chat's open lead, else its newest lead; only an agent reopens a closed lead. Flows, the AI agent and automatic moves open a new lead instead, so they never rewrite a past win or loss. A second chat for the same number does not show or edit an open lead that lives on another chat (a stage pick there answers 409); a lead with no chat yet is shared.
- **Stage delete and kind change (R13):** a closed lead never sits in an open column; deleting a stage moves closed leads only into won/lost, otherwise their stage becomes empty (history stays in the list). Changing a stage to won or lost closes its open leads; changing it to open empties the stage of its closed leads (they never reopen). The backfill closes a duplicate open chat on a phone off the board too.
- **Broadcasts and history sync (R15, R16):** only staff and bot replies keep a lead from going quiet (campaign sends do not); a message older than 24 hours only links the chat and never opens or closes a lead, so a QR reconnect does not create leads.
- **Imports (R18, R24):** an import joining an open lead sets the source only if the lead is Direct, always adds the source's labels and appends the enquiry to the note. A failed IndiaMART lead holds the pull window until retried; it is given up after two failures and named in `last_error`.
- **Owner assignment (R19, R25):** a linked chat takes the lead's owner only from a live inbound message or an import, not from history sync or a staff deal edit.
- **Manual leads (R27, R29):** a manual lead links the number's newest non-group chat, but only one the viewer can see.
- **Link codes:** a code from a number that already has an open lead just joins it (no link source, no link credit).
- **Known numbers:** the inbound path caches a "known" answer (customer, supplier, staff, owner) for 10 minutes per business and last 10 digits, in process; "unknown" is never cached.
- **Auto-won:** a final sales invoice (not a quotation, estimate, proforma, challan, credit or debit note) or confirmed sales order for the linked customer wins their open leads. Cancelling the invoice later does not reopen the lead, and linking a customer does not look back for an earlier invoice (owner may want either).

## Why

Tenant businesses get enquiries on WhatsApp (ads, links, QR, direct), from IndiaMART and lead webhooks, and by phone or walk-in. AiSensy-style tools show these as a list of leads that can be filtered, exported and broadcast to. Khatario today treats a WhatsApp chat as the lead: stage, deal value, owner, follow-ups and source live on `whatsapp_conversations`. That breaks when:

- the same number enquires again months later (one chat, several enquiries);
- a lead has no WhatsApp chat (call, walk-in, IndiaMART buyer who has not messaged);
- a lead becomes a customer and should be linked and marked won.

What exists and stays (built 2026-10-29, commit 66517b26): every new number's first message goes on the pipeline as a Direct lead (customers, suppliers, staff and the owner excluded; switch on Lead sources), and each chat keeps an AI summary rewritten 10 minutes after it goes quiet, naming bot and staff replies (`lib/whatsapp/lead-summary.ts`, migration 446).

## Owner decisions (2026-10-29)

| Question | Decision |
| --- | --- |
| What must a leads table allow | All four: an AiSensy-style list view with export, repeat enquiries as separate leads, leads with no WhatsApp chat, convert a lead to a customer |
| What the pipeline board moves | Leads. Stage, value, close date, lost reason, owner, follow-ups and source move from the chat to the lead; existing board data is copied over |
| When a known number starts a new lead | Its latest lead is won or lost, or still open but untouched for 30 days (that one closes as lost, "went quiet"). Otherwise the message joins the open lead. Staff can start one by hand ("New enquiry") |
| Existing customers | Unchanged from 2026-10-29: a customer's message does not put them on the board automatically. Ads, links, manual entry and staff can, and such leads are marked `existing` |
| Lead score | Rule points from known facts plus the AI's buying-intent read as one input, with the reasons shown |
| Broadcast to a segment | Approved Meta templates only (Cloud API numbers). QR-linked businesses keep the existing Campaigns screen |
| Invoice after a lead | The first invoice or sales order for the linked customer, dated after the lead opened, moves the open lead to Won |

## Sub-projects, in order

1. **Leads table** (this spec): the table, migration and backfill, the pipeline on leads, repeat enquiries, leads with no chat, convert to customer, the Leads list page.
2. **Lead score rework** (spec after 1 ships): rules plus AI signal with reasons, stored on the lead.
3. **Segment broadcast** (spec after 2): filter leads, send an approved template to the segment.

Each gets its own implementation plan and build. 2 and 3 are outlined at the end so 1 leaves room for them.

---

## Sub-project 1: leads table

### Data model (migration 447)

`leads`, one row per enquiry:

| Column | Notes |
| --- | --- |
| `id`, `business_id` | `business_id` always from the session |
| `contact_phone` | Digits with country code, normalised like `normalizeLeadPhone` |
| `contact_name` | From the chat's WhatsApp name, the import, or the form |
| `conversation_id` | Nullable. Set when a chat exists or appears later |
| `customer_id` | Nullable. Set when they are a customer or get converted |
| `lead_type` | `new` or `existing`, fixed when the lead opens (customer by phone at that moment) |
| `stage_id`, `deal_value`, `expected_close_on`, `lost_reason`, `stage_changed_at` | Moved from `whatsapp_conversations` (migration 418) |
| `owner_id` | The salesperson. Starts as the source's routing agent, else the chat's assigned agent, else empty. Separate from who holds the chat in the inbox |
| `source`, `source_detail`, `source_at` | Moved from the chat (migration 419). `source` adds `manual`, `call`, `walk_in` to `ctwa_ad`, `link`, `indiamart`, `lead_api`; NULL is Direct |
| `note` | Free text from the manual form or import |
| `opened_at`, `closed_at`, `last_activity_at` | `closed_at` set when the stage is won or lost; `last_activity_at` on every message in or out and every staff change |
| `created_by` | Session user for manual leads, NULL for automatic ones |

Constraints and indexes:
- One open lead per business and phone: unique index on `(business_id, contact_phone) WHERE closed_at IS NULL`. Two inserts at once cannot both win; the loser re-reads and joins the open lead.
- Board order `(business_id, stage_id, stage_changed_at DESC)`, list order `(business_id, opened_at DESC)`, `(business_id, conversation_id)`, `(business_id, customer_id)`.
- `deal_value >= 0`; `source` check list as above.

Re-pointed to the lead (new nullable `lead_id`, filled by the backfill):
- `whatsapp_followups` (a reminder belongs to a lead; `conversation_id` stays for the chat link).
- `whatsapp_lead_imports` (IndiaMART and webhook imports record the lead they made).
- `whatsapp_lead_profiles` (summary and score per lead; sub-project 2 decides what stays per chat).
- `whatsapp_automation_events` stage changes carry `lead_id` in their payload.

Backfill, in the same migration:
- Every chat with a `stage_id` becomes one lead carrying its stage, value, close date, lost reason, source, `customer_id`, and `owner_id` = the chat's `assigned_to`. `opened_at` = `source_at`, else the chat's `created_at`. Won or lost stages set `closed_at` = `stage_changed_at`.
- Pending follow-ups and lead imports get the new `lead_id`.
- The old columns on `whatsapp_conversations` stay one release, no longer written, so rolling back the code still works. A later migration drops them.

### When a lead opens or a message joins one

All in `lib/leads/` (new); the WhatsApp paths call it instead of writing stage columns.

1. **Message from a number** (`storeIncomingMessage`): find the business's open lead for the phone.
   - Open and active in the last 30 days: link the chat if it is not linked, touch `last_activity_at`.
   - Open but quiet for 30 days or more: close it as lost ("Went quiet") and open a new one.
   - No open lead: open one only if the existing rules say so: a tracked link or ad on this message, or a new number with the "New numbers" switch on. Customers, suppliers, staff and the owner do not get one automatically.
2. **Ads, links** (`applyAdReferral`, `attributeNewChat`): open or reuse the open lead and set its source once, as today on the chat.
3. **IndiaMART and lead webhook**: open a lead with no chat (no more empty chat rows). Imports stay idempotent through `whatsapp_lead_imports`.
4. **Manual** ("Add lead"): name, phone, source (call, walk-in, other), note, stage, owner. If the number has an open lead, the form says so and opens that lead instead.
5. **"New enquiry"** on a chat or lead: closes the open lead as lost only if staff confirm; otherwise refuses while one is open.
6. **Chat appears for a lead with no chat**: when the number messages, or staff send it a template, the chat links to the open lead by phone.

Stage changes from the board, the deal section, flows (`lib/whatsapp/flows/actions.ts`) and the AI agent's "when qualified" stage go through one `setLeadStage` that keeps today's `setDeal` checks (stage belongs to the business, lost reason rules, timeline event). The legacy `lead_status` on the chat keeps being written for older filters until the column drop.

### Convert to customer

A "Convert to customer" button on the lead (Leads page drawer, board card menu, chat panel).
- A customer already has this phone (last 10 digits): offer "Link to <customer>". One tap links.
- Otherwise a prefilled new-customer form (name, phone; GSTIN and address optional) using the existing customer create path, then links.
- Linking sets `customer_id` on the lead and on its chat. `lead_type` does not change.
- Auto-won: when an invoice or sales order is created for that customer, dated on or after the lead's `opened_at`, the customer's open lead moves to the business's first won stage, with a timeline event "Won: INV-0123". Hooked where invoices and sales orders are created, after commit, never failing the invoice.

### Screens

- **Connect → Leads** (new page, Connect nav): table of name, number, messages (chat message count, blank with no chat), New/Existing, source, stage, temperature and score (empty until sub-project 2), owner, opened, last activity. Filters: lead type, stage, source, owner, opened date range, search. Row select and CSV export of the filtered rows (capped, like the conversations export). "Add lead" form. A row opens a drawer with the lead's fields, summary, follow-ups, other leads from the same number, the chat link, and Convert.
- **Pipeline board**: cards are leads, same look and filters. A card without a chat shows "No chat yet"; its message action opens the template sender (Cloud API) or a new chat (QR).
- **Chat side panel**: a Leads section listing this number's leads, newest first; the open one uses the existing deal section; "New enquiry" button.
- **Lead sources page**: unchanged apart from counts now coming from leads.
- **Pipeline dashboard** (`loadPipelineSummary`): counts and wins by source read leads.

Visibility follows chats: an agent sees a lead if they could see its chat today (`canViewConversation`), plus unlinked leads they own or that are unassigned. Owners and managers see all. Creating, converting and exporting need the manage permission used by the pipeline today.

### APIs

- `GET/POST /api/whatsapp/leads` (list with filters and paging; create manual lead)
- `GET/PATCH /api/whatsapp/leads/[id]` (fields, stage, owner)
- `POST /api/whatsapp/leads/[id]/convert` (`{ customer_id }` to link, or new-customer fields)
- `POST /api/whatsapp/leads/[id]/new-enquiry`
- `GET /api/whatsapp/leads/export`
- `/api/whatsapp/pipeline` and `/api/whatsapp/conversations/[id]/deal` switch to leads; the deal route resolves the chat's open lead.

### Errors and edge cases

- Phone that cannot be normalised: manual form refuses it; imports skip it, as today.
- Two messages from a new number at once: the unique index makes one insert win; the other joins.
- A stage deleted while leads sit in it: `deleteStage` keeps its `moveToId` choice and moves the leads instead of the chats; with no target they leave the board (`stage_id` NULL), as chats do today.
- A chat merged or renumbered: the lead keeps its phone; the next message relinks by phone.
- Groups never get leads.

### Testing

DB tests on `kh_phase2_test` (`tests/db/connect-leads.db.test.ts`):
- backfill: the board before and after the migration shows the same cards, stages, values and follow-ups;
- repeat rule: closed lead → new lead; open and quiet 30 days → old one lost, new one opens; open and active → joins;
- concurrent first messages make one lead;
- manual and IndiaMART leads have no chat and link when the number messages;
- convert links an existing customer by phone, or creates one; auto-won from an invoice dated after the lead opened, not from an older one;
- a business never sees or links another business's leads;
- existing lead-sources, pipeline, direct-leads and follow-up suites still pass after the switch.

Then `tsc`, and a signed-in browser pass on the test DB: Leads page with filters and export, Add lead, board with a no-chat card, chat panel Leads section, Convert, New enquiry.

### Rollout

Migration 447 on staging with owner approval. Because the old chat columns stay one release, a code rollback keeps working. The column drop is a separate migration once staging has run on leads.

---

## Sub-project 2 outline: lead score

- Score 0–100 on the lead, made of rule points with a reason each (for example: replied, asked for price or stock, gave a quantity, estimate or order made, source weight, replied within a day, staff engaged, recency decay, said not interested) plus the AI's purchase-intent read as one weighted input.
- Temperature (hot, warm, cold) from score bands; staff can override, and the override sticks until they clear it.
- Recomputed when facts change and when the quiet-chat summary runs; the reasons list shows on the lead.
- Leads list and segment filters use it.

## Sub-project 3 outline: segment broadcast

- From the Leads page filters: "Broadcast to these N leads".
- Approved templates only, Cloud API numbers only. Template variables can use lead fields (name, product from the enquiry).
- Excludes unsubscribed numbers and numbers messaged by a campaign in the last 7 days, like Campaigns today.
- Sends paced through the Cloud API with per-recipient status, reusing the campaign tables for history.
