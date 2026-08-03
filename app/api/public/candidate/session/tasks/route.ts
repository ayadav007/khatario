import { NextRequest, NextResponse } from 'next/server';
import { getCandidatePortalSessionFromRequest } from '@/lib/hr/recruitment/candidate-portal-session';
import { listCandidateTasks, getCandidateJourney } from '@/lib/hr/recruitment/onboarding/journey';
import { computeTaskProgress } from '@/lib/hr/recruitment/onboarding/validation';
import { loadTaskBundle } from '@/lib/hr/recruitment/onboarding/task-service';
import { queryRows } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getCandidatePortalSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const [tasks, journey] = await Promise.all([
    listCandidateTasks(session.candidate_id, session.business_id),
    getCandidateJourney(session.candidate_id, session.business_id),
  ]);

  const tasksWithProgress = await Promise.all(
    tasks.map(async (t) => {
      const row = t as { id: string; status: string };
      if (['id_proof_bundle', 'single_identity_doc', 'repeating_file_slots', 'attachments_checklist', 'employment_record'].includes(String((t as { task_type: string }).task_type))) {
        const bundle = await loadTaskBundle(row.id, session.candidate_id, session.business_id);
        return {
          ...t,
          progress: bundle?.progress ?? { complete: 0, required: 1, canSubmit: false },
        };
      }
      return { ...t, progress: { complete: 0, required: 1, canSubmit: false } };
    }),
  );

  const required = tasksWithProgress.filter((t) => (t as { is_required: boolean }).is_required);
  const completeCount = required.filter((t) =>
    ['submitted', 'approved'].includes(String((t as { status: string }).status)),
  ).length;

  return NextResponse.json({
    tasks: tasksWithProgress,
    journey,
    summary: {
      complete: completeCount,
      total: required.length,
    },
  });
}
