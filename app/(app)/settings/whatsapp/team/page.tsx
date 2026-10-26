import { redirect } from 'next/navigation';

/** Agents are a section of Settings > WhatsApp > Team & inbox. */
export default function WhatsAppTeamRedirectPage() {
  redirect('/settings/whatsapp/inbox#connect-agents');
}
