/**
 * Single-line JSON logs: grep `kind":"todo_reminder"`.
 * - `processed` / `skipped` / `failed`: per-item (worker) or per-error row (cron/check).
 * - `summary`: batch totals (processed / skipped / failed counts).
 */
export function logTodoReminder(
  scope: 'worker' | 'cron' | 'check_reminders',
  event: 'processed' | 'skipped' | 'failed' | 'summary',
  fields: Record<string, unknown> = {}
): void {
  console.log(
    JSON.stringify({
      scope,
      event,
      kind: 'todo_reminder',
      ...fields,
      ts: new Date().toISOString(),
    })
  );
}
