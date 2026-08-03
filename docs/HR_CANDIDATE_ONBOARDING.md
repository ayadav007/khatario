# Candidate onboarding (HR recruitment)

Pre-offer information collection for recruitment candidates via a self-service portal, with HR review before offer release.

---

## Flow

1. **HR** opens Recruitment → candidate → **Invite to portal** (assigns default task pack + sends email).
2. **Candidate** signs in at `/{portal_slug}/candidates`, completes tasks, and submits each one.
3. **HR** reviews each submitted task (field-level detail + attachments) and **Approves** or **Requests changes**.
4. When all required pre-offer tasks are approved, HR can **create/send offer**.
5. After offer acceptance, **Convert to employee** pre-fills PAN/Aadhaar/bank fields and copies uploaded documents.

### Default task pack

| Task | Type |
|------|------|
| ID Proof | 3 of 5 identity docs (Aadhaar, PAN, Voter ID, DL, Passport) |
| Last 3 months salary slips | 3 repeating file slots |
| Bank account proof | Attachments checklist |
| Earlier employers (documents) | Upload-only — relieving/service letters from jobs before current/last employer |
| Current / last employer | Form (company, title, dates, etc.) + offer/appraisal documents |

Templates are configurable under **Settings → HR & payroll → Onboarding templates**.

---

## Key routes

| Audience | Route |
|----------|-------|
| Candidate dashboard | `/{slug}/candidates` |
| Candidate task | `/{slug}/candidates/tasks/[taskId]` |
| HR candidate workflow | `/employees/recruitment/candidates/[id]` |
| HR task review | `/employees/recruitment/candidates/[id]/tasks/[taskId]` |
| Template settings | `/settings/onboarding-templates` |

---

## Database

Migration: **`263_candidate_onboarding_tasks.sql`**, **`264_candidate_portal_invite_email.sql`**

Tables:

- `candidate_onboarding_task_templates` — per-business template definitions
- `candidate_onboarding_tasks` — assigned tasks per candidate
- `candidate_identity_documents` — identity doc fields + files
- `candidate_task_entries` — structured entries (salary slots, employment)
- `candidate_task_files` — uploaded files per task

Candidate statuses added: `portal_invited`, `info_collection`, `info_collection_complete`.

---

## Staging deploy

Staging is the current live environment: `https://staging.khatario.com`.

### 1. Apply migration on VPS

SSH to the VPS, then:

```bash
cd /var/www/khatario
git pull   # or deploy via CI first
node scripts/run_single_migration.js 263_candidate_onboarding_tasks.sql
# or rely on deploy script:
bash scripts/deploy-vps.sh --no-pull   # runs npm run db:migrate:pending
```

Verify tables exist:

```bash
psql "$DATABASE_URL" -c "\dt candidate_onboarding*"
```

### 2. Deploy app

```bash
bash scripts/deploy-vps.sh
```

This runs `npm ci` → `db:migrate:pending` → `build` → `pm2 restart khatario-staging`.

Ensure `.env.production` on VPS has:

```
NEXT_PUBLIC_APP_URL=https://staging.khatario.com
```

Email links (HR review, candidate portal) use this URL.

### 3. Smoke test on staging

1. Settings → Onboarding templates — confirm 5 default tasks load.
2. Recruitment → candidate → Invite to portal.
3. Candidate portal — complete ID Proof (try Voter ID / DL / Passport tabs).
4. Submit task → HR receives email → open **Review** link.
5. Approve all 5 tasks → create/send offer (should succeed).
6. Accept offer → convert to employee — verify PAN/Aadhaar/bank prefill.

---

## Email notifications

| Event | Recipient |
|-------|-----------|
| Portal invite (task assignment) | Candidate — rich HTML with task table, due dates, OTP steps, CTA button |
| Task submitted | HR users with recruitment access |
| Changes requested | Candidate |
| All required tasks approved | Candidate |

Invite email template: **Settings → Onboarding templates → Invite email** tab.

Per-invite task selection: **Recruitment → candidate → Invite to portal** modal (checkboxes per task).

Implemented in:
- `lib/hr/recruitment/onboarding/invite-email.ts`
- `lib/hr/recruitment/onboarding/invite-email-settings.ts`
- `lib/hr/recruitment/onboarding/notifications.ts`

---

## Code map

```
lib/hr/recruitment/onboarding/
  templates.ts          — default pack
  template-service.ts   — settings CRUD
  task-service.ts       — assign, submit, review, prefill
  identity-fields.ts    — form specs for all ID types
  notifications.ts      — email hooks

components/onboarding/OnboardingTaskDetailView.tsx  — shared task UI
components/candidate-portal/                        — candidate pages
app/api/hr/recruitment/candidates/[id]/tasks/       — HR review API
app/api/hr/onboarding-templates/                    — template settings API
```
