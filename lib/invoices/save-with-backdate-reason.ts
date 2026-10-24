/**
 * POST /api/invoices; if the server asks for a back-date reason, prompt the user and retry once.
 * Returns the last response (unread) so callers keep their existing error handling.
 */
export async function postInvoiceWithBackdateReason(
  payload: Record<string, unknown>,
  init: Omit<RequestInit, 'method' | 'body'> = {}
): Promise<Response> {
  const send = (body: Record<string, unknown>) =>
    fetch('/api/invoices', {
      ...init,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      body: JSON.stringify(body),
    });

  const res = await send(payload);
  if (res.status !== 422 || typeof window === 'undefined') return res;

  const data = await res.clone().json().catch(() => null);
  if (data?.code !== 'BACKDATE_REASON_REQUIRED') return res;

  const reason = window.prompt(`${data.error}\n\nReason for back-dating:`, '');
  if (!reason || reason.trim().length < 5) return res;

  return send({ ...payload, backdate_reason: reason.trim() });
}
