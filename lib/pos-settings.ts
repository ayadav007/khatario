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
 */
export function getPosAutoBluetoothPrint(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(POS_AUTO_BT_PRINT_KEY) === 'true';
}

/**
 * Set the auto-Bluetooth-print-on-save toggle for POS.
 */
export function setPosAutoBluetoothPrint(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(POS_AUTO_BT_PRINT_KEY, enabled ? 'true' : 'false');
}
