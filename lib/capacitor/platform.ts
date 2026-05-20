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
