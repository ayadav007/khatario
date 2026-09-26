/**
 * Public marketing / trust settings — set in `.env.local` (rebuild may be required):
 *
 *   NEXT_PUBLIC_SUPPORT_EMAIL=help@khatario.com
 *   NEXT_PUBLIC_SUPPORT_WHATSAPP_URL=https://wa.me/9198xxxxxxxx
 *   NEXT_PUBLIC_SUPPORT_HOURS=Mon–Sat · 9:00–18:00 IST
 *
 * NEXT_PUBLIC_* is baked in at `next build`. Restart is not enough after changing it.
 */
export function getPublicSupportConfig() {
  return {
    email: (process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'help@khatario.com').trim() || null,
    whatsappUrl: (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_URL || '').trim() || null,
    hours: (process.env.NEXT_PUBLIC_SUPPORT_HOURS || '').trim() || 'Mon–Sat · 9:00–18:00 IST',
  };
}
