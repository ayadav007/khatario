import { queryOne } from '@/lib/db';
import { notifyStoreCustomerWhatsApp } from '@/lib/store/notify-whatsapp';

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
  await notifyStoreCustomerWhatsApp({
    businessId: input.businessId,
    phone,
    text: `New store order ${input.orderNumber} from ${input.customerName}. ₹${total}. Open Store Orders in Khatario to pack and dispatch.`,
  });
}
