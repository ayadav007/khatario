import { isCapacitorNative } from '@/lib/capacitor/platform';
import { isAppOffline } from '@/lib/network/offline-state';

let capacitorNetworkReady = !isCapacitorNative();

export function markCapacitorNetworkReady(): void {
  capacitorNetworkReady = true;
}

export function isCapacitorNetworkReady(): boolean {
  return capacitorNetworkReady;
}

/** True when the client should keep cached auth instead of forcing login. */
export function shouldTrustCachedSession(): boolean {
  if (isCapacitorNative() && !capacitorNetworkReady) return true;
  if (isAppOffline()) return true;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  return false;
}
