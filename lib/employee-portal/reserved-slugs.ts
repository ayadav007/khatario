import { isReservedBusinessSlug } from '@/lib/customer-surface/slug';

export {
  RESERVED_BUSINESS_SLUGS,
  isReservedBusinessSlug,
} from '@/lib/customer-surface/slug';

/** /{slug}/employees and subpaths */
export function isPublicBusinessEmployeePath(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 2) return false;
  if (isReservedBusinessSlug(parts[0])) return false;
  return parts[1] === 'employees';
}

export function extractBusinessSlugFromEmployeePath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 2 || parts[1] !== 'employees') return null;
  if (isReservedBusinessSlug(parts[0])) return null;
  return parts[0];
}
