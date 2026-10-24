import bcrypt from 'bcryptjs';
import { queryOne, queryRows } from '@/lib/db';
import { normalizeReferralCode } from '@/lib/partners/codes';
import type {
  CommissionBasis,
  CommissionType,
  PartnerStatus,
  PartnerType,
  PlatformPartner,
} from '@/lib/partners/types';

const PARTNER_SELECT = `
  id, partner_type, name, email, phone, referral_code, status,
  commission_type, commission_value, commission_basis, hold_days,
  pan, gstin, bank_account_name, bank_account_number, bank_ifsc, upi_id,
  notes, last_login_at, created_at, updated_at
`;

function mapPartner(row: Record<string, unknown>): PlatformPartner {
  return {
    ...(row as unknown as PlatformPartner),
    commission_value: Number(row.commission_value),
    hold_days: row.hold_days == null ? null : Number(row.hold_days),
  };
}

export async function authenticatePartner(
  email: string,
  password: string,
): Promise<PlatformPartner | null> {
  const row = await queryOne<Record<string, unknown> & { password_hash: string }>(
    `SELECT ${PARTNER_SELECT}, password_hash
     FROM platform_partners
     WHERE lower(email) = lower($1) AND status = 'active'`,
    [email.trim()],
  );
  if (!row) return null;
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return null;
  const { password_hash: _, ...rest } = row;
  return mapPartner(rest);
}

export async function getPartnerById(id: string): Promise<PlatformPartner | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT ${PARTNER_SELECT} FROM platform_partners WHERE id = $1`,
    [id],
  );
  return row ? mapPartner(row) : null;
}

export type CreatePartnerInput = {
  partnerType: PartnerType;
  name: string;
  email: string;
  phone?: string | null;
  password: string;
  referralCode: string;
  status?: PartnerStatus;
  commissionType?: CommissionType;
  commissionValue?: number;
  commissionBasis?: CommissionBasis;
  holdDays?: number | null;
  pan?: string | null;
  gstin?: string | null;
  notes?: string | null;
  createdByAdminId?: string | null;
};

export async function createPartner(input: CreatePartnerInput): Promise<PlatformPartner> {
  const code = normalizeReferralCode(input.referralCode);
  if (!code) throw new Error('Invalid referral code');
  if (!input.password || input.password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const passwordHash = await bcrypt.hash(input.password, 10);
  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO platform_partners (
       partner_type, name, email, phone, password_hash, referral_code, status,
       commission_type, commission_value, commission_basis, hold_days,
       pan, gstin, notes, created_by_admin_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING ${PARTNER_SELECT}`,
    [
      input.partnerType,
      input.name.trim(),
      input.email.trim().toLowerCase(),
      input.phone?.trim() || null,
      passwordHash,
      code,
      input.status ?? 'active',
      input.commissionType ?? 'percentage',
      input.commissionValue ?? 20,
      input.commissionBasis ?? 'first_payment',
      input.holdDays ?? null,
      input.pan?.trim() || null,
      input.gstin?.trim() || null,
      input.notes?.trim() || null,
      input.createdByAdminId ?? null,
    ],
  );
  if (!row) throw new Error('Failed to create partner');
  const partner = mapPartner(row);
  const { ensureOwnerUserForPartner } = await import('@/lib/partners/team');
  await ensureOwnerUserForPartner({
    partnerId: partner.id,
    name: partner.name,
    email: partner.email,
    phone: partner.phone,
    passwordHash,
  });
  return partner;
}

export async function listPartners(filters?: {
  status?: PartnerStatus;
  q?: string;
}): Promise<PlatformPartner[]> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (filters?.status) {
    clauses.push(`status = $${i++}`);
    values.push(filters.status);
  }
  if (filters?.q?.trim()) {
    clauses.push(
      `(name ILIKE $${i} OR email ILIKE $${i} OR referral_code ILIKE $${i} OR phone ILIKE $${i})`,
    );
    values.push(`%${filters.q.trim()}%`);
    i++;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const list = await queryRows<Record<string, unknown>>(
    `SELECT ${PARTNER_SELECT}
     FROM platform_partners
     ${where}
     ORDER BY created_at DESC
     LIMIT 200`,
    values,
  );
  return list.map(mapPartner);
}

