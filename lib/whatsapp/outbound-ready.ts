import { businessTransport, type BusinessTransport } from '@/lib/whatsapp/business-transport';

export type OutboundReady =
  | { ready: true; transport: BusinessTransport }
  | { ready: false; transport: 'baileys'; status: string };

/**
 * A reminder can go out only when the QR session is live, or when the business
 * is actually sending through the Meta Cloud API (saved credentials and Connect).
 */
export async function whatsAppOutboundReady(businessId: string): Promise<OutboundReady> {
  const transport = await businessTransport(businessId);
  if (transport === 'cloud') return { ready: true, transport: 'cloud' };

  const { getWhatsAppStatus } = await import('@/lib/whatsapp');
  const status = await getWhatsAppStatus(businessId);
  if (status.status === 'connected') return { ready: true, transport: 'baileys' };
  return { ready: false, transport: 'baileys', status: status.status || 'disconnected' };
}
