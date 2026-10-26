import { redirect } from 'next/navigation';

/** Saved replies are managed in Settings > WhatsApp > Team & inbox. */
export default function SavedRepliesRedirectPage() {
  redirect('/settings/whatsapp/inbox#saved-replies');
}