export async function updatePartner(
  partnerId: string,
  patch: Partial<{
    partnerType: PartnerType;
    name: string;
    email: string;
    phone: string | null;
    status: PartnerStatus;
    referralCode: string;
    commissionType: CommissionType;
    commissionValue: number;
    commissionBasis: CommissionBasis;
    holdDays: number | null;
    pan: string | null;
    gstin: string | null;
    bankAccountName: string | null;
    bankAccountNumber: string | null;
    bankIfsc: string | null;
    upiId: string | null;
    notes: string | null;
    password: string;
  }>,
): Promise<PlatformPartner | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  const map: Array<[keyof typeof patch, string, (v: unknown) => unknown]> = [
    ['partnerType', 'partner_type', (v) => v],
    ['name', 'name', (v) => String(v).trim()],
    ['email', 'email', (v) => String(v).trim().toLowerCase()],
    ['phone', 'phone', (v) => (v == null || v === '' ? null : String(v).trim())],
    ['status', 'status', (v) => v],
    [
      'referralCode',
      'referral_code',
      (v) => {
        const c = normalizeReferralCode(v);
        if (!c) throw new Error('Invalid referral code');
        return c;
      },
    ],
    ['commissionType', 'commission_type', (v) => v],
    ['commissionValue', 'commission_value', (v) => Number(v)],
    ['commissionBasis', 'commission_basis', (v) => v],
    ['holdDays', 'hold_days', (v) => (v == null || v === '' ? null : Number(v))],
    ['pan', 'pan', (v) => (v == null || v === '' ? null : String(v).trim())],
    ['gstin', 'gstin', (v) => (v == null || v === '' ? null : String(v).trim())],
    [
      'bankAccountName',
      'bank_account_name',
      (v) => (v == null || v === '' ? null : String(v).trim()),
    ],
    [
      'bankAccountNumber',
      'bank_account_number',
      (v) => (v == null || v === '' ? null : String(v).trim()),
    ],
    ['bankIfsc', 'bank_ifsc', (v) => (v == null || v === '' ? null : String(v).trim())],
    ['upiId', 'upi_id', (v) => (v == null || v === '' ? null : String(v).trim())],
    ['notes', 'notes', (v) => (v == null || v === '' ? null : String(v).trim())],
  ];

  for (const [key, col, transform] of map) {
    if (patch[key] !== undefined) {
      sets.push(`${col} = $${i++}`);
      values.push(transform(patch[key]));
    }
  }

  let newPasswordHash: string | null = null;
  if (patch.password) {
    if (patch.password.length < 8) throw new Error('Password must be at least 8 characters');
    newPasswordHash = await bcrypt.hash(patch.password, 10);
    sets.push(`password_hash = $${i++}`);
    values.push(newPasswordHash);
  }

  if (!sets.length) return getPartnerById(partnerId);

  sets.push('updated_at = CURRENT_TIMESTAMP');
  values.push(partnerId);

  const row = await queryOne<Record<string, unknown>>(
    `UPDATE platform_partners SET ${sets.join(', ')} WHERE id = $${i}
     RETURNING ${PARTNER_SELECT}`,
    values,
  );
  const partner = row ? mapPartner(row) : null;
  if (partner && newPasswordHash) {
    await queryOne(
      `UPDATE platform_partner_users
       SET password_hash = $2, updated_at = CURRENT_TIMESTAMP
       WHERE partner_id = $1 AND role = 'owner'`,
      [partnerId, newPasswordHash],
    );
  }
  return partner;
}
