import type { PoolClient } from 'pg';
import { getPool, queryOne, queryRows } from '@/lib/db';
import { assertPeriodNotLocked } from '@/lib/period-lock-utils';
import { getDefaultBranchId } from '@/lib/branch-helpers';
import { getAccountForPaymentMode } from '@/lib/ledger-utils';
import { insertVoucherLines, requireAccountByCode, round2, type VoucherLine } from '@/lib/accounting/voucher-posting';
import {
  earnedAmount,
  periodBounds,
  splitSalaryPaymentBooks,
  type PayBasis,
  type WagePeriodKind,
} from '@/lib/hr/staff-wage';

type DayRow = { employee_id: string; status: string };

export class StaffWageError extends Error {}

async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function attendanceInClosedWagePeriod(
  businessId: string,
  employeeId: string,
  date: string,
): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT a.id
     FROM staff_wage_accruals a
     JOIN staff_wage_runs r ON r.id = a.run_id
     WHERE a.business_id = $1 AND a.employee_id = $2
       AND r.status = 'accrued'
       AND $3::date BETWEEN r.period_start AND r.period_end
     LIMIT 1`,
    [businessId, employeeId, date],
  );
  return !!row;
}

type EmployeePay = {
  id: string;
  name: string;
  pay_basis: PayBasis;
  salary: string | null;
};

async function loadRoster(businessId: string, employeeIds: string[]): Promise<EmployeePay[]> {
  if (employeeIds.length === 0) return [];
  return queryRows<EmployeePay>(
    `SELECT e.id, u.name, e.pay_basis, e.salary::text
     FROM employees e
     JOIN users u ON u.id = e.id
     WHERE e.business_id = $1 AND e.id = ANY($2::uuid[])`,
    [businessId, employeeIds],
  );
}

function countStatuses(rows: DayRow[]) {
  let present = 0;
  let half = 0;
  let absent = 0;
  let off = 0;
  for (const row of rows) {
    if (row.status === 'present') present++;
    else if (row.status === 'half_day') half++;
    else if (row.status === 'absent' || row.status === 'leave') absent++;
    else if (row.status === 'off' || row.status === 'holiday') off++;
  }
  return { present, half, absent, off };
}

export async function previewStaffWages(input: {
  businessId: string;
  employeeIds: string[];
  periodKind: WagePeriodKind;
  date: string;
}) {
  const bounds = periodBounds(input.periodKind, input.date);
  const roster = await loadRoster(input.businessId, input.employeeIds);
  const attendance = roster.length
    ? await queryRows<DayRow>(
        `SELECT employee_id, status
         FROM employee_attendance
         WHERE employee_id = ANY($1::uuid[])
           AND date BETWEEN $2::date AND $3::date`,
        [input.employeeIds, bounds.start, bounds.end],
      )
    : [];

  const byEmployee = new Map<string, DayRow[]>();
  for (const row of attendance) {
    const list = byEmployee.get(row.employee_id) ?? [];
    list.push(row);
    byEmployee.set(row.employee_id, list);
  }

  const lines = roster.map((employee) => {
    const counts = countStatuses(byEmployee.get(employee.id) ?? []);
    const gross = earnedAmount({
      payBasis: employee.pay_basis === 'daily' ? 'daily' : 'monthly',
      rate: Number(employee.salary ?? 0),
      periodKind: input.periodKind,
      presentDays: counts.present,
      halfDays: counts.half,
    });
    return {
      employee_id: employee.id,
      name: employee.name,
      pay_basis: employee.pay_basis === 'daily' ? 'daily' : 'monthly',
      rate: Number(employee.salary ?? 0),
      present_days: counts.present,
      half_days: counts.half,
      absent_days: counts.absent,
      off_days: counts.off,
      gross,
    };
  });

  const open = await queryRows<{
    accrual_id: string;
    run_id: string;
    employee_id: string;
    name: string;
    period_kind: WagePeriodKind;
    period_start: string;
    period_end: string;
    gross_amount: string;
    paid_amount: string;
  }>(
    `SELECT a.id AS accrual_id, a.run_id, a.employee_id, u.name,
            r.period_kind, r.period_start::text, r.period_end::text,
            a.gross_amount::text, a.paid_amount::text
     FROM staff_wage_accruals a
     JOIN staff_wage_runs r ON r.id = a.run_id
     JOIN employees e ON e.id = a.employee_id
     JOIN users u ON u.id = e.id
     WHERE a.business_id = $1 AND r.status = 'accrued'
       AND a.gross_amount > a.paid_amount
       AND a.employee_id = ANY($2::uuid[])
     ORDER BY r.period_start, u.name`,
    [input.businessId, input.employeeIds.length ? input.employeeIds : ['00000000-0000-0000-0000-000000000000']],
  );

  const existing = await queryOne<{ id: string; status: string }>(
    `SELECT id, status FROM staff_wage_runs
     WHERE business_id = $1 AND period_kind = $2 AND period_start = $3::date`,
    [input.businessId, input.periodKind, bounds.start],
  );

  return {
    period_kind: input.periodKind,
    period_start: bounds.start,
    period_end: bounds.end,
    already_closed: existing?.status === 'accrued',
    lines,
    earned_total: round2(lines.reduce((sum, line) => sum + line.gross, 0)),
    open_payables: open.map((row) => ({
      accrual_id: row.accrual_id,
      run_id: row.run_id,
      employee_id: row.employee_id,
      name: row.name,
      period_kind: row.period_kind,
      period_start: row.period_start,
      period_end: row.period_end,
      gross: Number(row.gross_amount),
      paid: Number(row.paid_amount),
      due: round2(Number(row.gross_amount) - Number(row.paid_amount)),
    })),
  };
}

export async function closeStaffWagePeriod(input: {
  businessId: string;
  actorUserId: string;
  employeeIds: string[];
  periodKind: WagePeriodKind;
  date: string;
}): Promise<{ runId: string; gross: number }> {
  const preview = await previewStaffWages(input);
  if (preview.already_closed) {
    throw new StaffWageError('This period is already posted to the books.');
  }
  const payableLines = preview.lines.filter((line) => line.gross > 0);
  if (payableLines.length === 0) {
    throw new StaffWageError('Nothing to post. Mark attendance and set a wage or monthly salary first.');
  }

  const branchId = await getDefaultBranchId(input.businessId);
  await assertPeriodNotLocked(input.businessId, branchId, preview.period_end, 'staff wage');

  return withTx(async (client) => {
    const run = await client.query<{ id: string }>(
      `INSERT INTO staff_wage_runs (business_id, period_kind, period_start, period_end, created_by)
       VALUES ($1, $2, $3::date, $4::date, $5)
       RETURNING id`,
      [input.businessId, input.periodKind, preview.period_start, preview.period_end, input.actorUserId],
    );
    const runId = run.rows[0].id;
    const wages = await requireAccountByCode(client, input.businessId, '5212', 'Salaries & Wages');
    const payable = await requireAccountByCode(client, input.businessId, '2113', 'Salary Payable');
    const label = input.periodKind === 'week'
      ? `Wages ${preview.period_start} to ${preview.period_end}`
      : `Salary ${preview.period_start.slice(0, 7)}`;

    const voucherLines: VoucherLine[] = [];
    for (const line of payableLines) {
      await client.query(
        `INSERT INTO staff_wage_accruals (
           run_id, business_id, employee_id, present_days, half_days, absent_days, off_days, gross_amount
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          runId,
          input.businessId,
          line.employee_id,
          line.present_days,
          line.half_days,
          line.absent_days,
          line.off_days,
          line.gross,
        ],
      );
      voucherLines.push({
        accountId: wages,
        debit: line.gross,
        credit: 0,
        narration: `${label} — ${line.name}`,
      });
      voucherLines.push({
        accountId: payable,
        debit: 0,
        credit: line.gross,
        narration: `${label} — ${line.name}`,
      });
    }

    await insertVoucherLines(client, {
      businessId: input.businessId,
      branchId,
      voucherId: runId,
      voucherType: 'staff_wage_accrual',
      entryDate: preview.period_end,
      reference: label,
      lines: voucherLines,
    });

    return { runId, gross: preview.earned_total };
  });
}

