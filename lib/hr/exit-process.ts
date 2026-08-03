import { queryRows, queryOne } from '@/lib/db';
import { getHrExitSettings, resolveNoticePeriodDays } from '@/lib/hr/exit-settings';
import { bootstrapExitApprovalChain, listExitApprovals } from '@/lib/hr/exit-approval';

export type ExitRecord = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  exit_type: string;
  status: string;
  reason: string | null;
  notice_period_days: number | null;
  last_working_date: string | null;
  rehire_eligible: boolean | null;
  fnf_status: string;
  created_at: string;
};

export async function listExits(businessId: string, status?: string): Promise<ExitRecord[]> {
  const params: unknown[] = [businessId];
  let sql = `
    SELECT ex.id, ex.employee_id, u.name AS employee_name, e.employee_code,
           ex.exit_type, ex.status, ex.reason, ex.notice_period_days,
           ex.last_working_date::text, ex.rehire_eligible, ex.fnf_status,
           ex.created_at::text
    FROM employee_exits ex
    INNER JOIN employees e ON e.id = ex.employee_id
    INNER JOIN users u ON u.id = e.id
    WHERE ex.business_id = $1`;
  if (status) {
    params.push(status);
    sql += ` AND ex.status = $${params.length}`;
  }
  sql += ` ORDER BY ex.created_at DESC LIMIT 100`;
  return queryRows(sql, params) as Promise<ExitRecord[]>;
}

export async function initiateExit(input: {
  businessId: string;
  employeeId: string;
  exitType: 'resignation' | 'termination';
  reason?: string;
  resignationSubmittedAt?: string;
  rehireEligible?: boolean;
  createdBy: string;
  lastWorkingDate?: string;
}): Promise<{ id: string }> {
  const existing = await queryOne(
    `SELECT id FROM employee_exits
     WHERE employee_id = $1 AND status NOT IN ('completed', 'cancelled')`,
    [input.employeeId],
  );
  if (existing) throw new Error('An active exit process already exists for this employee');

  const emp = await queryOne<{ joining_date: string | null }>(
    `SELECT joining_date::text FROM employees WHERE id = $1 AND business_id = $2`,
    [input.employeeId, input.businessId],
  );
  if (!emp) throw new Error('Employee not found');

  const settings = await getHrExitSettings(input.businessId);
  let years = 0;
  if (emp.joining_date) {
    const joined = new Date(emp.joining_date);
    years = (Date.now() - joined.getTime()) / (365.25 * 24 * 3600 * 1000);
  }
  const noticeDays = resolveNoticePeriodDays(settings, years);

  const row = await queryOne<{ id: string }>(
    `INSERT INTO employee_exits (
       business_id, employee_id, exit_type, status, reason,
       notice_period_days, last_working_date, rehire_eligible,
       resignation_submitted_at, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      input.businessId,
      input.employeeId,
      input.exitType,
      input.exitType === 'termination' ? 'in_notice' : 'initiated',
      input.reason ?? null,
      noticeDays,
      input.lastWorkingDate ?? null,
      input.rehireEligible ?? null,
      input.resignationSubmittedAt ?? null,
      input.createdBy,
    ],
  );
  if (!row) throw new Error('Failed to create exit');

  if (input.exitType === 'termination') {
    await queryOne(
      `UPDATE employee_exits SET
         approved_at = CURRENT_TIMESTAMP,
         approved_by = $3,
         last_working_date = COALESCE(
           last_working_date,
           (CURRENT_DATE + (notice_period_days || 0) * INTERVAL '1 day')::date
         ),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND business_id = $2`,
      [row.id, input.businessId, input.createdBy],
    );
  } else {
    await bootstrapExitApprovalChain(row.id, input.businessId, input.employeeId);
  }

  const templates = await queryRows<{ task_items: unknown }>(
    `SELECT task_items FROM hr_exit_checklist_templates
     WHERE business_id = $1 AND is_active = true ORDER BY sort_order`,
    [input.businessId],
  );

  let sort = 0;
  for (const tpl of templates) {
    const items = Array.isArray(tpl.task_items) ? tpl.task_items : [];
    for (const item of items) {
      const t = item as Record<string, unknown>;
      const title = String(t.title ?? t.name ?? 'Task');
      const category = String(t.category ?? 'general');
      await queryOne(
        `INSERT INTO hr_exit_tasks (exit_id, title, category, sort_order)
         VALUES ($1, $2, $3, $4)`,
        [row.id, title, category, sort++],
      );
    }
  }

  if (sort === 0) {
    for (const def of [
      { title: 'Collect ID card and access badges', category: 'asset_recovery' },
      { title: 'Recover laptop / company assets', category: 'asset_recovery' },
      { title: 'Knowledge transfer session', category: 'knowledge_transfer' },
      { title: 'Full & final settlement review', category: 'fnf' },
    ]) {
      await queryOne(
        `INSERT INTO hr_exit_tasks (exit_id, title, category, sort_order)
         VALUES ($1, $2, $3, $4)`,
        [row.id, def.title, def.category, sort++],
      );
    }
  }

  return { id: row.id };
}

export async function getExitDetail(businessId: string, exitId: string) {
  const exit = await queryOne(
    `SELECT ex.*, u.name AS employee_name, e.employee_code
     FROM employee_exits ex
     INNER JOIN employees e ON e.id = ex.employee_id
     INNER JOIN users u ON u.id = e.id
     WHERE ex.id = $1 AND ex.business_id = $2`,
    [exitId, businessId],
  );
  if (!exit) return null;

  const tasks = await queryRows(
    `SELECT id, title, category, status, due_date::text, completed_at::text, notes, sort_order
     FROM hr_exit_tasks WHERE exit_id = $1 ORDER BY sort_order`,
    [exitId],
  );

  const approvals = await listExitApprovals(exitId);

  return { exit, tasks, approvals };
}

export async function updateExitTask(
  exitId: string,
  taskId: string,
  patch: { status?: string; notes?: string },
) {
  await queryOne(
    `UPDATE hr_exit_tasks SET
       status = COALESCE($3, status),
       notes = COALESCE($4, notes),
       completed_at = CASE WHEN $3 = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END
     WHERE id = $2 AND exit_id = $1`,
    [exitId, taskId, patch.status ?? null, patch.notes ?? null],
  );
}

export async function updateFnf(
  exitId: string,
  businessId: string,
  patch: {
    fnf_status?: string;
    fnf_amount_due?: number;
    fnf_amount_recovery?: number;
    fnf_settled?: boolean;
  },
) {
  await queryOne(
    `UPDATE employee_exits SET
       fnf_status = COALESCE($3, fnf_status),
       fnf_amount_due = COALESCE($4, fnf_amount_due),
       fnf_amount_recovery = COALESCE($5, fnf_amount_recovery),
       fnf_settled_at = CASE WHEN $6 = true THEN CURRENT_TIMESTAMP ELSE fnf_settled_at END,
       status = CASE WHEN $6 = true AND fnf_status = 'settled' THEN 'completed' ELSE status END,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2`,
    [
      exitId,
      businessId,
      patch.fnf_status ?? null,
      patch.fnf_amount_due ?? null,
      patch.fnf_amount_recovery ?? null,
      patch.fnf_settled === true,
    ],
  );
}
