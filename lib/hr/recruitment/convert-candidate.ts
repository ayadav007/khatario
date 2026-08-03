import bcrypt from 'bcryptjs';
import { query, queryOne, queryRows } from '@/lib/db';
import { createSalaryStructure, salaryStructureFromOffer } from '@/lib/hr/salary-structure';
import { getEmployeePrefillFromOnboarding } from '@/lib/hr/recruitment/onboarding/task-service';
import { normalizePhoneOrNull } from '@/lib/utils/phone';

export type ConvertCandidateParams = {
  businessId: string;
  candidateId: string;
  actorUserId: string;
  physicalDocumentsVerified: boolean;
  reportingManagerId?: string | null;
  employeeCode?: string | null;
};

export type ConvertCandidateResult = {
  employee_id: string;
  salary_structure_id: string;
};

export async function convertCandidateToEmployee(
  params: ConvertCandidateParams,
): Promise<ConvertCandidateResult> {
  const candidate = await queryOne<{
    id: string;
    full_name: string;
    email: string;
    phone: string | null;
    status: string;
    employee_id: string | null;
    job_id: string;
  }>(
    `SELECT id, full_name, email, phone, status, employee_id, job_id
     FROM recruitment_candidates WHERE id = $1 AND business_id = $2`,
    [params.candidateId, params.businessId],
  );

  if (!candidate) throw new Error('Candidate not found');
  if (candidate.employee_id) throw new Error('Candidate already converted to employee');
  if (candidate.status !== 'offer_accepted' && candidate.status !== 'docs_verified' && candidate.status !== 'ready_to_join') {
    throw new Error('Candidate must accept the offer before joining');
  }
  if (!params.physicalDocumentsVerified) {
    throw new Error('Confirm physical document verification before converting to employee');
  }

  if (!candidate.phone?.trim()) {
    throw new Error('Candidate phone is required before converting to employee');
  }

  const offer = await queryOne<Record<string, unknown>>(
    `SELECT * FROM recruitment_offer_letters
     WHERE candidate_id = $1 AND business_id = $2 AND status = 'accepted'
     ORDER BY accepted_at DESC NULLS LAST LIMIT 1`,
    [params.candidateId, params.businessId],
  );

  if (!offer) throw new Error('No accepted offer letter found');

  const phoneNorm = normalizePhoneOrNull(candidate.phone ?? '') ?? candidate.phone;

  let userId: string;
  const existingUser = await queryOne<{ id: string }>(
    `SELECT id FROM users WHERE business_id = $1 AND (lower(trim(email)) = $2 OR phone = $3) LIMIT 1`,
    [params.businessId, candidate.email.toLowerCase(), phoneNorm ?? ''],
  );

  if (existingUser) {
    userId = existingUser.id;
    const existingEmp = await queryOne(`SELECT id FROM employees WHERE id = $1`, [userId]);
    if (existingEmp) throw new Error('An employee record already exists for this person');
  } else {
    const passwordHash = await bcrypt.hash(cryptoRandomPassword(), 10);
    const user = await queryOne<{ id: string }>(
      `INSERT INTO users (business_id, name, email, phone, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, 'user', true) RETURNING id`,
      [params.businessId, candidate.full_name, candidate.email, phoneNorm, passwordHash],
    );
    if (!user) throw new Error('Failed to create user');
    userId = user.id;
  }

  let employeeCode = params.employeeCode?.trim();
  if (!employeeCode) {
    const generated = await queryOne<{ generate_employee_code: string }>(
      'SELECT generate_employee_code($1) as generate_employee_code',
      [params.businessId],
    );
    employeeCode = generated?.generate_employee_code;
  }
  if (!employeeCode) throw new Error('Failed to generate employee code');

  const joiningDate = String(offer.joining_date).slice(0, 10);
  const prefill = await getEmployeePrefillFromOnboarding(params.businessId, params.candidateId);

  await queryOne(
    `INSERT INTO employees (
      id, business_id, employee_code, designation, department, joining_date,
      reporting_manager_id, employment_type, access_type, is_active,
      pan_number, aadhaar_number, bank_account_number, bank_ifsc, bank_name
    ) VALUES ($1, $2, $3, $4, $5, $6::date, $7, 'full_time', 'full', true, $8, $9, $10, $11, $12)`,
    [
      userId,
      params.businessId,
      employeeCode,
      offer.designation,
      offer.department ?? null,
      joiningDate,
      params.reportingManagerId ?? null,
      prefill.pan_number,
      prefill.aadhaar_number,
      prefill.bank_account_number,
      prefill.bank_ifsc,
      prefill.bank_name,
    ],
  );

  const docs = await queryRows<{
    document_type: string;
    file_name: string;
    file_url: string;
  }>(
    `SELECT document_type, file_name, file_url FROM candidate_documents
     WHERE candidate_id = $1 AND business_id = $2 AND verification_status = 'approved'`,
    [params.candidateId, params.businessId],
  );

  for (const doc of docs) {
    await query(
      `INSERT INTO employee_documents (employee_id, document_type, document_name, file_url, uploaded_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [userId, doc.document_type, doc.file_name, doc.file_url],
    );
  }

  const onboardingFiles = await queryRows<{
    file_name: string;
    file_url: string;
    task_name: string;
  }>(
    `SELECT f.file_name, f.file_url, t.name AS task_name
     FROM candidate_task_files f
     INNER JOIN candidate_onboarding_tasks t ON t.id = f.task_id
     WHERE f.candidate_id = $1 AND f.business_id = $2`,
    [params.candidateId, params.businessId],
  );

  for (const f of onboardingFiles) {
    await query(
      `INSERT INTO employee_documents (employee_id, document_type, document_name, file_url, uploaded_at)
       VALUES ($1, 'onboarding', $2, $3, CURRENT_TIMESTAMP)`,
      [userId, `${f.task_name}: ${f.file_name}`, f.file_url],
    );
  }

  const identityDocs = await queryRows<{ document_key: string; file_name: string | null; file_url: string | null }>(
    `SELECT document_key, file_name, file_url FROM candidate_identity_documents
     WHERE candidate_id = $1 AND business_id = $2 AND is_complete = true AND file_url IS NOT NULL`,
    [params.candidateId, params.businessId],
  );

  for (const id of identityDocs) {
    await query(
      `INSERT INTO employee_documents (employee_id, document_type, document_name, file_url, uploaded_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [userId, id.document_key, id.file_name ?? id.document_key, id.file_url],
    );
  }

  const structureInput = salaryStructureFromOffer(offer, userId, params.businessId);
  const structure = await createSalaryStructure(structureInput);

  await query(
    `UPDATE recruitment_candidates
     SET status = 'joined', employee_id = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND business_id = $3`,
    [userId, params.candidateId, params.businessId],
  );

  return { employee_id: userId, salary_structure_id: structure.id };
}

function cryptoRandomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#';
  let s = '';
  for (let i = 0; i < 14; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}
