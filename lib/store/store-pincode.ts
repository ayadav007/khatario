// Client-safe. The shopper's delivery pincode (Quick header and its location sheet), shared by the old
// storefront and engine pages.
import type { StoreBranch } from './resolve-store';

/** localStorage key of the pincode a shopper entered on this store. */
export function storePinKey(subdomain: string): string {
  return `khatario-store-pin:${subdomain}`;
}

/** Digits only, at most 6. */
export function cleanPincode(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6);
}

/**
 * Whether the branch can take orders for this pincode. True while nothing is entered, when the branch lists no
 * pincodes, or when it delivers all over India.
 */
export function pincodeServiceable(
  branch: Pick<StoreBranch, 'serviceable_pincodes' | 'delivery_mode'> | undefined,
  pincode: string,
): boolean {
  const pins = branch?.serviceable_pincodes ?? [];
  return (
    !pincode ||
    pins.length === 0 ||
    branch?.delivery_mode === 'all_india' ||
    pins.map((p) => p.replace(/\D/g, '')).includes(pincode)
  );
}

/** Second line of the Quick location button. */
export function pincodeLine(pincode: string, branchName: string | undefined, storeName: string): string {
  if (pincode) return `Deliver to ${pincode}`;
  if (branchName && branchName !== storeName) return branchName;
  return 'Set delivery pincode';
}
