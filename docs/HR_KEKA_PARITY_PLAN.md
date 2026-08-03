# HR / Keka parity — master plan

**Status:** Planning (not started)  
**North star:** HR-only businesses should feel like an HRMS (Keka-class), not a trimmed billing app.  
**Scope:** Settings UX, product gaps, India payroll compliance MVP, reports, ESS polish.  
**Out of scope (this plan):** Full OKR/PMS, hardware biometric vendors, US payroll.

---

## Goals

| # | Goal | Success signal |
|---|------|----------------|
| G1 | HR-only UX is credible | HR signup sees only HR settings + HR nav; no billing/inventory leakage |
| G2 | Settings match Keka mental model | Org → Time → Leave → Payroll → Hiring → People → Integrations → Portal |
| G3 | SMB payroll works end-to-end | Run → payslip → employee download → optional email |
| G4 | Compliance MVP (India) | PF export + PT awareness + Form 16 v1; ESIC flagged honestly |
| G5 | Measurable gaps closed | HR reports exportable; ESS expenses work on HR-only plans |

---

## Current baseline (already done / exists)

- Module-scoped settings registry: `lib/settings-module-registry.ts`
- Business profile gating: `components/settings/BusinessProfileTab.tsx`
- Core HR: employees, attendance, leave, payroll runs, payslips, recruitment, onboarding, ESS portal, kiosk, face check-in
- HR plans: `hr_starter`, `hr_pro`, `hr_trial`, features `hr_*` in `lib/hr-plan-features.ts`

---

## Phase 0 — Foundation & hygiene (1–2 weeks)

**Purpose:** Fix inconsistencies before building new surfaces.

### 0.1 HR-only product leaks

| Task | Files | Acceptance |
|------|-------|------------|
| ESS expenses gate on HR feature, not billing | `lib/employee-portal/feature-gates.ts`, plan features DB migration | HR Pro user opens portal expenses without `purchase_expenses` |
| Route guard: block billing settings URLs when no `billing` module | middleware or page-level `hasPlatformModule` wrapper | HR-only direct URL to `/settings/templates` → friendly block/redirect |
| `hr_employee_portal` on starter vs pro messaging | `components/settings/EmployeePortalAccessCard.tsx`, subscription copy | Clear upgrade path on Starter |

### 0.2 Settings registry completion

| Task | Files | Acceptance |
|------|-------|------------|
| Add missing HR sidebar links already in hub but not sidebar before registry | `lib/settings-module-registry.ts` | Attendance policy, HR approvals, offer letter visible in HR block |
| Single test: registry ↔ no orphan settings routes | `tests/lib/settings-module-registry.test.ts` | All `app/(app)/settings/**` HR routes appear in registry or redirect list |

### 0.3 Documentation

| Task | Files |
|------|-------|
| Keka comparison snapshot (this doc) | `docs/HR_KEKA_PARITY_PLAN.md` |
| Settings catalog for HR module only | `docs/HR_SETTINGS_CATALOG.md` (generated from registry) |

**Exit criteria:** HR-only E2E smoke: signup → `/hr/dashboard` → settings shows **HR** block only → business profile has no product features.

---

## Phase 1 — Keka-like HR settings UX (2–3 weeks)

**Purpose:** Reorganize HR settings into Keka-shaped groups (not new payroll engine yet).

### 1.1 Registry restructure (HR module)

Replace flat `HR & payroll` column with:

```
HR settings
├── Organization      → business, branches, financial years
├── Time & attendance → shifts, holidays, attendance policy
├── Leave             → leave types, HR approvals
├── Hiring            → onboarding templates, offer letter, [future: pipeline defaults]
├── Payroll           → [NEW] payroll settings landing (placeholder → Phase 3)
├── Employee portal   → [NEW] /settings/employee-portal
├── People & access   → users, roles, branches (shared)
├── Integrations      → email, SMS
└── General           → backup, help
```

| Task | Files |
|------|-------|
| Extend registry with new groups + routes | `lib/settings-module-registry.ts` |
| Wire hub + sidebar (automatic via builders) | `SettingsHub.tsx`, `Sidebar.tsx` |
| HR settings catalog doc | `docs/HR_SETTINGS_CATALOG.md` |

### 1.2 New settings pages (shells first)

| Page | Route | MVP content |
|------|-------|-------------|
| **Employee portal** | `/settings/employee-portal` | Toggle modules (attendance, leaves, payslips), invite copy, kiosk enable, slug preview |
| **Payroll settings** | `/settings/payroll` | Pay schedule (monthly), pay day, link to financial year; “Statutory setup coming” banner until Phase 3 |
| **Departments & designations** | `/settings/departments` | CRUD lists used by employee form dropdowns |
| **Hiring defaults** | `/settings/hiring` | Default pipeline stage names, auto-invite onboarding toggle (optional) |

