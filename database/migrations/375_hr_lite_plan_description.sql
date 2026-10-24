-- HR Lite includes simple salary (the same payroll feature as HR Pro).
-- Leave and the employee portal stay on HR Pro. Statutory payroll is not a separate plan gate.

UPDATE subscription_plans
SET description = 'Included with Billing: up to 30 staff, attendance, and simple salary. Upgrade to HR Pro for leave and the employee portal.',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'hr_staff_lite';