export async function payStaffWage(input: {
  businessId: string;
  actorUserId: string;
  accrualId: string;
  amount: number;
  paymentDate: string;
  paymentMode: string;
}): Promise<{ paymentId: string }> {
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new StaffWageError('Amount must be greater than zero.');

  const accrual = await queryOne<{
    id: string;
    employee_id: string;
    gross_amount: string;
    paid_amount: string;
    name: string;
    status: string;
  }>(
    `SELECT a.id, a.employee_id, a.gross_amount::text, a.paid_amount::text, u.name, r.status
     FROM staff_wage_accruals a
     JOIN staff_wage_runs r ON r.id = a.run_id
     JOIN users u ON u.id = a.employee_id
     WHERE a.id = $1 AND a.business_id = $2`,
    [input.accrualId, input.businessId],
  );
  if (!accrual || accrual.status !== 'accrued') {
    throw new StaffWageError('Wage entry not found.');
  }
  const due = round2(Number(accrual.gross_amount) - Number(accrual.paid_amount));
  if (amount - due > 0.001) {
    throw new StaffWageError(`Amount exceeds the balance due (₹${due.toFixed(2)}).`);
  }

  const branchId = await getDefaultBranchId(input.businessId);
  await assertPeriodNotLocked(input.businessId, branchId, input.paymentDate, 'staff wage payment');
  const cash = await getAccountForPaymentMode(input.businessId, input.paymentMode || 'cash');
  if (!cash) throw new StaffWageError('No cash or bank account for that payment mode.');

  return withTx(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO staff_wage_payments (
         business_id, accrual_id, employee_id, payment_date, amount, payment_mode, created_by
       ) VALUES ($1, $2, $3, $4::date, $5, $6, $7)
       RETURNING id`,
      [
        input.businessId,
        accrual.id,
        accrual.employee_id,
        input.paymentDate,
        amount,
        input.paymentMode || 'cash',
        input.actorUserId,
      ],
    );
    await client.query(
      `UPDATE staff_wage_accruals
       SET paid_amount = paid_amount + $1
       WHERE id = $2 AND business_id = $3`,
      [amount, accrual.id, input.businessId],
    );
    const payable = await requireAccountByCode(client, input.businessId, '2113', 'Salary Payable');
    const paymentId = inserted.rows[0].id;
    await insertVoucherLines(client, {
      businessId: input.businessId,
      branchId,
      voucherId: paymentId,
      voucherType: 'staff_wage_payment',
      entryDate: input.paymentDate,
      reference: `Pay ${accrual.name}`,
      lines: [
        { accountId: payable, debit: amount, credit: 0, narration: `Salary paid — ${accrual.name}` },
        { accountId: cash.id, debit: 0, credit: amount, narration: `Salary paid — ${accrual.name}` },
      ],
    });
    return { paymentId };
  });
}

export async function postSalaryAdvanceToBooks(input: {
  businessId: string;
  advanceId: string;
  amount: number;
  advanceDate: string;
  employeeName: string;
  paymentMode: string;
}): Promise<void> {
  const amount = round2(input.amount);
  if (!(amount > 0)) return;
  const branchId = await getDefaultBranchId(input.businessId);
  await assertPeriodNotLocked(input.businessId, branchId, input.advanceDate, 'salary advance');
  const cash = await getAccountForPaymentMode(input.businessId, input.paymentMode || 'cash');
  if (!cash) throw new StaffWageError('No cash or bank account for that payment mode.');

  await withTx(async (client) => {
    const advance = await requireAccountByCode(client, input.businessId, '1119', 'Advance to Employees');
    await insertVoucherLines(client, {
      businessId: input.businessId,
      branchId,
      voucherId: input.advanceId,
      voucherType: 'salary_advance',
      entryDate: input.advanceDate,
      reference: `Advance ${input.employeeName}`,
      lines: [
        { accountId: advance, debit: amount, credit: 0, narration: `Advance to ${input.employeeName}` },
        { accountId: cash.id, debit: 0, credit: amount, narration: `Advance to ${input.employeeName}` },
      ],
    });
    await client.query(
      `UPDATE salary_advances SET books_posted = true WHERE id = $1 AND business_id = $2`,
      [input.advanceId, input.businessId],
    );
  });
}

export async function postSalaryPaymentToBooks(input: {
  businessId: string;
  salaryPaymentId: string;
  employeeId: string;
  employeeName: string;
  paymentDate: string;
  paymentMode: string;
  gross: number;
  attendanceDeduction: number;
  net: number;
  tds: number;
  pf: number;
  esi: number;
  professionalTax: number;
  advanceRecovery: number;
  loan: number;
  otherDeductions: number;
}): Promise<void> {
  const earned = round2(Math.max(0, input.gross - input.attendanceDeduction));
  if (!(earned > 0) && !(input.net > 0)) return;

  const outstanding = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(a.gross_amount - a.paid_amount), 0)::text AS total
     FROM staff_wage_accruals a
     JOIN staff_wage_runs r ON r.id = a.run_id
     WHERE a.business_id = $1 AND a.employee_id = $2 AND r.status = 'accrued'`,
    [input.businessId, input.employeeId],
  );
  const onBooks = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(ar.recovery_amount), 0)::text AS total
     FROM advance_recoveries ar
     JOIN salary_advances sa ON sa.id = ar.advance_id
     WHERE ar.salary_payment_id = $1 AND sa.books_posted = true AND sa.business_id = $2`,
    [input.salaryPaymentId, input.businessId],
  );

  const split = splitSalaryPaymentBooks({
    earned,
    net: input.net,
    tds: input.tds,
    pf: input.pf,
    esi: input.esi,
    professionalTax: input.professionalTax,
    advanceRecovery: input.advanceRecovery,
    advanceOnBooks: Number(onBooks?.total ?? 0),
    loan: input.loan,
    otherDeductions: input.otherDeductions,
    accrualOutstanding: Number(outstanding?.total ?? 0),
  });

  const branchId = await getDefaultBranchId(input.businessId);
  await assertPeriodNotLocked(input.businessId, branchId, input.paymentDate, 'salary payment');
  const cash = await getAccountForPaymentMode(input.businessId, input.paymentMode || 'cash');
  if (!cash) throw new StaffWageError('No cash or bank account for that payment mode.');

  await withTx(async (client) => {
    const lines: VoucherLine[] = [];
    const name = input.employeeName;
    if (split.expense > 0) {
      const wages = await requireAccountByCode(client, input.businessId, '5212', 'Salaries & Wages');
      lines.push({ accountId: wages, debit: split.expense, credit: 0, narration: `Salary — ${name}` });
    }
    if (split.payableDebit > 0) {
      const payable = await requireAccountByCode(client, input.businessId, '2113', 'Salary Payable');
      lines.push({ accountId: payable, debit: split.payableDebit, credit: 0, narration: `Salary settled — ${name}` });
      let left = split.payableDebit;
      const openRows = await client.query<{ id: string; due: string }>(
        `SELECT a.id, (a.gross_amount - a.paid_amount)::text AS due
         FROM staff_wage_accruals a
         JOIN staff_wage_runs r ON r.id = a.run_id
         WHERE a.business_id = $1 AND a.employee_id = $2 AND r.status = 'accrued'
           AND a.gross_amount > a.paid_amount
         ORDER BY r.period_start
         FOR UPDATE`,
        [input.businessId, input.employeeId],
      );
      for (const row of openRows.rows) {
        if (left <= 0) break;
        const take = round2(Math.min(left, Number(row.due)));
        if (take <= 0) continue;
        await client.query(
          `UPDATE staff_wage_accruals SET paid_amount = paid_amount + $1 WHERE id = $2`,
          [take, row.id],
        );
        left = round2(left - take);
      }
    }
    const credit = async (code: string, accountName: string, amount: number, narration: string) => {
      if (!(amount > 0)) return;
      const id = code === 'cash'
        ? cash.id
        : await requireAccountByCode(client, input.businessId, code, accountName);
      lines.push({ accountId: id, debit: 0, credit: amount, narration });
    };
    await credit('cash', 'Cash', split.cash, `Salary paid — ${name}`);
    await credit('2102', 'TDS Payable', split.tds, `TDS on salary — ${name}`);
    await credit('2114', 'PF Payable', split.pf, `PF on salary — ${name}`);
    await credit('2115', 'ESI Payable', split.esi, `ESI on salary — ${name}`);
    await credit('2116', 'Professional Tax Payable', split.professionalTax, `Professional tax — ${name}`);
    await credit('1119', 'Advance to Employees', split.advanceOnBooks, `Advance recovered — ${name}`);
    await credit('2113', 'Salary Payable', split.withheld, `Salary deductions held — ${name}`);

    if (lines.length === 0) return;
    await insertVoucherLines(client, {
      businessId: input.businessId,
      branchId,
      voucherId: input.salaryPaymentId,
      voucherType: 'salary_payment',
      entryDate: input.paymentDate,
      reference: `Salary ${name}`,
      lines,
    });
  });
}
