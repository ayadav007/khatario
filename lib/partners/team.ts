import bcrypt from 'bcryptjs';
import { query, queryOne, queryRows } from '@/lib/db';

export type PartnerUserRole = 'owner' | 'member';

export type PartnerUser = {
  id: string;
  partner_id: string;
  name: string;
  email: string;
  phone: string | null;
  role: PartnerUserRole;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
};

export async function listPartnerUsers(partnerId: string): Promise<PartnerUser[]> {
  return queryRows<PartnerUser>(
    `SELECT id, partner_id, name, email, phone, role, is_active, last_login_at, created_at
     FROM platform_partner_users
     WHERE partner_id = $1
     ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, created_at ASC`,
    [partnerId],
  );
}

export async function ensureOwnerUserForPartner(params: {
  partnerId: string;
  name: string;
  email: string;
  phone?: string | null;
  passwordHash: string;
}): Promise<void> {
  await query(
    `INSERT INTO platform_partner_users (
       partner_id, name, email, phone, password_hash, role, is_active
     ) VALUES ($1, $2, lower($3), $4, $5, 'owner', true)
     ON CONFLICT (email) DO UPDATE SET
       partner_id = EXCLUDED.partner_id,
       name = EXCLUDED.name,
       phone = COALESCE(EXCLUDED.phone, platform_partner_users.phone),
       password_hash = EXCLUDED.password_hash,
       role = 'owner',
       is_active = true,
       updated_at = CURRENT_TIMESTAMP`,
    [
      params.partnerId,
      params.name,
      params.email.trim().toLowerCase(),
      params.phone ?? null,
      params.passwordHash,
    ],
  );
}

export async function addPartnerMember(params: {
  partnerId: string;
  name: string;
  email: string;
  phone?: string | null;
  password: string;
  role?: PartnerUserRole;
}): Promise<PartnerUser> {
  if (!params.password || params.password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const partner = await queryOne<{ partner_type: string; status: string }>(
    `SELECT partner_type, status FROM platform_partners WHERE id = $1`,
    [params.partnerId],
  );
  if (!partner || partner.status !== 'active') {
    throw new Error('Partner is not active');
  }
  if (partner.partner_type !== 'agency' && params.role !== 'owner') {
    // Freelancers can still add one helper, but agencies are the intended case.
  }

  const passwordHash = await bcrypt.hash(params.password, 10);
  const row = await queryOne<PartnerUser>(
    `INSERT INTO platform_partner_users (
       partner_id, name, email, phone, password_hash, role, is_active
     ) VALUES ($1, $2, lower($3), $4, $5, $6, true)
     RETURNING id, partner_id, name, email, phone, role, is_active, last_login_at, created_at`,
    [
      params.partnerId,
      params.name.trim(),
      params.email.trim().toLowerCase(),
      params.phone?.trim() || null,
      passwordHash,
      params.role === 'owner' ? 'owner' : 'member',
    ],
  );
  if (!row) throw new Error('Failed to add team member');
  return row;
}

export async function setPartnerUserActive(
  partnerId: string,
  userId: string,
  isActive: boolean,
): Promise<boolean> {
  const row = await queryOne(
    `UPDATE platform_partner_users
     SET is_active = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND partner_id = $2 AND role != 'owner'
     RETURNING id`,
    [userId, partnerId, isActive],
  );
  return Boolean(row);
}

export async function authenticatePartnerUser(
  email: string,
  password: string,
): Promise<{
  partnerId: string;
  userId: string;
  role: PartnerUserRole;
  name: string;
  email: string;
} | null> {
  const row = await queryOne<{
    id: string;
    partner_id: string;
    name: string;
    email: string;
    role: PartnerUserRole;
    password_hash: string;
    partner_status: string;
  }>(
    `SELECT u.id, u.partner_id, u.name, u.email, u.role, u.password_hash,
            p.status AS partner_status
     FROM platform_partner_users u
     JOIN platform_partners p ON p.id = u.partner_id
     WHERE lower(u.email) = lower($1) AND u.is_active = true`,
    [email.trim()],
  );
  if (!row || row.partner_status !== 'active') return null;
  let ok = false;
  try {
    ok = await bcrypt.compare(password, row.password_hash);
  } catch {
    return null;
  }
  if (!ok) return null;

  await query(
    `UPDATE platform_partner_users SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [row.id],
  );

  return {
    partnerId: row.partner_id,
    userId: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
  };
}
