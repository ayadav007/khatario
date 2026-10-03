/**
 * Khatario message events a business can attach one of its own Meta templates to.
 * Client-safe: no server imports.
 */

export type TemplateCategory = 'AUTHENTICATION' | 'UTILITY' | 'MARKETING';

export const TENANT_WA_EVENT_KEYS = [
  'store_otp',
  'store_order_placed',
  'store_order_paid',
  'store_order_shipped',
  'order_confirmed',
  'order_packed',
  'order_ready_for_pickup',
  'order_shipped',
  'order_out_for_delivery',
  'order_delivered',
  'order_delivery_failed',
  'order_cancelled',
  'merchant_new_order',
  'merchant_dispatch_overdue',
  'merchant_new_enquiry',
  'invoice_sent',
  'payment_due_reminder',
  'payment_overdue_reminder',
] as const;

export type TenantWaEventKey = (typeof TENANT_WA_EVENT_KEYS)[number];

export const TENANT_WA_FIELDS = {
  code: { label: 'Verification code', sample: '482913' },
  customer_name: { label: 'Customer name', sample: 'Priya' },
  order_number: { label: 'Order number', sample: 'SO-1042' },
  store_name: { label: 'Store name', sample: 'Sharma Fresh' },
  total: { label: 'Order total', sample: '1,250.00' },
  payment_mode: { label: 'Payment mode', sample: 'Pay on delivery' },
  awb: { label: 'AWB / tracking number', sample: '1490823345' },
  tracking_url: { label: 'Tracking link', sample: 'https://track.example.com/1490823345' },
  contact: { label: 'Customer contact', sample: '98765 43210' },
  preview: { label: 'Enquiry text', sample: 'Do you deliver to Baner?' },
  business_name: { label: 'Business name', sample: 'Sharma Traders' },
  invoice_number: { label: 'Invoice number', sample: 'INV-2026-118' },
  amount: { label: 'Invoice amount', sample: '8,400.00' },
  amount_due: { label: 'Amount due', sample: '3,400.00' },
  due_date: { label: 'Due date', sample: '15 Oct 2026' },
  invoice_link: { label: 'Invoice link', sample: 'https://khatario.com/i/abc123' },
  order_link: { label: 'Order status link', sample: 'https://khatario.com/track/Xy12Ab34' },
  courier: { label: 'Courier or delivery partner', sample: 'Delhivery' },
  rider_name: { label: 'Rider name', sample: 'Ramesh' },
  rider_phone: { label: 'Rider phone', sample: '98765 43210' },
  pickup_code: { label: 'Pickup code', sample: '4821' },
  shop_address: { label: 'Shop address', sample: 'Shop 4, MG Road, Pune' },
  reason: { label: 'Reason', sample: 'Door locked, we will try again tomorrow' },
  refund_note: { label: 'Refund details', sample: 'Your refund of ₹1,250 will reach you in 5-7 working days.' },
  count: { label: 'Number of orders', sample: '3' },
} as const;

export type TenantWaFieldKey = keyof typeof TENANT_WA_FIELDS;

export type TenantWaEventGroup = 'store' | 'delivery' | 'merchant' | 'billing';

export interface TenantWaEvent {
  key: TenantWaEventKey;
  group: TenantWaEventGroup;
  label: string;
  description: string;
  recipient: 'customer' | 'merchant';
  categories: TemplateCategory[];
  fields: TenantWaFieldKey[];
  /** One-click template; body uses {{n}} in the order of variableMap. */
  suggested: {
    name: string;
    category: TemplateCategory;
    body: string;
    footer?: string;
    variableMap: TenantWaFieldKey[];
  };
}

const STORE_ORDER_FIELDS: TenantWaFieldKey[] = [
  'customer_name',
  'order_number',
  'store_name',
  'total',
  'payment_mode',
  'awb',
  'tracking_url',
];
const DELIVERY_FIELDS: TenantWaFieldKey[] = [
  'customer_name',
  'order_number',
  'business_name',
  'total',
  'order_link',
  'courier',
  'awb',
  'tracking_url',
  'rider_name',
  'rider_phone',
  'pickup_code',
  'shop_address',
  'reason',
  'invoice_link',
  'refund_note',
];

