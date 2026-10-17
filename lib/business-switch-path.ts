const RECORD_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/i;

/**
 * Where to land after switching business. A page about one record (a supplier, an order,
 * an invoice) belongs to the business being left, so go to its list instead; any other
 * page stays where it is, without query values that may point at the old business's records.
 */
export function pathAfterBusinessSwitch(pathname: string, search = ''): string {
  const segments = pathname.split('/').filter(Boolean);
  const idAt = segments.findIndex((s) => RECORD_ID.test(s));
  if (idAt === 0) return '/dashboard';
  if (idAt > 0) return `/${segments.slice(0, idAt).join('/')}`;
  const params = new URLSearchParams(search);
  const pointsAtRecord = [...params.values()].some((v) => RECORD_ID.test(v) && v.includes('-'));
  return pointsAtRecord ? pathname || '/dashboard' : `${pathname || '/dashboard'}${search}`;
}
