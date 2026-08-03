import { queryOne, queryRows } from '@/lib/db';

export type JourneyStep = {
  key: string;
  label: string;
  state: 'completed' | 'current' | 'upcoming';
  date: string | null;
};

export async function getCandidateJourney(
  candidateId: string,
  businessId: string,
): Promise<JourneyStep[]> {
  const candidate = await queryOne<{
    status: string;
    portal_invited_at: string | null;
    info_collection_completed_at: string | null;
  }>(
    `SELECT status, portal_invited_at, info_collection_completed_at
     FROM recruitment_candidates WHERE id = $1 AND business_id = $2`,
    [candidateId, businessId],
  );

  const offer = await queryOne<{
    status: string;
    sent_at: string | null;
    accepted_at: string | null;
    joining_date: string | null;
  }>(
    `SELECT status, sent_at, accepted_at, joining_date FROM recruitment_offer_letters
     WHERE candidate_id = $1 AND business_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [candidateId, businessId],
  );

  const status = candidate?.status ?? 'applied';
  const invitedDone = Boolean(candidate?.portal_invited_at);
  const infoDone =
    Boolean(candidate?.info_collection_completed_at) ||
    ['info_collection_complete', 'offer_draft', 'offer_sent', 'offer_viewed', 'offer_accepted', 'docs_submitted', 'docs_verified', 'ready_to_join', 'joined'].includes(status);
  const offerReleased = offer && ['sent', 'viewed', 'accepted', 'declined'].includes(offer.status);
  const offerAccepted = offer?.status === 'accepted';
  const joined = status === 'joined';

  const steps: JourneyStep[] = [
    {
      key: 'invited',
      label: 'Invited to candidate portal',
      state: invitedDone ? 'completed' : 'upcoming',
      date: candidate?.portal_invited_at?.slice(0, 10) ?? null,
    },
    {
      key: 'info_collection',
      label: 'Info collection',
      state: infoDone ? 'completed' : invitedDone ? 'current' : 'upcoming',
      date: candidate?.info_collection_completed_at?.slice(0, 10) ?? null,
    },
    {
      key: 'offer_release',
      label: 'Offer release',
      state: offerReleased ? 'completed' : infoDone ? 'current' : 'upcoming',
      date: offer?.sent_at?.slice(0, 10) ?? null,
    },
    {
      key: 'offer_acceptance',
      label: 'Offer acceptance',
      state: offerAccepted ? 'completed' : offerReleased ? 'current' : 'upcoming',
      date: offer?.accepted_at?.slice(0, 10) ?? null,
    },
    {
      key: 'joining',
      label: 'Joining',
      state: joined ? 'completed' : offerAccepted ? 'current' : 'upcoming',
      date: offer?.joining_date?.slice(0, 10) ?? null,
    },
  ];

  return steps;
}

export async function listCandidateTasks(candidateId: string, businessId: string) {
  return queryRows(
    `SELECT id, task_key, name, task_type, status, candidate_self_status,
            due_at, submitted_at, approved_at, is_required, sort_order, instruction_text
     FROM candidate_onboarding_tasks
     WHERE candidate_id = $1 AND business_id = $2
     ORDER BY sort_order, created_at`,
    [candidateId, businessId],
  );
}
