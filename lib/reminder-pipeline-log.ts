/**
 * Step-by-step logging for todo reminder → notification → SSE → popup.
 * Filter: ReminderPipeline
 *
 * - Development: always on
 * - Production: set REMINDER_PIPELINE_LOG=1 (server/worker) or
 *   NEXT_PUBLIC_REMINDER_PIPELINE_LOG=1 (browser) to enable
 */
export function reminderPipelineLog(
  step: string,
  data?: Record<string, unknown>
): void {
  const force =
    process.env.REMINDER_PIPELINE_LOG === '1' ||
    process.env.NEXT_PUBLIC_REMINDER_PIPELINE_LOG === '1';
  const isDev = process.env.NODE_ENV !== 'production';
  if (!isDev && !force) return;

  if (data && Object.keys(data).length > 0) {
    console.log('[ReminderPipeline]', step, data);
  } else {
    console.log('[ReminderPipeline]', step);
  }
}
