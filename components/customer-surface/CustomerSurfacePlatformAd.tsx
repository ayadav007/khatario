import Link from 'next/link';

/** Shown on free/trial plans when business has not disabled platform ads. */
export function CustomerSurfacePlatformAd() {
  return (
    <section
      className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm"
      aria-label="Sponsored"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-blue-800">Sponsored</p>
      <p className="mt-1 font-medium text-blue-900">
        Create invoices, track stock, and get paid faster with Khatario.
      </p>
      <Link
        href="/"
        className="link-primary mt-2 inline-block text-sm font-medium"
      >
        Learn about Khatario
      </Link>
    </section>
  );
}
