import { query, queryOne, queryRows } from '@/lib/db';
import { sendBusinessEmail } from '@/lib/business-email';
import { assignOnboardingTasksToCandidate } from '@/lib/hr/recruitment/onboarding/task-service';
import { getCandidatePortalInviteEmailSettings } from '@/lib/hr/recruitment/onboarding/invite-email-settings';
import { buildCandidatePortalInviteEmail } from '@/lib/hr/recruitment/onboarding/invite-email';
import { getBusinessPortalContext } from '@/lib/customer-surface/portal-business';

export type SendPortalInviteParams = {
  businessId: string;
  candidateId: string;
  templateIds?: string[];
};

export type SendPortalInviteResult = {
  portal_url: string;
  tasks_assigned: number;
  tasks_in_email: number;
};

export async function sendCandidatePortalInvite(
  params: SendPortalInviteParams,
): Promise<SendPortalInviteResult> {
  const candidate = await queryOne<{ id: string; email: string; full_name: string; status: string }>(
    `SELECT id, email, full_name, status FROM recruitment_candidates
     WHERE id = $1 AND business_id = $2`,
    [params.candidateId, params.businessId],
  );
  if (!candidate) throw new Error('Candidate not found');

  if (['rejected', 'withdrawn', 'joined'].includes(candidate.status)) {
    throw new Error('Cannot invite this candidate');
  }

  const business = await getBusinessPortalContext(params.businessId);
  if (!business?.portal_slug) {
    throw new Error('Business portal slug is not configured');
  }

  const templateIds = params.templateIds;
  if (templateIds && templateIds.length === 0) {
    throw new Error('Select at least one task to assign');
  }

  const invitedAt = new Date();
  await query(
    `UPDATE recruitment_candidates
     SET status = 'portal_invited', portal_invited_at = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2`,
    [params.candidateId, params.businessId, invitedAt.toISOString()],
  );

  const assignment = await assignOnboardingTasksToCandidate(
    params.businessId,
    params.candidateId,
    invitedAt,
    templateIds ? { templateIds } : undefined,
  );

  const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://staging.khatario.com'}/${business.portal_slug}/candidates`;

  const emailTasks = await queryRows<{ name: string; due_at: string | null }>(
    templateIds && templateIds.length > 0
      ? `SELECT name, due_at FROM candidate_onboarding_tasks
         WHERE candidate_id = $1 AND business_id = $2 AND template_id = ANY($3::uuid[])
         ORDER BY sort_order, created_at`
      : `SELECT name, due_at FROM candidate_onboarding_tasks
         WHERE candidate_id = $1 AND business_id = $2
         ORDER BY sort_order, created_at`,
    templateIds && templateIds.length > 0
      ? [params.candidateId, params.businessId, templateIds]
      : [params.candidateId, params.businessId],
  );

  if (emailTasks.length === 0) {
    throw new Error('No tasks to include in the invite. Configure active onboarding templates first.');
  }

  const emailSettings = await getCandidatePortalInviteEmailSettings(params.businessId);
  const email = buildCandidatePortalInviteEmail({
    settings: emailSettings,
    candidateName: candidate.full_name,
    businessName: business.name,
    portalUrl,
    tasks: emailTasks,
  });

  await sendBusinessEmail(params.businessId, {
    to: candidate.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  return {
    portal_url: portalUrl,
    tasks_assigned: assignment.count,
    tasks_in_email: emailTasks.length,
  };
}

/** Fire-and-forget helper when hiring settings enable auto-invite on offer acceptance. */
export async function maybeAutoSendOnboardingInvite(
  businessId: string,
  candidateId: string,
): Promise<void> {
  const { getHrHiringSettings } = await import('@/lib/hr/hr-hiring-settings');
  const settings = await getHrHiringSettings(businessId);
  if (!settings.auto_send_onboarding_invite) return;

  const candidate = await queryOne<{ status: string }>(
    `SELECT status FROM recruitment_candidates WHERE id = $1 AND business_id = $2`,
    [candidateId, businessId],
  );
  if (!candidate || candidate.status !== 'offer_accepted') return;

  try {
    await sendCandidatePortalInvite({ businessId, candidateId });
  } catch (error) {
    console.error('[maybeAutoSendOnboardingInvite]', error);
  }
}
