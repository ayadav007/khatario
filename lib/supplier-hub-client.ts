/** Browser helpers for Supplier Hub screens. */

/** The signed-in supplier's customer record for a connected buyer business (linked, never by name). */
export async function linkedCustomerId(buyerBusinessId: string): Promise<string> {
  const res = await fetch('/api/suppliers/hub/linked-customer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyer_business_id: buyerBusinessId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.customer_id) {
    throw new Error(data.error || 'Could not find the customer record for this buyer');
  }
  return String(data.customer_id);
}
