# Admin Plans — full settings catalog

Source: `platform_limits` + `platform_features` tables (what `/admin/plans` **Limits** and **Features** matrices edit).

## Plan metadata (Edit Plan modal)

| Setting | Purpose |
|--------|---------|
| Plan ID | Internal key (`free`, `trial`, `professional`, …) |
| Display name | Name shown to customers |
| Description | Marketing / help text |
| Monthly price | ₹/month |
| Yearly price | ₹/year |
| Currency | e.g. INR |
| Active | Plan visible/selectable |
| Sort order | Upgrade/downgrade tier ordering |

Legacy JSONB limits in Edit Plan (6 fields) — superseded by **Limits** matrix for enforcement.

---

## Usage limits (28) — Limits matrix

### Sales (6)

| Key | Label |
|-----|-------|
| `max_invoices_per_month` | Max Invoices Per Month |
| `max_customers` | Max Customers |
| `max_items` | Max Items |
| `max_estimates_per_month` | Max Estimates Per Month |
| `max_credit_notes_per_month` | Max Credit Notes Per Month |
| `max_sales_orders_per_month` | Max Sales Orders Per Month |

### General (3)

| Key | Label |
|-----|-------|
| `max_users` | Max Users (console seats) |
| `max_branches` | Max Branches/Locations |
| `max_departments` | Max Departments |

### Integrations (2)

| Key | Label |
|-----|-------|
| `max_whatsapp_per_day` | Max WhatsApp Messages Per Day |
| `max_email_per_day` | Max Emails Per Day |

### HR (13)

| Key | Label |
|-----|-------|
| `max_employees` | Max Employees |
| `max_attendance_records_per_month` | Max Attendance Records Per Month |
| `max_leave_requests_per_month` | Max Leave Requests Per Month |
| `max_leave_requests_per_employee_per_year` | Max Leave Requests Per Employee Per Year ⚠️ *registry only — no `check-limit` API yet* |
| `max_payroll_records_per_month` | Max Payroll Records Per Month |
| `max_salary_advances_per_month` | Max Salary Advances Per Month |
| `max_designations` | Max Designations |
| `max_shifts` | Max Shifts |
| `max_holidays` | Max Holidays |
| `max_performance_reviews_per_month` | Max Performance Reviews Per Month |
| `max_employee_expenses_per_month` | Max Employee Expenses Per Month |
| `max_commissions_per_month` | Max Commission Records Per Month |
| `max_employee_tasks_per_month` | Max Employee Tasks Per Month |

### Purchase (4)

| Key | Label |
|-----|-------|
| `max_purchases_per_month` | Max Purchases Per Month |
| `max_suppliers` | Max Suppliers |
| `max_purchase_orders_per_month` | Max Purchase Orders Per Month |
| `max_expenses_per_month` | Max Expenses Per Month |

---

## Features (62) — Feature matrix

### Sales (10)

`sales_invoices`, `sales_new_invoice`, `sales_estimates`, `sales_credit_notes`, `sales_recurring_invoices`, `sales_sales_orders`, `sales_delivery_challans`, `sales_work_orders`, `sales_debit_notes`, `party_pricing`, `profit_invoice`

### Purchase (5)

`purchase_management`, `purchase_suppliers`, `purchase_orders`, `purchase_expenses`, `purchase_inventory_adjustments`

### Inventory (6)

`dead_stock_widget`, `barcode_label_printing`, `barcode_label_from_purchase`, `barcode_label_templates`, `barcode_thermal_printer`, `barcode_weight_embedded`

### HR (5)

`hr_employees`, `hr_attendance`, `hr_payroll`, `hr_leaves`, `hr_employee_portal`

### Reports (7)

`reports_basic`, `reports_gst`, `reports_advanced`, `reports_analytics`, `report_builder`, `profit_reports_basic`, `profit_reports_advanced`

### Settings (14)

`settings_template_customization`, `settings_multi_user`, `settings_multi_branch`, `settings_multi_warehouse`, `settings_pos_mode`, `settings_whatsapp`, `settings_backup`, `settings_multidevice_login`, `advanced_filters`, `bulk_actions`, `customizable_dashboard`, `workflow_automation`, `mobile_enhancements`, `accessibility`, `soft_delete`

### Tools (1)

`tools_todo`

### Integrations (7)

`integration_whatsapp_manual`, `integration_whatsapp_bot`, `integration_email`, `integration_payment_gateway`, `integration_api`, `whatsapp_credit_alerts`, `email_reminders`

### Advanced (5)

`advanced_ledger`, `advanced_multi_currency`, `advanced_barcode`, `advanced_online_store`, `advanced_custom_branding`

---

## Active plans (billing / HR / connect)

`free`, `professional`, `business`, `enterprise`, `trial`, `hr_starter`, `hr_pro`, `hr_trial`, `hr_free`, `connect`

---

## Automated test coverage

| Suite | What it checks |
|-------|----------------|
| `e2e/plan-settings-coverage.spec.ts` | All 27 `check-limit` types vs admin limits; feature registry sync |
| `e2e/plan-admin-hardening.spec.ts` | Admin override → user enforcement (limit + feature) |
| `e2e/plan-change-flow.spec.ts` | Free upgrade, downgrade preview, Change Plan UI, paid → checkout |
| `e2e/entitlement-*.spec.ts` | Module / API gates by product line |
