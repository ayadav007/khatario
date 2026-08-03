import { query, queryOne, queryRows } from '@/lib/db';
import type { HolidayList } from '@/lib/hr/shift-overtime/types';

export type HolidayRow = {
  id: string;
  holiday_list_id: string;
  business_id: string;
  holiday_date: string;
  holiday_name: string;
  is_recurring: boolean;
  description: string | null;
};

export async function listHolidayLists(businessId: string): Promise<HolidayList[]> {
  return queryRows(
    `SELECT id, business_id, branch_id, name, is_default
     FROM holiday_lists WHERE business_id = $1 ORDER BY is_default DESC, name`,
    [businessId],
  );
}

export async function ensureDefaultHolidayList(businessId: string): Promise<HolidayList> {
  const existing = await queryOne<HolidayList>(
    `SELECT id, business_id, branch_id, name, is_default
     FROM holiday_lists WHERE business_id = $1 AND branch_id IS NULL AND is_default = true LIMIT 1`,
    [businessId],
  );
  if (existing) return existing;

  const row = await queryOne<{ id: string }>(
    `INSERT INTO holiday_lists (business_id, branch_id, name, is_default)
     VALUES ($1, NULL, 'Company default', true) RETURNING id`,
    [businessId],
  );
  return {
    id: row!.id,
    business_id: businessId,
    branch_id: null,
    name: 'Company default',
    is_default: true,
  };
}

export async function ensureBranchHolidayList(
  businessId: string,
  branchId: string,
  branchName?: string,
): Promise<HolidayList> {
  const existing = await queryOne<HolidayList>(
    `SELECT id, business_id, branch_id, name, is_default
     FROM holiday_lists WHERE business_id = $1 AND branch_id = $2 LIMIT 1`,
    [businessId, branchId],
  );
  if (existing) return existing;

  const row = await queryOne<{ id: string }>(
    `INSERT INTO holiday_lists (business_id, branch_id, name, is_default)
     VALUES ($1, $2, $3, false) RETURNING id`,
    [businessId, branchId, branchName ? `${branchName} holidays` : 'Branch holidays'],
  );
  return {
    id: row!.id,
    business_id: businessId,
    branch_id: branchId,
    name: branchName ? `${branchName} holidays` : 'Branch holidays',
    is_default: false,
  };
}

export async function resolveHolidayListForEmployee(
  businessId: string,
  employeeId: string,
): Promise<HolidayList> {
  const emp = await queryOne<{ branch_id: string | null }>(
    `SELECT branch_id FROM employees WHERE id = $1 AND business_id = $2`,
    [employeeId, businessId],
  );
  if (emp?.branch_id) {
    return ensureBranchHolidayList(businessId, emp.branch_id);
  }
  return ensureDefaultHolidayList(businessId);
}

export async function assertHolidayListOwned(
  businessId: string,
  holidayListId: string,
): Promise<HolidayList | null> {
  return queryOne<HolidayList>(
    `SELECT id, business_id, branch_id, name, is_default
     FROM holiday_lists WHERE id = $1 AND business_id = $2`,
    [holidayListId, businessId],
  );
}

export type HolidayInput = {
  holiday_date: string;
  holiday_name: string;
  description?: string | null;
  is_recurring?: boolean;
};

export async function createHolidayInList(
  businessId: string,
  holidayListId: string,
  input: HolidayInput,
): Promise<HolidayRow> {
  const list = await assertHolidayListOwned(businessId, holidayListId);
  if (!list) throw new Error('Holiday list not found');

  const name = input.holiday_name?.trim();
  if (!input.holiday_date || !name) {
    throw new Error('holiday_date and holiday_name are required');
  }

  const row = await queryOne<HolidayRow>(
    `INSERT INTO holidays (business_id, holiday_list_id, holiday_date, holiday_name, is_recurring, description)
     VALUES ($1, $2, $3::date, $4, $5, $6)
     RETURNING id, holiday_list_id, business_id, holiday_date::text, holiday_name, is_recurring, description`,
    [
      businessId,
      holidayListId,
      input.holiday_date,
      name,
      input.is_recurring === true,
      input.description?.trim() || null,
    ],
  );
  if (!row) throw new Error('Failed to create holiday');
  return row;
}

