export async function notifyStoreCustomerWhatsApp(input: {
  businessId: string;
  phone: string;
  text: string;
}): Promise<void> {
  const to = String(input.phone ?? '').replace(/\D/g, '');
  if (to.length < 10) return;
  try {
    const { sendWhatsAppMessage } = await import('@/lib/whatsapp');
    await sendWhatsAppMessage(input.businessId, to, input.text, undefined, 'text');
  } catch (err) {
    console.error('[store whatsapp]', err);
  }
}
