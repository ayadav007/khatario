/**
 * Converting a lead to a customer: finding the customer a lead's phone belongs to and linking the two.
 * Creating the customer is the existing POST /api/customers; winning the lead when an invoice or sales
 * order follows is the leads_auto_won trigger (migration 447), not code here.
 */
import { query, queryOne } from '@/lib/db';
import { broadcastOwnership, type InboxViewer } from '@/lib/whatsapp/inbox-ownership';
import { LeadError, loadLead, type Lead } from './core';
import { canViewLead } from './visibility';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Customers are stored with spaces, dashes and a leading 0 or +91, so phones match on their last 10 digits. */
const PHONE_TAIL = (column: string) => `RIGHT(regexp_replace(${column}, '\\D', '', 'g'), 10)`;

/** The business's newest live customer whose phone ends in the lead's last 10 digits, or null. */
export async function findCustomerForLead(businessId: string, leadId: string): Promise<{ id: string; name: string } | null> {
  if (!UUID_RE.test(leadId)) return null;
  return queryOne<{ id: string; name: string }>(
    `SELECT c.id::text AS id, c.name
       FROM leads l
       JOIN customers c ON c.business_id = l.business_id
                       AND c.deleted_at IS NULL
                       AND COALESCE(c.is_active, true)
                       AND ${PHONE_TAIL('c.phone')} = RIGHT(regexp_replace(l.contact_phone, '\\D', '', 'g'), 10)
      WHERE l.id = $1::uuid AND l.business_id = $2
        AND LENGTH(regexp_replace(c.phone, '\\D', '', 'g')) >= 10
      ORDER BY c.created_at DESC NULLS LAST, c.id
      LIMIT 1`,
    [leadId, businessId],
  );
}

/**
 * Links a lead to one of the business's customers (and the lead's chat, when it has none). `lead_type`
 * stays as it was when the lead opened.
 */
export async function linkLeadToCustomer(viewer: InboxViewer, leadId: string, customerId: string): Promise<Lead> {
  const { businessId } = viewer;
  if (!(await canViewLead(viewer, leadId))) throw new LeadError('Lead not found', 404, 'NOT_FOUND');
  const customer = UUID_RE.test(customerId)
    ? await queryOne<{ id: string }>(
        `SELECT id::text AS id FROM customers WHERE id = $1::uuid AND business_id = $2 AND deleted_at IS NULL AND COALESCE(is_active, true)`,
        [customerId, businessId],
      )
    : null;
  if (!customer) throw new LeadError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');

  const updated = await queryOne<{ conversation_id: string | null }>(
    `UPDATE leads SET customer_id = $3::uuid WHERE id = $1::uuid AND business_id = $2 RETURNING conversation_id::text AS conversation_id`,
    [leadId, businessId, customer.id],
  );
  if (!updated) throw new LeadError('Lead not found', 404, 'NOT_FOUND');
  if (updated.conversation_id) {
    await query(
      `UPDATE whatsapp_conversations SET customer_id = $3::uuid WHERE id = $1::uuid AND business_id = $2 AND customer_id IS NULL`,
      [updated.conversation_id, businessId, customer.id],
    );
    await broadcastOwnership(businessId, updated.conversation_id);
  }
  return (await loadLead(businessId, leadId))!;
}
