import { query, queryOne, queryRows } from '@/lib/db';
import { getHrApprovalSettings } from '@/lib/hr/hr-approval-settings';
import { sendBusinessEmail } from '@/lib/business-email';

export type OfferApproverInput = {
  level: number;
  label?: string;
  user_id: string;
};

export type OfferApprovalRow = {
  id: string;
  offer_id: string;
  approval_level: number;
  level_label: string | null;
  approver_user_id: string;
  approver_name?: string;
  status: string;
  comments: string | null;
  decided_at: string | null;
};

function validateApproverList(
  approvers: OfferApproverInput[],
  minLevels: number,
  maxLevels: number | null,
): string | null {
  if (!Array.isArray(approvers) || approvers.length === 0) {
    return 'At least one approver is required';
  }
  if (approvers.length < minLevels) {
    return `This business requires at least ${minLevels} approval level(s)`;
  }
  if (maxLevels != null && approvers.length > maxLevels) {
    return `This business allows at most ${maxLevels} approval level(s)`;
  }

  const levels = approvers.map((a) => Number(a.level)).sort((a, b) => a - b);
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] !== i + 1) {
      return 'Approval levels must be sequential starting from 1';
    }
  }

  const userIds = approvers.map((a) => String(a.user_id).trim());
  if (userIds.some((id) => !id)) return 'Each approver must have a user';
  if (new Set(userIds).size !== userIds.length) return 'Duplicate approvers are not allowed';

  return null;
}

export async function listOfferApprovals(offerId: string): Promise<OfferApprovalRow[]> {
  return queryRows<OfferApprovalRow>(
    `SELECT a.*, u.name AS approver_name
     FROM recruitment_offer_approvals a
     INNER JOIN users u ON u.id = a.approver_user_id
     WHERE a.offer_id = $1
     ORDER BY a.approval_level ASC`,
    [offerId],
  );
}

export async function getActiveApprovalLevel(offerId: string): Promise<number | null> {
  const row = await queryOne<{ approval_level: number }>(
    `SELECT approval_level FROM recruitment_offer_approvals
     WHERE offer_id = $1 AND status = 'pending'
     ORDER BY approval_level ASC LIMIT 1`,
    [offerId],
  );
  return row?.approval_level ?? null;
}

export async function submitOfferForApproval(input: {
  businessId: string;
  offerId: string;
  candidateId: string;
  submittedByUserId: string;
  approvers: OfferApproverInput[];
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const offer = await queryOne<{ id: string; status: string }>(
    `SELECT id, status FROM recruitment_offer_letters
     WHERE id = $1 AND business_id = $2 AND candidate_id = $3`,
    [input.offerId, input.businessId, input.candidateId],
  );
  if (!offer) return { ok: false, message: 'Offer not found' };
  if (!['draft', 'approval_rejected'].includes(offer.status)) {
    return { ok: false, message: 'Only draft or rejected offers can be submitted for approval' };
  }

  const settings = await getHrApprovalSettings(input.businessId);
  const validationError = validateApproverList(
    input.approvers,
    settings.offer_min_levels,
    settings.offer_max_levels,
  );
  if (validationError) return { ok: false, message: validationError };

  const userCheck = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM users
     WHERE business_id = $1 AND is_active = true AND id = ANY($2::uuid[])`,
    [input.businessId, input.approvers.map((a) => a.user_id)],
  );
  if (Number(userCheck?.count ?? 0) !== input.approvers.length) {
    return { ok: false, message: 'One or more selected approvers are invalid' };
  }

  await query(`DELETE FROM recruitment_offer_approvals WHERE offer_id = $1`, [input.offerId]);

  for (const approver of input.approvers) {
    await query(
      `INSERT INTO recruitment_offer_approvals (
        offer_id, business_id, approval_level, level_label, approver_user_id, status
      ) VALUES ($1,$2,$3,$4,$5,'pending')`,
      [
        input.offerId,
        input.businessId,
        approver.level,
        approver.label?.trim() || null,
        approver.user_id,
      ],
    );
  }

  await query(
    `UPDATE recruitment_offer_letters
     SET status = 'pending_approval',
         submitted_for_approval_at = CURRENT_TIMESTAMP,
         internally_approved_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [input.offerId],
  );

  const first = input.approvers.find((a) => a.level === 1);
  if (first) {
    await notifyApprover(input.businessId, input.offerId, input.candidateId, first.user_id);
  }

  return { ok: true };
}