function deliveryEvent(
  key: TenantWaEventKey,
  label: string,
  description: string,
  name: string,
  body: string,
  variableMap: TenantWaFieldKey[],
): TenantWaEvent {
  return {
    key,
    group: 'delivery',
    label,
    description,
    recipient: 'customer',
    categories: ['UTILITY'],
    fields: DELIVERY_FIELDS,
    suggested: { name, category: 'UTILITY', body, variableMap },
  };
}

const BILLING_FIELDS: TenantWaFieldKey[] = [
  'customer_name',
  'business_name',
  'invoice_number',
  'amount',
  'amount_due',
  'due_date',
  'invoice_link',
];

export const TENANT_WA_EVENTS: TenantWaEvent[] = [
  {
    key: 'store_otp',
    group: 'store',
    label: 'Checkout verification code',
    description: 'Sent when a shopper verifies their number at checkout.',
    recipient: 'customer',
    categories: ['AUTHENTICATION'],
    fields: ['code'],
    suggested: { name: 'store_login_code', category: 'AUTHENTICATION', body: '', variableMap: ['code'] },
  },
  {
    key: 'store_order_placed',
    group: 'store',
    label: 'Order placed',
    description: 'Sent to the shopper when a pay-on-delivery order is placed.',
    recipient: 'customer',
    categories: ['UTILITY'],
    fields: STORE_ORDER_FIELDS,
    suggested: {
      name: 'khatario_order_placed',
      category: 'UTILITY',
      body: 'Hi {{1}}, your order {{2}} at {{3}} is placed. Total ₹{{4}}, payment: {{5}}. We will update you when it ships.',
      variableMap: ['customer_name', 'order_number', 'store_name', 'total', 'payment_mode'],
    },
  },
  {
    key: 'store_order_paid',
    group: 'store',
    label: 'Order paid',
    description: 'Sent to the shopper when an online payment succeeds.',
    recipient: 'customer',
    categories: ['UTILITY'],
    fields: STORE_ORDER_FIELDS,
    suggested: {
      name: 'khatario_order_paid',
      category: 'UTILITY',
      body: 'Hi {{1}}, we have received your payment for order {{2}} at {{3}}. Total paid ₹{{4}}. Thank you for shopping with us.',
      variableMap: ['customer_name', 'order_number', 'store_name', 'total'],
    },
  },
  {
    key: 'store_order_shipped',
    group: 'store',
    label: 'Order shipped',
    description: 'Sent to the shopper when a shipment is booked.',
    recipient: 'customer',
    categories: ['UTILITY'],
    fields: STORE_ORDER_FIELDS,
    suggested: {
      name: 'khatario_order_shipped',
      category: 'UTILITY',
      body: 'Hi {{1}}, your order {{2}} has shipped. Tracking number {{3}}. Track it here: {{4}} Thank you.',
      variableMap: ['customer_name', 'order_number', 'awb', 'tracking_url'],
    },
  },
  deliveryEvent(
    'order_confirmed',
    'Order confirmed',
    'Sent when you confirm an order from any channel.',
    'khatario_order_confirmed',
    'Hi {{1}}, your order {{2}} with {{3}} is confirmed. Follow it here: {{4}} and reply to this chat for any help.',
    ['customer_name', 'order_number', 'business_name', 'order_link'],
  ),
  deliveryEvent(
    'order_packed',
    'Order packed',
    'Sent when the order is packed. Off by default.',
    'khatario_order_packed',
    'Hi {{1}}, your order {{2}} is packed and will leave soon. Follow it here: {{3}} and we will update you when it is on the way.',
    ['customer_name', 'order_number', 'order_link'],
  ),
  deliveryEvent(
    'order_ready_for_pickup',
    'Ready for pickup',
    'Sent with the pickup code when a pickup order is ready.',
    'khatario_order_ready_pickup',
    'Hi {{1}}, your order {{2}} is ready to collect from {{3}}. Show pickup code {{4}} at the counter.',
    ['customer_name', 'order_number', 'shop_address', 'pickup_code'],
  ),
  deliveryEvent(
    'order_shipped',
    'Order shipped',
    'Sent when an order is handed to a courier or rider.',
    'khatario_order_dispatched',
    'Hi {{1}}, your order {{2}} has been sent with {{3}}. Track it here: {{4}} and reply to this chat for any help.',
    ['customer_name', 'order_number', 'courier', 'order_link'],
  ),
  deliveryEvent(
    'order_out_for_delivery',
    'Out for delivery',
    'Sent when the order is out for delivery, with the rider contact.',
    'khatario_out_for_delivery',
    'Hi {{1}}, your order {{2}} is out for delivery today. Delivery partner: {{3}}, phone {{4}}. Track it here: {{5}} and please keep your phone handy.',
    ['customer_name', 'order_number', 'rider_name', 'rider_phone', 'order_link'],
  ),
  deliveryEvent(
    'order_delivered',
    'Order delivered',
    'Sent when the order is delivered or collected, with the bill link.',
    'khatario_order_delivered',
    'Hi {{1}}, your order {{2}} from {{3}} has been delivered. Your bill: {{4}} Thank you for shopping with us.',
    ['customer_name', 'order_number', 'business_name', 'invoice_link'],
  ),
  deliveryEvent(
    'order_delivery_failed',
    'Delivery attempt failed',
    'Sent when a delivery attempt fails, with the reason.',
    'khatario_delivery_failed',
    'Hi {{1}}, we could not deliver your order {{2}}: {{3}}. Follow it at {{4}} or reply here to reschedule.',
    ['customer_name', 'order_number', 'reason', 'order_link'],
  ),
  deliveryEvent(
    'order_cancelled',
    'Order cancelled',
    'Sent when an order is cancelled, with refund details if it was paid.',
    'khatario_order_cancelled',
    'Hi {{1}}, your order {{2}} with {{3}} has been cancelled. {{4}} Reply here if you have any questions.',
    ['customer_name', 'order_number', 'business_name', 'refund_note'],
  ),
  {
    key: 'merchant_dispatch_overdue',
    group: 'merchant',
    label: 'Orders waiting to dispatch',
    description: 'Alert to your business number when paid orders have not been dispatched in time.',
    recipient: 'merchant',
    categories: ['UTILITY'],
    fields: ['count', 'business_name'],
    suggested: {
      name: 'khatario_dispatch_overdue',
      category: 'UTILITY',
      body: 'Reminder: {{1}} paid orders at {{2}} are waiting to be dispatched. Open Orders & delivery in Khatario.',
      variableMap: ['count', 'business_name'],
    },
  },
  {
    key: 'merchant_new_order',
    group: 'merchant',
    label: 'New store order',
    description: 'Alert to your business number when a store order comes in.',
    recipient: 'merchant',
    categories: ['UTILITY'],
    fields: ['customer_name', 'order_number', 'total'],
    suggested: {
      name: 'khatario_new_store_order',
      category: 'UTILITY',
      body: 'New store order {{1}} from {{2}}. Total ₹{{3}}. Open Store Orders in Khatario to pack and dispatch.',
      variableMap: ['order_number', 'customer_name', 'total'],
    },
  },
  {
    key: 'merchant_new_enquiry',
    group: 'merchant',
    label: 'New store enquiry',
    description: 'Alert to your business number when a shopper sends an enquiry.',
    recipient: 'merchant',
    categories: ['UTILITY'],
    fields: ['customer_name', 'contact', 'preview'],
    suggested: {
      name: 'khatario_new_store_enquiry',
      category: 'UTILITY',
      body: 'New store enquiry from {{1}} ({{2}}): {{3}}. Open Store Enquiries in Khatario to reply.',
      variableMap: ['customer_name', 'contact', 'preview'],
    },
  },
  {
    key: 'invoice_sent',
    group: 'billing',
    label: 'Send invoice',
    description: 'Used when you send an invoice to a customer from billing.',
    recipient: 'customer',
    categories: ['UTILITY'],
    fields: BILLING_FIELDS,
    suggested: {
      name: 'khatario_invoice_sent',
      category: 'UTILITY',
      body: 'Hi {{1}}, invoice {{2}} from {{3}} for ₹{{4}} is ready. View or download it here: {{5}} Thank you for your business.',
      variableMap: ['customer_name', 'invoice_number', 'business_name', 'amount', 'invoice_link'],
    },
  },
  {
    key: 'payment_due_reminder',
    group: 'billing',
    label: 'Payment due reminder',
    description: 'Automatic and manual reminders before an invoice is due.',
    recipient: 'customer',
    categories: ['UTILITY'],
    fields: BILLING_FIELDS,
    suggested: {
      name: 'khatario_payment_due',
      category: 'UTILITY',
      body: 'Hi {{1}}, a gentle reminder that invoice {{2}} from {{3}} for ₹{{4}} is due on {{5}}. View and pay here: {{6}} Thank you.',
      variableMap: ['customer_name', 'invoice_number', 'business_name', 'amount_due', 'due_date', 'invoice_link'],
    },
  },
  {
    key: 'payment_overdue_reminder',
    group: 'billing',
    label: 'Payment overdue reminder',
    description: 'Reminders after an invoice is past its due date.',
    recipient: 'customer',
    categories: ['UTILITY'],
    fields: BILLING_FIELDS,
    suggested: {
      name: 'khatario_payment_overdue',
      category: 'UTILITY',
      body: 'Hi {{1}}, invoice {{2}} from {{3}} for ₹{{4}} was due on {{5}} and is still unpaid. View and pay here: {{6}} Please ignore if already paid.',
      variableMap: ['customer_name', 'invoice_number', 'business_name', 'amount_due', 'due_date', 'invoice_link'],
    },
  },
];

