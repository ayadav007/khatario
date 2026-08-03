/**
 * POS Mode Settings
 * Frontend-only storage using localStorage
 * Can be migrated to backend settings API later if needed
 */

const POS_MODE_KEY = 'pos_mode_enabled';
const POS_PARKED_BILLS_KEY = 'pos_parked_bills';
const POS_AUTO_BT_PRINT_KEY = 'pos_auto_bt_print_enabled';

export interface ParkedBill {
  id: string;
  invoiceNumber: string;
  total: number;
  itemCount: number;
  customerName?: string;
  timestamp: string;
  data: any; // Full invoice state
}

/**
 * Get POS mode setting
 */
export function getPosMode(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(POS_MODE_KEY);
  return stored === 'true';
}

/**
 * Set POS mode setting
 */
export function setPosMode(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(POS_MODE_KEY, enabled ? 'true' : 'false');
  window.dispatchEvent(new Event('posModeChanged'));
}

/**
 * Get all parked bills
 */
export function getParkedBills(): ParkedBill[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(POS_PARKED_BILLS_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch (e) {
    console.error('Failed to parse parked bills:', e);
    return [];
  }
}

/**
 * Save a parked bill
 */
export function saveParkedBill(bill: Omit<ParkedBill, 'id' | 'timestamp'>): string {
  if (typeof window === 'undefined') return '';
  const id = `parked_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const parkedBill: ParkedBill = {
    ...bill,
    id,
    timestamp: new Date().toISOString(),
  };
  
  const existing = getParkedBills();
  existing.push(parkedBill);
  localStorage.setItem(POS_PARKED_BILLS_KEY, JSON.stringify(existing));
  return id;
}

/**
 * Get a parked bill by ID
 */
export function getParkedBill(id: string): ParkedBill | null {
  const bills = getParkedBills();
  return bills.find(b => b.id === id) || null;
}

/**
 * Delete a parked bill
 */
export function deleteParkedBill(id: string): void {
  if (typeof window === 'undefined') return;
  const bills = getParkedBills();
  const filtered = bills.filter(b => b.id !== id);
  localStorage.setItem(POS_PARKED_BILLS_KEY, JSON.stringify(filtered));
}

/**
 * Clear all parked bills
 */
export function clearParkedBills(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(POS_PARKED_BILLS_KEY);
}

/**
 * Is the auto-Bluetooth-print-on-save toggle enabled for POS?
 * In the Capacitor Android/iOS app, default ON when never set — PDF popups
 * do not work there, so PRINT BILL would otherwise silently do nothing.
 */
export function getPosAutoBluetoothPrint(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(POS_AUTO_BT_PRINT_KEY);
  if (stored === null) {
    try {
      const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } })
        .Capacitor;
      if (cap?.isNativePlatform?.()) return true;
    } catch {
      /* ignore */
    }
    return false;
  }
  return stored === 'true';
}

function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor;
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
}

/**
 * Whether PRINT BILL / POS save should send ESC/POS to the paired Bluetooth
 * printer instead of opening a PDF tab.
 *
 * On the Android/iOS app, always prefer Bluetooth when a printer is ready —
 * `window.open(pdf)` is unreliable in Capacitor and looks like "nothing happened".
 * On desktop web, honour the auto-print toggle.
 */
export function shouldPosPrintViaBluetooth(opts: {
  featureEnabled: boolean;
  btSupported: boolean;
  pairedCount: number;
}): boolean {
  if (!opts.featureEnabled || !opts.btSupported || opts.pairedCount <= 0) {
    return false;
  }
  if (isNativeShell()) return true;
  return getPosAutoBluetoothPrint();
}

/**
 * Set the auto-Bluetooth-print-on-save toggle for POS.
 */
export function setPosAutoBluetoothPrint(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(POS_AUTO_BT_PRINT_KEY, enabled ? 'true' : 'false');
}