### 1.3 Business profile (HR copy)

| Task | Acceptance |
|------|------------|
| Dynamic section titles for HR | “Company profile” not “GSTIN and logo” on HR-only |
| Link to financial years from payroll settings | Cross-link helper text |

**Exit criteria:** HR admin can configure org, time, leave, hiring, portal without seeing billing settings. Settings search finds “payroll”, “portal”, “departments”.

---

## Phase 2 — Attendance & leave parity (3–4 weeks)

**Purpose:** Close operational gaps vs Keka before statutory payroll.

### 2.1 Attendance

| Feature | Implementation notes | Files (indicative) |
|---------|---------------------|-------------------|
| Default shift per employee | `employees.default_shift_id` migration | `database/migrations/`, employee form |
| Geolocation on ESS check-in | `navigator.geolocation` on portal check-in | `app/(public-business)/[slug]/employees/attendance/` |
| Geofence (optional) | Business setting: lat/lng/radius; reject check-in outside | `lib/hr/attendance-policy.ts`, settings |
| Regularization workflow | Request → manager approve → update attendance | new tables + APIs + portal UI |
| SMS OTP attendance | Finish `app/api/attendance/send-otp` + SMS integration | `lib/integrations/`, settings SMS |
| Overtime policy | Rules → hours on prefill | `lib/hr/salary-payroll-helpers.ts` |

### 2.2 Leave

| Feature | Notes |
|---------|-------|
| Comp-off | Leave type flag + credit on holiday work |
| Leave encashment | Config + payroll line item (simple formula) |
| Team calendar in portal | Already partial; polish + manager view |

### 2.3 HR reports (v1)

| Report | Route | Export |
|--------|-------|--------|
| Monthly attendance register | `/hr/reports/attendance` | CSV |
| Leave balance summary | `/hr/reports/leave-balances` | CSV |
| Payroll register | `/hr/reports/payroll-register` | CSV |
| Headcount | `/hr/reports/headcount` | CSV |

Nav: new **Reports** under HR sidebar (module `hr` only).

**Exit criteria:** Manager can approve regularization; payroll prefill uses default shift + OT rules; 4 reports export.

---

## Phase 3 — Payroll compliance MVP (India) (6–10 weeks)

**Purpose:** Minimum credible alternative to Keka for **single-entity Indian SMB** — not full CA replacement.

### 3.1 Data model

New tables / fields (migration series `260+`):

```
business_payroll_statutory_settings
  - pf_enabled, pf_establishment_id
  - esic_enabled, esic_code
  - pt_state, pt_registration_no
  - tds_deductor_tan, default_regime (old/new)

employee_statutory
  - uan, pf_account_no, esi_ip_number
  - pan (already on employee), tax_regime

payroll_run (optional header)
  - month, year, status, locked_at

statutory_export_log
  - type (ecr, pt, etc.), file_path, generated_at
```

### 3.2 Org-level payroll settings UI

**Route:** `/settings/payroll` (expand Phase 1 shell)

Sections:
1. **Pay schedule** — monthly, pay date, financial year link  
2. **PF** — enable, establishment ID, employee/employer rate defaults  
3. **ESIC** — enable, code, wage ceiling flag  
4. **Professional tax** — state selector, slab reference (read-only table) + registration #  
5. **TDS** — deductor TAN, default regime, link to declarations (Phase 3b)  
6. **Bank disbursement** — default payroll bank account  

### 3.3 Calculation engine (v1 — explicit limits)

| Component | v1 behavior | v2 (later) |
|-----------|-------------|------------|
| PF employee | 12% of (basic + DA) capped | EPS split, employer share |
| PF employer | Display only on payslip stub | ECR file |
| ESIC | 0.75% / 3.25% below ceiling if enabled — **shown on payslip** | Returns filing manual |
| PT | State slab lookup by gross | Challan |
| TDS | Annual projection from declarations OR flat % fallback | Full slab engine |
| LWF | State flag + fixed amount | — |

**Core lib:** `lib/hr/statutory/` — `pf.ts`, `esic.ts`, `pt-slabs.ts`, `tds-v1.ts`, `payroll-run.ts`

Refactor prefill: `app/api/employees/salary/payments/prefill/route.ts` → use statutory lib.

### 3.4 Form 16 (v1) — **approved: summary Part B early**

**Scope:**
- Part A: employer + employee PAN, TAN, assessment year  
- Part B: **summary** — consolidated salary, exemptions total, TDS deducted per month (not line-by-line 80C proof)  
- PDF per employee for FY  
- Ship in **Phase 3a** (does not block on IT declarations)  
- Phase 3b refines TDS when declarations exist  

**Routes:**
- `GET /api/hr/compliance/form-16?fy=2025-26&employee_id=`  
- Admin UI: `/hr/compliance/form-16`  

