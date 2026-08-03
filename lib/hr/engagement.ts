import { queryRows, queryOne } from '@/lib/db';

export type { EngagementAudience } from '@/lib/hr/engagement-audience';
export { parseAudience, buildEngagementPayload } from '@/lib/hr/engagement-audience';

function audienceSql(alias: string, employeeIdParam: string, departmentParam: string) {
  return `(
    ${alias}.audience->>'type' = 'all'
    OR (${alias}.audience->>'type' = 'departments' AND ${departmentParam} = ANY(
      SELECT jsonb_array_elements_text(${alias}.audience->'departments')
    ))
    OR (${alias}.audience->>'type' = 'employees' AND ${employeeIdParam} = ANY(
      SELECT jsonb_array_elements_text(${alias}.audience->'employee_ids')
    ))
  )`;
}

export async function fetchActiveAnnouncements(
  businessId: string,
  opts?: { employeeId?: string; department?: string | null; limit?: number },
) {
  const limit = opts?.limit ?? 20;
  const empId = opts?.employeeId ?? '';
  const dept = opts?.department ?? '';

  return queryRows(
    `SELECT id, title, body, author_name, published_at::text, attachment_url
     FROM hr_announcements
     WHERE business_id = $1
       AND is_active = true
       AND archived_at IS NULL
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       AND ${audienceSql('hr_announcements', '$2', '$3')}
     ORDER BY published_at DESC
     LIMIT $4`,
    [businessId, empId, dept, limit],
  );
}

export async function fetchPublishedArticles(businessId: string, limit = 20) {
  return queryRows(
    `SELECT id, title, body_html, author_name, published_at::text
     FROM hr_engagement_articles
     WHERE business_id = $1
       AND is_published = true
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
     ORDER BY published_at DESC
     LIMIT $2`,
    [businessId, limit],
  );
}

export async function fetchActivePollsForEmployee(
  businessId: string,
  employeeId: string,
  department: string | null,
) {
  const polls = await queryRows<{
    id: string;
    question: string;
    attachment_url: string | null;
    expires_at: string | null;
    allow_multiple: boolean;
  }>(
    `SELECT id, question, attachment_url, expires_at::text, allow_multiple
     FROM hr_engagement_polls
     WHERE business_id = $1
       AND is_active = true
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       AND ${audienceSql('hr_engagement_polls', '$2', '$3')}
     ORDER BY created_at DESC
     LIMIT 20`,
    [businessId, employeeId, department ?? ''],
  );

  const result = [];
  for (const poll of polls) {
    const options = await queryRows<{ id: string; option_text: string; vote_count: string }>(
      `SELECT o.id, o.option_text,
              COUNT(v.id)::text AS vote_count
       FROM hr_engagement_poll_options o
       LEFT JOIN hr_engagement_poll_votes v ON v.option_id = o.id
       WHERE o.poll_id = $1
       GROUP BY o.id, o.option_text, o.sort_order
       ORDER BY o.sort_order`,
      [poll.id],
    );
    const myVotes = await queryRows<{ option_id: string }>(
      `SELECT option_id FROM hr_engagement_poll_votes WHERE poll_id = $1 AND employee_id = $2`,
      [poll.id, employeeId],
    );
    result.push({
      ...poll,
      options: options.map((o) => ({ id: o.id, text: o.option_text, votes: parseInt(o.vote_count, 10) })),
      my_votes: myVotes.map((v) => v.option_id),
    });
  }
  return result;
}

export async function castPollVote(
  pollId: string,
  employeeId: string,
  optionIds: string[],
): Promise<void> {
  const poll = await queryOne<{ allow_multiple: boolean; business_id: string }>(
    `SELECT allow_multiple, business_id FROM hr_engagement_polls WHERE id = $1 AND is_active = true`,
    [pollId],
  );
  if (!poll) throw new Error('Poll not found');

  if (!poll.allow_multiple && optionIds.length > 1) {
    throw new Error('This poll allows only one choice');
  }

  await queryOne(`DELETE FROM hr_engagement_poll_votes WHERE poll_id = $1 AND employee_id = $2`, [
    pollId,
    employeeId,
  ]);

  for (const optionId of optionIds) {
    await queryOne(
      `INSERT INTO hr_engagement_poll_votes (poll_id, option_id, employee_id)
       SELECT $1, $2, $3
       WHERE EXISTS (SELECT 1 FROM hr_engagement_poll_options WHERE id = $2 AND poll_id = $1)
       ON CONFLICT DO NOTHING`,
      [pollId, optionId, employeeId],
    );
  }
}
