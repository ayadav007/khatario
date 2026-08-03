import { queryRows, queryOne } from '@/lib/db';

export type DocumentTemplate = {
  id: string;
  name: string;
  document_type: string;
  body_html: string;
  margin_mm: { top: number; right: number; bottom: number; left: number };
  show_border: boolean;
  show_logo: boolean;
  attribute_map: Array<{ key: string; label: string }>;
};

export const DOCUMENT_ATTRIBUTES = [
  { key: 'employee.name', label: 'Full name' },
  { key: 'employee.first_name', label: 'First name' },
  { key: 'employee.employee_code', label: 'Employee ID' },
  { key: 'employee.designation', label: 'Designation' },
  { key: 'employee.department', label: 'Department' },
  { key: 'employee.joining_date', label: 'Joining date' },
  { key: 'employee.salary', label: 'Salary' },
  { key: 'business.name', label: 'Company name' },
  { key: 'today', label: 'Today\'s date' },
] as const;

function parseMargins(raw: unknown) {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    top: Number(o.top ?? 20),
    right: Number(o.right ?? 20),
    bottom: Number(o.bottom ?? 20),
    left: Number(o.left ?? 20),
  };
}

export function mapRowToTemplate(row: Record<string, unknown>): DocumentTemplate {
  return {
    id: String(row.id),
    name: String(row.name),
    document_type: String(row.document_type ?? 'appointment_letter'),
    body_html: String(row.body_html ?? ''),
    margin_mm: parseMargins(row.margin_mm),
    show_border: row.show_border === true,
    show_logo: row.show_logo !== false,
    attribute_map: Array.isArray(row.attribute_map)
      ? (row.attribute_map as Array<{ key: string; label: string }>)
      : [],
  };
}

export async function listDocumentTemplates(businessId: string): Promise<DocumentTemplate[]> {
  const rows = await queryRows(
    `SELECT * FROM hr_document_templates
     WHERE business_id = $1 AND is_active = true
     ORDER BY name`,
    [businessId],
  );
  return rows.map((r) => mapRowToTemplate(r as Record<string, unknown>));
}

function getNested(obj: Record<string, unknown>, path: string): string {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return '';
    cur = (cur as Record<string, unknown>)[p];
  }
  if (cur == null) return '';
  if (cur instanceof Date) return cur.toISOString().slice(0, 10);
  return String(cur);
}

export async function generateDocumentHtml(
  businessId: string,
  templateId: string,
  employeeId: string,
): Promise<{ html: string; template: DocumentTemplate }> {
  const templateRow = await queryOne(
    `SELECT * FROM hr_document_templates WHERE id = $1 AND business_id = $2 AND is_active = true`,
    [templateId, businessId],
  );
  if (!templateRow) throw new Error('Template not found');
  const template = mapRowToTemplate(templateRow as Record<string, unknown>);

  const data = await queryOne<{
    employee_name: string;
    employee_code: string;
    designation: string | null;
    department: string | null;
    joining_date: string | null;
    salary: string | null;
    business_name: string;
    logo_url: string | null;
  }>(
    `SELECT u.name AS employee_name, e.employee_code, e.designation, e.department,
            e.joining_date::text, e.salary::text, b.name AS business_name, b.logo_url
     FROM employees e
     INNER JOIN users u ON u.id = e.id
     INNER JOIN businesses b ON b.id = e.business_id
     WHERE e.id = $1 AND e.business_id = $2`,
    [employeeId, businessId],
  );
  if (!data) throw new Error('Employee not found');

  const firstName = data.employee_name.split(' ')[0] ?? data.employee_name;
  const vars: Record<string, unknown> = {
    employee: {
      name: data.employee_name,
      first_name: firstName,
      employee_code: data.employee_code,
      designation: data.designation ?? '',
      department: data.department ?? '',
      joining_date: data.joining_date ?? '',
      salary: data.salary ?? '',
    },
    business: { name: data.business_name, logo_url: data.logo_url ?? '' },
    today: new Date().toISOString().slice(0, 10),
  };

  let html = template.body_html;
  for (const attr of DOCUMENT_ATTRIBUTES) {
    const val = getNested(vars, attr.key);
    html = html.replaceAll(`{{${attr.key}}}`, val);
  }

  const margin = template.margin_mm;
  const border = template.show_border ? 'border: 1px solid #ccc;' : '';
  const logo = template.show_logo && data.logo_url
    ? `<img src="${data.logo_url}" alt="" style="max-height:48px;margin-bottom:12px;" />`
    : '';

  html = `<div style="padding:${margin.top}mm ${margin.right}mm ${margin.bottom}mm ${margin.left}mm;${border}">${logo}${html}</div>`;

  return { html, template };
}

export async function logDocumentGeneration(
  businessId: string,
  templateId: string,
  employeeId: string,
  html: string,
  userId: string | null,
) {
  await queryOne(
    `INSERT INTO hr_document_generations (business_id, template_id, employee_id, generated_html, generated_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [businessId, templateId, employeeId, html, userId],
  );
}