### 3.5 Exports

| Export | Format | When |
|--------|--------|------|
| ECR-ready CSV | EPFO column layout (research current spec) | After payroll lock |
| Payroll bank file | NEFT bulk (bank-specific template v1: generic CSV) | After payroll lock |
| PT statement | Monthly summary by state | Monthly |

### 3.6 Payslip & employee delivery

| Task | Acceptance |
|------|------------|
| Payslip shows statutory breakdown lines | PF, ESIC, PT, TDS separate |
| Bulk email payslips on run finalize | Uses business SMTP |
| Portal download always available | Existing + new FY filter |

### 3.7 IT declarations (3b — can slip after 3a)

- Employee portal: `/employees/profile/tax-declarations`  
- Sections: 80C, 80D, HRA rent, regime choice  
- Payroll uses declared amounts for TDS projection  

**Exit criteria (Phase 3a):**  
- Configure statutory at org level  
- Run March payroll with PF+PT+TDS lines  
- Export ECR CSV + bank CSV  
- Generate Form 16 PDF for 1 test employee  
- Document known limitations in UI  

**Exit criteria (Phase 3b):** IT declarations affect TDS month-over-month.

---

## Phase 4 — ESS & mobile polish (3–4 weeks, parallelizable after Phase 1)

| Task | Notes |
|------|-------|
| Native ESS shortcuts in Capacitor | Deep link `/{slug}/employees` for HR-only builds |
| Push notifications (optional) | Leave approved, payslip ready — needs FCM |
| Portal branding | Logo, primary color in `portal-theme` settings |
| Manager mobile flows | Approve leave/regularization from portal |
| Keka-style onboarding checklist | Admin “HR setup wizard”: FY → shifts → leave → first employee |

---

## Phase 5 — Performance & enterprise (backlog)

Not required for Keka SMB parity; track separately:

- OKRs / appraisal cycles  
- 360 feedback  
- Biometric device integrations (ZKTeco, eSSL)  
- Multi-entity payroll  
- FnF / full & final settlement  
- HR analytics warehouse  

---

## Testing strategy

| Layer | What |
|-------|------|
| Unit | `lib/hr/statutory/*`, prefill, PT slabs |
| Integration | Payroll run lock → exports |
| E2E | `e2e/hr-only-smoke.spec.ts` — signup HR → settings → employee → attendance → leave → payroll |
| E2E | `e2e/hr-compliance-mvp.spec.ts` — statutory settings → run → Form 16 download |
| Fixture | `tests/fixtures/payroll-statutory/` — golden CSV outputs |

---

## Migration & rollout

1. **Feature flags:** `hr_statutory_v1`, `hr_form16`, `hr_geofence` in env or plan features  
2. **Plan gating:** Compliance MVP on `hr_pro` by default seed; **`hr_employee_portal` toggled per plan in admin Feature matrix** (not code)  
3. **Staging:** HR-only test tenant on `staging.khatario.com` before VPS deploy  
4. **Customer comms:** “Compliance beta” banner with limitation list  

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Statutory rules wrong | CA review of PT slabs + PF; golden tests; “not legal advice” disclaimer |
| Scope creep on Form 16 | Ship Part A + summary Part B only in v1 |
| HR-only still sees billing routes | Phase 0 route guards + E2E |
| SMS OTP cost | Gate on plan / rate limit |
| ESIC complexity | Enable flag + calc only; returns manual until v2 |

---

## Effort summary (rough)

| Phase | Duration | Team |
|-------|----------|------|
| 0 Foundation | 1–2 wk | 1 dev |
| 1 Settings UX | 2–3 wk | 1 dev + design review |
| 2 Attendance/leave/reports | 3–4 wk | 1–2 dev |
| 3 Compliance MVP | 6–10 wk | 2 dev + CA consult |
| 4 ESS polish | 3–4 wk | 1 dev |
| **Total to compliance MVP** | **~4–5 months** | sequential Phases 0→3 |

Phases 1 and 4 can overlap partially. Phase 2 can start during late Phase 1.

---

## Implementation order (recommended sprints)

### Sprint 1–2 (Phase 0 + 1 start)
- [x] ESS expense gate fix (HR `hr_employees` + billing `purchase_expenses` OR)  
- [x] Settings route guards for non-enabled modules (`SettingsModuleGuard`)  
- [x] Biometrics deferred 12 months (product decision)  
- [x] Audit: portal tier uses `hasFeatureAccess('hr_employee_portal')` only (no app `hr_pro` gates; marketing pricing copy exempt)  
- [x] Registry: Time / Leave / Hiring / Payroll / Portal groups  
- [x] `/settings/employee-portal` shell  
- [x] `/settings/departments` CRUD  

