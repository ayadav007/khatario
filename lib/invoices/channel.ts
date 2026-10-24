export const INVOICE_CHANNELS = ['online_store', 'whatsapp', 'counter', 'manual', 'sales_order'] as const;
export type InvoiceChannel = (typeof INVOICE_CHANNELS)[number];

export const CHANNEL_LABEL: Record<InvoiceChannel, string> = {
  online_store: 'Online store',
  whatsapp: 'WhatsApp',
  counter: 'Counter',
  manual: 'Manual',
  sales_order: 'Sales order',
};

export function isInvoiceChannel(v: unknown): v is InvoiceChannel {
  return typeof v === 'string' && (INVOICE_CHANNELS as readonly string[]).includes(v);
}

/** What a browser may claim when creating an invoice. Other channels are set by server flows only. */
export function clientInvoiceChannel(v: unknown): InvoiceChannel {
  return v === 'counter' ? 'counter' : 'manual';
}
