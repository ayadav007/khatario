/**
 * Wording for a lead's stage_changed timeline events (written by lib/leads/core.ts). No imports, so
 * the chat timeline route and tests can use it without loading the database.
 */

/** One line for a stage_changed event: a won invoice, a went-quiet close, or a move and who made it. */
export function describeStageEvent(eventData: Record<string, unknown>): string {
  if (eventData.reference) return `Won: ${eventData.reference}`;
  if (eventData.reason === 'went_quiet') {
    const days = typeof eventData.quiet_days === 'number' ? eventData.quiet_days : 30;
    return `Closed as lost: went quiet (no messages for ${days} days)`;
  }
  const by =
    eventData.source === 'ai'
      ? ' by the AI agent'
      : eventData.source === 'flow'
        ? ' by a flow'
        : eventData.source === 'auto'
          ? ' automatically (new lead)'
          : eventData.actor_name
            ? ` by ${eventData.actor_name}`
            : '';
  return eventData.to_stage
    ? `Moved to ${eventData.to_stage}${eventData.from_stage ? ` from ${eventData.from_stage}` : ''}${by}`
    : `Taken off the pipeline${by}`;
}