### Sprint 3–4 (Phase 1 finish + 2 start)
- [x] `/settings/payroll` shell + pay schedule  
- [x] `/settings/hiring` defaults  
- [x] Default shift per employee (`employees.default_shift_id`)  
- [x] Geolocation on ESS check-in  
- [x] Geofence on attendance policy + check-in validation  
- [x] HR reports (CSV v1) — `/hr/reports`  

### Sprint 5–7 (Phase 2)
- [ ] Geolocation + geofence  
- [ ] Regularization workflow  
- [ ] SMS OTP  
- [ ] Comp-off basics  

### Sprint 8–12 (Phase 3a)
- [ ] Statutory settings schema + UI  
- [ ] PF / ESIC / PT calc in prefill  
- [ ] ECR + bank export  
- [ ] Form 16 v1 PDF  

### Sprint 13–14 (Phase 3b + 4)
- [ ] IT declarations  
- [ ] Payslip email bulk  
- [ ] Portal branding  
- [ ] HR setup wizard  

---

## Keka module mapping (reference)

| Keka module | Khatario phase | Primary routes |
|-------------|----------------|----------------|
| Core HR | Exists | `/employees`, `/hr/dashboard` |
| Attendance | Phase 2 | `/employees/attendance`, `/settings/attendance-policy` |
| Leave | Phase 2 | `/employees/leaves`, `/settings/leave-types` |
| Payroll | Phase 3 | `/employees/salary/*`, `/settings/payroll` |
| ESS | Phase 1 + 4 | `/{slug}/employees`, `/settings/employee-portal` |
| Recruitment | Exists | `/employees/recruitment` |
| Performance | Phase 5 backlog | `/employees/performance` (today: sales KPIs) |
| Reports | Phase 2 | `/hr/reports/*` |
| Settings UX | Phase 1 | `lib/settings-module-registry.ts` |

---

## Product decisions (locked 2026-06-26)

| Topic | Decision | Implementation note |
|-------|----------|-------------------|
| **Form 16 v1** | Ship **early** with **summary Part B** (not full granular 80C proof workflow) | Phase 3a; IT declarations can refine TDS in 3b |
| **ESIC v1** | **Show on payslip** when enabled (employee + employer lines) | Org toggle in payroll statutory settings; returns filing manual until v2 |
| **Employee portal on which plan** | **Platform admin configurable** per plan — not hardcoded Starter vs Pro | Use existing `/admin/plans` **Feature matrix** (`hr_employee_portal`); defaults in DB seed only |
| **Biometric hardware** | **Defer 12 months** (confirmed 2026-06-26) | No ZKTeco/eSSL integration in 2026 roadmap; use face/kiosk/mobile |
| **Mobile app** | **Decide later** | No Capacitor HR deep-link work until chosen; web ESS is canonical for now |

### Biometrics — what this means (plain language)

**Biometric attendance (Keka-style)** = physical machines at the office door: fingerprint or face scanners made by vendors like **ZKTeco** or **eSSL**. Employees punch in on the device; punches sync into the HRMS automatically.

**What Khatario has today instead:**
- Admin manual mark  
- Employee **web/mobile** check-in  
- **Kiosk** (shared tablet, code-based)  
- **Face** via phone/laptop camera (not a wall-mounted vendor device)

**“Ignore 12 months”** = we do **not** build integrations with those hardware vendors this year. Most SMBs can use mobile + kiosk + face. Revisit when a customer explicitly needs existing office scanners.

*If you want biometrics on the roadmap sooner, say so — otherwise we treat the row above as approved.*

### Employee portal — admin configurability

Today’s **default seed** (`253_product_lines_and_module_plans.sql`): portal on `hr_pro`, not on `hr_starter`. That is only the factory default.

**Required behavior:**
1. Platform admin toggles `hr_employee_portal` on any plan in **Admin → Plans → Feature matrix**.  
2. Runtime enforcement uses `hasFeatureAccess(business_id, 'hr_employee_portal')` only — no `plan_id === 'hr_pro'` checks in app code.  
3. Phase 0: audit and remove any hardcoded portal tier assumptions in UI copy or upgrade prompts.

---

## Open decisions (remaining)

1. **Mobile:** Capacitor deep links vs dedicated HR app — **TBD** (no sprint work until decided).

---

## Related files

| Area | Path |
|------|------|
| Settings registry | `lib/settings-module-registry.ts` |
| HR lib | `lib/hr/` |
| ESS gates | `lib/employee-portal/feature-gates.ts` |
| Payroll prefill | `app/api/employees/salary/payments/prefill/route.ts` |
| Payslip PDF | `lib/payslip-generator.ts` |
| HR plans | `database/migrations/253_product_lines_and_module_plans.sql` |
| Prior QA | `e2e/evidence/LOCAL_PLANS_QA_REPORT.md` |

---

*Last updated: 2026-06-26 (product decisions locked). Owner: product + engineering. Review after Phase 0 complete.*
