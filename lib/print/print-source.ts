/** Print HTML sources the silent-print page may load: this site's `/api/.../preview` endpoints only. */
export function isAllowedPrintSource(src: string | null): src is string {
  return !!src && /^\/api\/[A-Za-z0-9_\-/]+\/preview(\?[^#]*)?$/.test(src) && !src.includes('..') && !src.startsWith('//');
}
