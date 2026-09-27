import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { LandingPage } from '@/components/marketing/landing/LandingPage';
import { PLATFORM_ACCESS_COOKIE, verifyPlatformAccessToken } from '@/lib/platform-jwt';
import { getPlatformAdminIfSessionValid, hasMinimumRole } from '@/lib/platform-auth';
import { getDraftMarketingDocument } from '@/lib/marketing-builder/pages-repo';
import { MARKETING_EDIT_ROLE } from '@/lib/marketing-builder/api-helpers';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Draft preview',
  robots: { index: false, follow: false },
};

export default async function SiteBuilderPreviewPage() {
  const token = cookies().get(PLATFORM_ACCESS_COOKIE)?.value;
  const session = token ? await verifyPlatformAccessToken(token) : null;
  const admin = session ? await getPlatformAdminIfSessionValid(session.adminId, session.sv) : null;
  if (!admin || !hasMinimumRole(admin, MARKETING_EDIT_ROLE)) notFound();

  const document = await getDraftMarketingDocument('home');
  return <LandingPage document={document ?? undefined} preview />;
}
