/** Canonical app origin for customer-facing links (email, WhatsApp). */
export function getAppPublicOrigin(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    '';
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, '')}`;
  }
  return 'http://localhost:3000';
}

export function publicInvoiceUrl(publicToken: string): string {
  return `${getAppPublicOrigin()}/i/${encodeURIComponent(publicToken)}`;
}

export function customerPortalUrl(portalSlug: string): string {
  return `${getAppPublicOrigin()}/portal/${encodeURIComponent(portalSlug)}`;
}
