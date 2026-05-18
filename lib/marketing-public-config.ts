/**
 * Public marketing / trust settings — set in `.env.local` (rebuild may be required):
 *
 *   NEXT_PUBLIC_SUPPORT_EMAIL=you@example.com
 *   NEXT_PUBLIC_SUPPORT_WHATSAPP_URL=https://wa.me/9198xxxxxxxx
 *   NEXT_PUBLIC_SUPPORT_HOURS=Mon–Sat · 9:00–18:00 IST
 *
 * If email/WhatsApp are unset, the trust strip will emphasize demo booking instead.
 */
export function getPublicSupportConfig() {
  return {
    email: (process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '').trim() || null,
    whatsappUrl: (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_URL || '').trim() || null,
    hours: (process.env.NEXT_PUBLIC_SUPPORT_HOURS || '').trim() || 'Mon–Sat · 9:00–18:00 IST',
  };
}