export async function updateHolidayInList(
  businessId: string,
  holidayId: string,
  input: Partial<HolidayInput>,
): Promise<HolidayRow | null> {
  const existing = await queryOne<{ id: string; holiday_list_id: string | null }>(
    `SELECT id, holiday_list_id FROM holidays WHERE id = $1 AND business_id = $2`,
    [holidayId, businessId],
  );
  if (!existing?.holiday_list_id) return null;

  const list = await assertHolidayListOwned(businessId, existing.holiday_list_id);
  if (!list) return null;

  const updates: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (input.holiday_date !== undefined) {
    updates.push(`holiday_date = $${i++}::date`);
    params.push(input.holiday_date);
  }
  if (input.holiday_name !== undefined) {
    updates.push(`holiday_name = $${i++}`);
    params.push(input.holiday_name.trim());
  }
  if (input.is_recurring !== undefined) {
    updates.push(`is_recurring = $${i++}`);
    params.push(input.is_recurring);
  }
  if (input.description !== undefined) {
    updates.push(`description = $${i++}`);
    params.push(input.description?.trim() || null);
  }

  if (updates.length === 0) {
    return queryOne<HolidayRow>(
      `SELECT id, holiday_list_id, business_id, holiday_date::text, holiday_name, is_recurring, description
       FROM holidays WHERE id = $1`,
      [holidayId],
    );
  }

  params.push(holidayId);
  await query(`UPDATE holidays SET ${updates.join(', ')} WHERE id = $${i}`, params);

  return queryOne<HolidayRow>(
    `SELECT id, holiday_list_id, business_id, holiday_date::text, holiday_name, is_recurring, description
     FROM holidays WHERE id = $1`,
    [holidayId],
  );
}

export async function deleteHolidayFromList(
  businessId: string,
  holidayId: string,
): Promise<boolean> {
  const existing = await queryOne<{ id: string; holiday_list_id: string | null }>(
    `SELECT id, holiday_list_id FROM holidays WHERE id = $1 AND business_id = $2`,
    [holidayId, businessId],
  );
  if (!existing?.holiday_list_id) return false;

  const list = await assertHolidayListOwned(businessId, existing.holiday_list_id);
  if (!list) return false;

  await query(`DELETE FROM holidays WHERE id = $1`, [holidayId]);
  return true;
}

export async function listHolidaysForList(
  holidayListId: string,
  year?: number,
): Promise<HolidayRow[]> {
  let sql = `SELECT id, holiday_list_id, business_id, holiday_date::text, holiday_name, is_recurring, description
             FROM holidays WHERE holiday_list_id = $1`;
  const params: unknown[] = [holidayListId];
  if (year) {
    sql += ` AND EXTRACT(YEAR FROM holiday_date) = $2`;
    params.push(year);
  }
  sql += ` ORDER BY holiday_date`;
  return queryRows(sql, params);
}

export async function isHolidayForEmployee(
  businessId: string,
  employeeId: string,
  dateStr: string,
): Promise<boolean> {
  const list = await resolveHolidayListForEmployee(businessId, employeeId);
  const row = await queryOne(
    `SELECT id FROM holidays WHERE holiday_list_id = $1 AND holiday_date = $2::date`,
    [list.id, dateStr],
  );
  return Boolean(row);
}

export function parseHolidayCsv(text: string): Array<{ date: string; name: string; description?: string }> {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const dateIdx = header.indexOf('holiday_date') >= 0 ? header.indexOf('holiday_date') : header.indexOf('date');
  const nameIdx = header.indexOf('holiday_name') >= 0 ? header.indexOf('holiday_name') : header.indexOf('name');
  const descIdx = header.indexOf('description');
  if (dateIdx < 0 || nameIdx < 0) return [];

  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim());
    return {
      date: cols[dateIdx] ?? '',
      name: cols[nameIdx] ?? '',
      description: descIdx >= 0 ? cols[descIdx] : undefined,
    };
  });
}

export async function importHolidayCsv(
  businessId: string,
  holidayListId: string,
  csvText: string,
): Promise<{ imported: number; errors: string[] }> {
  const rows = parseHolidayCsv(csvText);
  let imported = 0;
  const errors: string[] = [];

  for (const row of rows) {
    if (!row.date || !row.name) {
      errors.push('Missing date or name in a row');
      continue;
    }
    try {
      await queryOne(
        `INSERT INTO holidays (business_id, holiday_list_id, holiday_date, holiday_name, description)
         VALUES ($1, $2, $3::date, $4, $5)
         ON CONFLICT DO NOTHING`,
        [businessId, holidayListId, row.date, row.name, row.description ?? null],
      );
      imported++;
    } catch {
      errors.push(`Failed to import ${row.date} ${row.name}`);
    }
  }
  return { imported, errors };
}
