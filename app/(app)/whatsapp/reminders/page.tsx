import { redirect } from 'next/navigation';

/**
 * Payment reminders are a Billing feature (Starter and up, sent over QR), so they live under
 * /payments where Billing-only businesses can open them. /whatsapp/* needs the Connect module.
 */
export default function WhatsAppRemindersRedirectPage({ searchParams }: { searchParams?: { tab?: string } }) {
  redirect(searchParams?.tab === 'logs' ? '/payments/reminders?tab=logs' : '/payments/reminders');
}
