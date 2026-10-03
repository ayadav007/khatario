import { query, queryOne } from '@/lib/db';
import { notifyBusinessEvent } from '@/lib/whatsapp/tenant-send';

/** Ping the shop owner when a storefront order lands. */
export async function notifyStoreMerchantNewOrder(input: {
  businessId: string;
  orderNumber: string;
  grandTotal: number;
  customerName: string;
}): Promise<void> {
  const biz = await queryOne<{ phone: string | null; name: string }>(
    `SELECT phone, name FROM businesses WHERE id = $1`,
    [input.businessId],
  );
  const phone = biz?.phone;
  if (!phone) return;
  const total = input.grandTotal.toLocaleString('en-IN');
  await notifyBusinessEvent({
    businessId: input.businessId,
    eventKey: 'merchant_new_order',
    to: phone,
    values: { order_number: input.orderNumber, customer_name: input.customerName, total },
    fallbackText: `New store order ${input.orderNumber} from ${input.customerName}. ₹${total}. Open Store Orders in Khatario to pack and dispatch.`,
  });
}

/** In-app notification plus WhatsApp to the shop phone for a contact-form message. */
export async function notifyStoreMerchantEnquiry(input: {
  businessId: string;
  enquiryId: string;
  name: string;
  phone: string | null;
  email: string | null;
  topic?: string | null;
  message: string;
}): Promise<void> {
  const body = input.message.length > 140 ? `${input.message.slice(0, 137)}...` : input.message;
  const preview = input.topic ? `[${input.topic}] ${body}` : body;
  const reach = input.phone ?? input.email ?? '';

  await query(
    `INSERT INTO notifications (business_id, type, title, message, reference_type, reference_id, created_at)
     VALUES ($1, 'store_enquiry', $2, $3, 'store_enquiry', $4, CURRENT_TIMESTAMP)`,
    [input.businessId, `Store enquiry from ${input.name}`, `${preview}${reach ? ` (${reach})` : ''}`, input.enquiryId],
  ).catch((err) => console.error('[store-enquiry] notification insert failed', err));

  const biz = await queryOne<{ phone: string | null }>(
    `SELECT phone FROM businesses WHERE id = $1`,
    [input.businessId],
  );
  if (!biz?.phone) return;
  await notifyBusinessEvent({
    businessId: input.businessId,
    eventKey: 'merchant_new_enquiry',
    to: biz.phone,
    // Template parameters can't contain newlines.
    values: { customer_name: input.name, contact: reach || '-', preview: preview.replace(/\s+/g, ' ') },
    fallbackText: `New store enquiry from ${input.name}${reach ? ` (${reach})` : ''}: "${preview}". Open Store Enquiries in Khatario to reply.`,
  });
}