export const TENANT_WA_GROUP_LABELS: Record<TenantWaEventGroup, string> = {
  store: 'Online store',
  delivery: 'Delivery updates (all channels)',
  merchant: 'Alerts to you',
  billing: 'Billing',
};

export function isTenantWaEventKey(v: unknown): v is TenantWaEventKey {
  return typeof v === 'string' && (TENANT_WA_EVENT_KEYS as readonly string[]).includes(v);
}

export function getTenantWaEvent(key: TenantWaEventKey): TenantWaEvent {
  return TENANT_WA_EVENTS.find((e) => e.key === key)!;
}

export function countPlaceholders(text: string | null | undefined): number {
  let max = 0;
  for (const m of String(text || '').matchAll(/\{\{(\d+)\}\}/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/** Template body with {{n}} replaced by sample values from a variable map, for previews. */
export function previewTemplateBody(body: string, variableMap: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const key = variableMap[Number(n) - 1] as TenantWaFieldKey | undefined;
    return key && key in TENANT_WA_FIELDS ? TENANT_WA_FIELDS[key].sample : `{{${n}}}`;
  });
}

/** Events that attach the invoice PDF, so a DOCUMENT header can be filled. */
const DOCUMENT_EVENTS = new Set<TenantWaEventKey>(['invoice_sent', 'payment_due_reminder', 'payment_overdue_reminder']);

function hasDynamicUrlButton(buttons: unknown): boolean {
  if (!Array.isArray(buttons)) return false;
  return buttons.some(
    (b) =>
      b &&
      typeof b === 'object' &&
      String((b as { type?: unknown }).type || '').toUpperCase() === 'URL' &&
      /\{\{\d+\}\}/.test(String((b as { url?: unknown }).url || '')),
  );
}

/**
 * Why a template can't be used for an event, or null when it fits. AUTHENTICATION templates
 * carry their code in a fixed body, so they need no variable map.
 */
export function templateEventMismatch(
  event: TenantWaEvent,
  template: {
    category: string;
    placeholder_count: number;
    status: string;
    header_format?: string | null;
    header_text?: string | null;
    buttons?: unknown;
  },
  variableMap: string[],
): string | null {
  if (!event.categories.includes(template.category as TemplateCategory)) {
    return `Needs a ${event.categories.join(' or ').toLowerCase()} template`;
  }
  if (template.category === 'AUTHENTICATION') return null;
  const header = template.header_format || 'none';
  if (header === 'image' || header === 'video') {
    return 'Templates with an image or video header are not supported';
  }
  if (header === 'document' && !DOCUMENT_EVENTS.has(event.key)) {
    return 'A PDF header only works for invoices and payment reminders';
  }
  if (header === 'text' && /\{\{\d+\}\}/.test(template.header_text || '')) {
    return 'Placeholders in the header are not supported';
  }
  if (hasDynamicUrlButton(template.buttons)) {
    return 'Buttons with a variable link are not supported';
  }
  if (variableMap.length !== template.placeholder_count) {
    return `Choose a field for each of the ${template.placeholder_count} placeholders`;
  }
  const allowed = new Set<string>(event.fields);
  const bad = variableMap.find((k) => !allowed.has(k));
  if (bad) return `"${bad}" is not available for this message`;
  return null;
}
