/** True when running inside the Capacitor Android/iOS shell (not mobile browser). */
export function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as { Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
  } }).Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') {
    return !!cap.isNativePlatform();
  }
  if (typeof cap.getPlatform === 'function') {
    const p = cap.getPlatform();
    return p === 'android' || p === 'ios';
  }
  return false;
}

/** Marker the Flutter phone app adds to its in-app web view's user agent (`phoneUserAgentMark`). */
export const PHONE_APP_USER_AGENT_MARK = 'KhatarioPhone';

/** True when the page is open inside the Flutter phone app, which draws its own title bar and tabs. */
export function isInsidePhoneApp(userAgent?: string): boolean {
  const ua = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  return ua.includes(PHONE_APP_USER_AGENT_MARK);
}