async function notifyApprover(
  businessId: string,
  offerId: string,
  candidateId: string,
  approverUserId: string,
) {
  const ctx = await queryOne<{
    approver_email: string;
    candidate_name: string;
    designation: string;
    business_name: string;
  }>(
    `SELECT u.email AS approver_email, c.full_name AS candidate_name, o.designation, b.name AS business_name
     FROM recruitment_offer_letters o
     INNER JOIN recruitment_candidates c ON c.id = o.candidate_id
     INNER JOIN businesses b ON b.id = o.business_id
     INNER JOIN users u ON u.id = $4
     WHERE o.id = $1 AND o.business_id = $2 AND c.id = $3`,
    [offerId, businessId, candidateId, approverUserId],
  );
  if (!ctx?.approver_email) return;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.khatario.com';
  const reviewUrl = `${baseUrl}/employees/recruitment/candidates/${candidateId}`;

  await sendBusinessEmail(businessId, {
    to: ctx.approver_email,
    subject: `Offer approval needed: ${ctx.candidate_name}`,
    html: `<p>An offer letter for <strong>${ctx.candidate_name}</strong> (${ctx.designation}) needs your approval.</p>
      <p><a href="${reviewUrl}">Review offer</a></p>`,
    text: `Offer approval needed for ${ctx.candidate_name}. Review at ${reviewUrl}`,
  });
}

export async function decideOfferApproval(input: {
  businessId: string;
  offerId: string;
  candidateId: string;
  approverUserId: string;
  action: 'approve' | 'reject';
  comments?: string;
}): Promise<{ ok: true; offer_status: string } | { ok: false; message: string }> {
  const offer = await queryOne<{ id: string; status: string }>(
    `SELECT id, status FROM recruitment_offer_letters
     WHERE id = $1 AND business_id = $2 AND candidate_id = $3`,
    [input.offerId, input.businessId, input.candidateId],
  );
  if (!offer) return { ok: false, message: 'Offer not found' };
  if (offer.status !== 'pending_approval') {
    return { ok: false, message: 'Offer is not pending approval' };
  }

  const activeLevel = await getActiveApprovalLevel(input.offerId);
  if (activeLevel == null) {
    return { ok: false, message: 'No pending approval step found' };
  }

  const step = await queryOne<{ id: string }>(
    `SELECT id FROM recruitment_offer_approvals
     WHERE offer_id = $1 AND approval_level = $2 AND approver_user_id = $3 AND status = 'pending'`,
    [input.offerId, activeLevel, input.approverUserId],
  );
  if (!step) {
    return { ok: false, message: 'You are not the approver for the current step' };
  }

  if (input.action === 'reject') {
    await query(
      `UPDATE recruitment_offer_approvals
       SET status = 'rejected', comments = $1, decided_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [input.comments?.trim() || null, step.id],
    );
    await query(
      `UPDATE recruitment_offer_letters
       SET status = 'approval_rejected', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [input.offerId],
    );
    return { ok: true, offer_status: 'approval_rejected' };
  }

  await query(
    `UPDATE recruitment_offer_approvals
     SET status = 'approved', comments = $1, decided_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [input.comments?.trim() || null, step.id],
  );

  const nextPending = await queryOne<{ approval_level: number; approver_user_id: string }>(
    `SELECT approval_level, approver_user_id FROM recruitment_offer_approvals
     WHERE offer_id = $1 AND status = 'pending'
     ORDER BY approval_level ASC LIMIT 1`,
    [input.offerId],
  );

  if (nextPending) {
    await notifyApprover(
      input.businessId,
      input.offerId,
      input.candidateId,
      nextPending.approver_user_id,
    );
    return { ok: true, offer_status: 'pending_approval' };
  }

  await query(
    `UPDATE recruitment_offer_letters
     SET status = 'approved',
         internally_approved_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [input.offerId],
  );

  return { ok: true, offer_status: 'approved' };
}

export async function resetOfferToDraft(offerId: string, businessId: string): Promise<void> {
  await query(`DELETE FROM recruitment_offer_approvals WHERE offer_id = $1`, [offerId]);
  await query(
    `UPDATE recruitment_offer_letters
     SET status = 'draft',
         submitted_for_approval_at = NULL,
         internally_approved_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2 AND status = 'approval_rejected'`,
    [offerId, businessId],
  );
}

export async function listPendingOfferApprovalsForUser(
  businessId: string,
  userId: string,
): Promise<
  {
    offer_id: string;
    candidate_id: string;
    candidate_name: string;
    designation: string;
    approval_level: number;
    level_label: string | null;
    submitted_for_approval_at: string | null;
  }[]
> {
  return queryRows(
    `SELECT o.id AS offer_id, c.id AS candidate_id, c.full_name AS candidate_name,
            o.designation, a.approval_level, a.level_label, o.submitted_for_approval_at
     FROM recruitment_offer_approvals a
     INNER JOIN recruitment_offer_letters o ON o.id = a.offer_id
     INNER JOIN recruitment_candidates c ON c.id = o.candidate_id
     WHERE a.business_id = $1
       AND a.approver_user_id = $2
       AND a.status = 'pending'
       AND o.status = 'pending_approval'
       AND a.approval_level = (
         SELECT MIN(a2.approval_level) FROM recruitment_offer_approvals a2
         WHERE a2.offer_id = o.id AND a2.status = 'pending'
       )
     ORDER BY o.submitted_for_approval_at ASC NULLS LAST`,
    [businessId, userId],
  );
}
