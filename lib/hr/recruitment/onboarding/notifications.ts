import { queryOne, queryRows } from '@/lib/db';
import { sendBusinessEmail } from '@/lib/business-email';
import { getBusinessPortalContext } from '@/lib/customer-surface/portal-business';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function getRecruitmentNotifierEmails(businessId: string): Promise<string[]> {
  const rows = await queryRows<{ email: string }>(
    `SELECT DISTINCT u.email
     FROM users u
     LEFT JOIN role_permissions rp ON rp.role_id = u.role_id AND rp.module_key = 'recruitment'
     WHERE u.business_id = $1 AND u.is_active = true AND u.email IS NOT NULL
       AND (u.is_primary_admin = true OR rp.can_modify = true OR rp.can_view = true)`,
    [businessId],
  );
  return rows.map((r) => r.email).filter(Boolean);
}

export async function notifyHrTaskSubmitted(input: {
  businessId: string;
  candidateId: string;
  taskId: string;
  taskName: string;
}): Promise<void> {
  const [candidate, business] = await Promise.all([
    queryOne<{ full_name: string; email: string }>(
      `SELECT full_name, email FROM recruitment_candidates WHERE id = $1 AND business_id = $2`,
      [input.candidateId, input.businessId],
    ),
    getBusinessPortalContext(input.businessId),
  ]);
  if (!candidate || !business) return;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.khatario.com';
  const reviewUrl = `${baseUrl}/employees/recruitment/candidates/${input.candidateId}/tasks/${input.taskId}`;

  const recipients = await getRecruitmentNotifierEmails(input.businessId);
  if (recipients.length === 0) return;

  const subject = `Onboarding task submitted — ${candidate.full_name}`;
  const html = `<p><strong>${escapeHtml(candidate.full_name)}</strong> (${escapeHtml(candidate.email)}) submitted:</p>
    <p><strong>${escapeHtml(input.taskName)}</strong></p>
    <p><a href="${reviewUrl}">Review task</a></p>`;
  const text = `${candidate.full_name} submitted "${input.taskName}". Review: ${reviewUrl}`;

  for (const to of recipients) {
    await sendBusinessEmail(input.businessId, { to, subject, html, text }).catch(() => {});
  }
}

export async function notifyCandidateChangesRequested(input: {
  businessId: string;
  candidateId: string;
  taskName: string;
  notes?: string | null;
}): Promise<void> {
  const [candidate, business] = await Promise.all([
    queryOne<{ full_name: string; email: string }>(
      `SELECT full_name, email FROM recruitment_candidates WHERE id = $1 AND business_id = $2`,
      [input.candidateId, input.businessId],
    ),
    getBusinessPortalContext(input.businessId),
  ]);
  if (!candidate?.email || !business?.portal_slug) return;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.khatario.com';
  const portalUrl = `${baseUrl}/${business.portal_slug}/candidates`;

  const subject = `Changes requested — ${input.taskName}`;
  const noteBlock = input.notes?.trim()
    ? `<p><strong>HR note:</strong> ${escapeHtml(input.notes.trim())}</p>`
    : '';
  const html = `<p>Hello ${escapeHtml(candidate.full_name)},</p>
    <p>Please update and resubmit: <strong>${escapeHtml(input.taskName)}</strong></p>
    ${noteBlock}
    <p><a href="${portalUrl}">Open candidate portal</a></p>`;
  const text = `Please update "${input.taskName}" in the candidate portal. ${input.notes ?? ''} ${portalUrl}`;

  await sendBusinessEmail(input.businessId, {
    to: candidate.email,
    subject,
    html,
    text,
  }).catch(() => {});
}

export async function notifyCandidateAllTasksApproved(input: {
  businessId: string;
  candidateId: string;
}): Promise<void> {
  const [candidate, business] = await Promise.all([
    queryOne<{ full_name: string; email: string }>(
      `SELECT full_name, email FROM recruitment_candidates WHERE id = $1 AND business_id = $2`,
      [input.candidateId, input.businessId],
    ),
    getBusinessPortalContext(input.businessId),
  ]);
  if (!candidate?.email || !business?.portal_slug) return;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.khatario.com';
  const portalUrl = `${baseUrl}/${business.portal_slug}/candidates`;

  await sendBusinessEmail(input.businessId, {
    to: candidate.email,
    subject: `Information verified — ${business.name}`,
    html: `<p>Hello ${escapeHtml(candidate.full_name)},</p>
      <p>Your submitted information has been verified. Your offer letter will be shared soon.</p>
      <p><a href="${portalUrl}">Open candidate portal</a></p>`,
    text: `Your information has been verified. Check the portal: ${portalUrl}`,
  }).catch(() => {});
}
