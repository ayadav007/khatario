import { notFound } from 'next/navigation';
import { CustomerPortalClient } from '@/components/customer-surface/CustomerPortalClient';
import { resolveBusinessByPortalSlug } from '@/lib/customer-surface';

export const metadata = {
  title: 'Customer portal',
  robots: { index: false, follow: false },
};

export default async function CustomerPortalPage({
  params,
}: {
  params: { slug: string };
}) {
  const business = await resolveBusinessByPortalSlug(params.slug);
  if (!business?.portal_slug) {
    notFound();
  }

  return <CustomerPortalClient slug={business.portal_slug} initialBusiness={business} />;
}
