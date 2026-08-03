import { queryOne, query } from '@/lib/db';

export type CandidatePortalInviteEmailSettings = {
  subject: string;
  intro_html: string;
  footer_html: string;
  cta_label: string;
  include_task_table: boolean;
  include_login_steps: boolean;
  login_steps_html: string | null;
};

export const DEFAULT_CANDIDATE_PORTAL_INVITE_EMAIL: CandidatePortalInviteEmailSettings = {
  subject: 'New task(s) assigned for completion — {{business_name}}',
  intro_html: `<p>Hi {{candidate_name}},</p>
<p>This email is to inform you that <strong>{{business_name}}</strong> has assigned task(s) to you as part of your offer process. Kindly complete the tasks before the due dates.</p>
<p>You will need to sign in to our candidate portal to complete the tasks.</p>`,
  footer_html: '<p>Regards,<br/>{{business_name}}</p>',
  cta_label: 'Complete tasks',
  include_task_table: true,
  include_login_steps: true,
  login_steps_html: null,
};

const PLACEHOLDER_HINT =
  'Placeholders: {{candidate_name}}, {{business_name}}, {{portal_url}}, {{task_table}}, {{login_steps}}';

export function inviteEmailPlaceholderHint(): string {
  return PLACEHOLDER_HINT;
}

export function parseCandidatePortalInviteEmail(raw: unknown): CandidatePortalInviteEmailSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CANDIDATE_PORTAL_INVITE_EMAIL };
  const o = raw as Record<string, unknown>;
  return {
    subject:
      typeof o.subject === 'string' && o.subject.trim()
        ? o.subject.trim()
        : DEFAULT_CANDIDATE_PORTAL_INVITE_EMAIL.subject,
    intro_html:
      typeof o.intro_html === 'string' && o.intro_html.trim()
        ? o.intro_html
        : DEFAULT_CANDIDATE_PORTAL_INVITE_EMAIL.intro_html,
    footer_html:
      typeof o.footer_html === 'string' ? o.footer_html : DEFAULT_CANDIDATE_PORTAL_INVITE_EMAIL.footer_html,
    cta_label:
      typeof o.cta_label === 'string' && o.cta_label.trim()
        ? o.cta_label.trim()
        : DEFAULT_CANDIDATE_PORTAL_INVITE_EMAIL.cta_label,
    include_task_table: o.include_task_table !== false,
    include_login_steps: o.include_login_steps !== false,
    login_steps_html:
      typeof o.login_steps_html === 'string' && o.login_steps_html.trim()
        ? o.login_steps_html
        : null,
  };
}

export async function getCandidatePortalInviteEmailSettings(
  businessId: string,
): Promise<CandidatePortalInviteEmailSettings> {
  const row = await queryOne<{ candidate_portal_invite_email: unknown }>(
    `SELECT candidate_portal_invite_email FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  if (!row?.candidate_portal_invite_email) return { ...DEFAULT_CANDIDATE_PORTAL_INVITE_EMAIL };
  return parseCandidatePortalInviteEmail(row.candidate_portal_invite_email);
}

export async function updateCandidatePortalInviteEmailSettings(
  businessId: string,
  patch: Partial<CandidatePortalInviteEmailSettings>,
): Promise<CandidatePortalInviteEmailSettings> {
  const current = await getCandidatePortalInviteEmailSettings(businessId);
  const merged: CandidatePortalInviteEmailSettings = {
    subject: patch.subject ?? current.subject,
    intro_html: patch.intro_html ?? current.intro_html,
    footer_html: patch.footer_html ?? current.footer_html,
    cta_label: patch.cta_label ?? current.cta_label,
    include_task_table: patch.include_task_table ?? current.include_task_table,
    include_login_steps: patch.include_login_steps ?? current.include_login_steps,
    login_steps_html:
      patch.login_steps_html !== undefined ? patch.login_steps_html : current.login_steps_html,
  };

  const existing = await queryOne(`SELECT business_id FROM business_settings WHERE business_id = $1`, [
    businessId,
  ]);

  if (existing) {
    await query(
      `UPDATE business_settings SET candidate_portal_invite_email = $2::jsonb WHERE business_id = $1`,
      [businessId, JSON.stringify(merged)],
    );
  } else {
    await query(
      `INSERT INTO business_settings (business_id, candidate_portal_invite_email) VALUES ($1, $2::jsonb)`,
      [businessId, JSON.stringify(merged)],
    );
  }

  return merged;
}

export async function resetCandidatePortalInviteEmailSettings(
  businessId: string,
): Promise<CandidatePortalInviteEmailSettings> {
  return updateCandidatePortalInviteEmailSettings(businessId, {
    ...DEFAULT_CANDIDATE_PORTAL_INVITE_EMAIL,
  });
}
