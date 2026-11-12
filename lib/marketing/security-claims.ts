/**
 * Claims on the public Security page. Each claim is backed by the repo paths in `evidence`
 * (comma-separated), which a test checks exist. `evidence` is never shown on the page.
 *
 * Dropped because the repo does not prove them (see the Trust pages task 8 report):
 * - encrypted-traffic: the production nginx templates in docs/SERVER_INFRASTRUCTURE.md serve
 *   port 80 without redirecting to HTTPS.
 * - backups: no Khatario-run database backup is documented, and the business's own scheduled
 *   backup job (app/api/cron/process-scheduled-backups) is not in the server crontab.
 * - server-location: the server docs do not name a country.
 */
export type SecurityClaim = { id: string; title: string; body: string; evidence: string };

export const SECURITY_CLAIMS: SecurityClaim[] = [
  {
    id: 'separate-business-data',
    title: 'Every business is kept separate',
    body: 'Khatario takes your business from your login, not from what your phone or browser says. A request that names another business is ignored or refused.',
    evidence:
      'lib/auth-helpers.ts, middleware.ts, tests/security/middleware-identity-headers.test.ts, tests/security/middleware-static-suffix-identity.test.ts, tests/security/tenant-isolation.test.ts, tests/security/settings-body-business-id.test.ts',
  },
  {
    id: 'login-and-roles',
    title: 'Safe sign-in and staff roles',
    body: 'Passwords are stored only in scrambled form. If you forget your password, resetting it needs a code sent on WhatsApp and a code sent by email. You choose what each staff member can see and do, and anything not allowed is blocked.',
    evidence:
      'app/api/auth/login/route.ts, app/api/auth/reset-password/route.ts, lib/auth/merchant-password-reset.ts, lib/platform-public-otp.ts, tests/pbac/default-deny.test.ts, tests/security/roles-screen-save-route.test.ts',
  },
  {
    id: 'payments',
    title: 'Card details stay with the payment gateway',
    body: 'When you pay for Khatario or your customers pay you online, card details and bank logins are typed only on the payment gateway\'s own page. Card numbers never reach Khatario.',
    evidence:
      'lib/platform-subscription-checkout.ts, lib/platform-addon-checkout.ts, lib/payments/providers, lib/payments/providers/razorpay-payment-provider.ts, lib/payments/payment-link-callback.ts',
  },
  {
    id: 'data-export',
    title: 'Your data is yours to take',
    body: 'As the business owner, you can download a copy of your bills, items, stock, customers, suppliers and accounts from Settings, under Backup and restore. The same file can be used to restore them later.',
    evidence: 'app/(app)/settings/backup/page.tsx, app/api/backup/create/route.ts, app/api/backup/restore/route.ts',
  },
  {
    id: 'invoice-history',
    title: 'A record of every change to a bill',
    body: 'Khatario keeps a record of every change to a bill: who made it, when and what changed. No one in your business can edit or delete entries in this record. You can still see how a bill looked before a change.',
    evidence:
      'database/migrations/469_invoice_revisions.sql, lib/invoices/invoice-history.ts, app/api/invoices/[id]/history/route.ts, docs/project.log.md',
  },
];
