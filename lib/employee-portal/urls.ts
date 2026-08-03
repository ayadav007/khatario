import { getAppPublicOrigin } from '@/lib/customer-surface/urls';

export function employeePortalUrl(portalSlug: string): string {
  return `${getAppPublicOrigin()}/${encodeURIComponent(portalSlug)}/employees`;
}
