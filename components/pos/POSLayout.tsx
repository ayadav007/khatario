'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getPosMode, saveParkedBill, getParkedBills, ParkedBill } from '@/lib/pos-settings';
import { ParkedBillsDrawer } from './ParkedBillsDrawer';
import { POSPaymentInputs } from './POSPaymentInputs';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Printer, Save, Clock, Phone, UserPlus, Loader2, X, Bluetooth, Plus, LogOut, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';

function sumPaymentsRupee(payments: Array<{ amount?: unknown }>): number {
  return payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

/** Compare in integer paise so float tax math (e.g. 99.9999999 vs 100) does not block print. */
function paymentCoversGrandTotal(totalPaid: number, grandTotal: number): boolean {
  return Math.round(totalPaid * 100) >= Math.round(grandTotal * 100);
}

interface POSLayoutProps {
  children: React.ReactNode;
  // Invoice state props
  invoiceNumber: string;
  invoiceDate: string;
  grandTotal: number;
  subtotal: number;
  totalTax: number;
  payments: Array<{ mode: string; amount: number }>;
  onPaymentsChange: (payments: Array<{ mode: string; amount: number }>) => void;
  onPrintBill: () => void | Promise<void>;
  onSaveBill?: () => void | Promise<void>;
  onParkBill: () => void;
  customerName?: string;
  customerPhone?: string;
  onCustomerPhoneChange?: (phone: string) => void;
  onCustomerSelect?: (customer: any) => void;
  onAddNewCustomer?: () => void;
  // Park/Resume
  onResumeBill: (bill: ParkedBill) => void;
  // Invoice state for parking
  getInvoiceState: () => any;
  restoreInvoiceState: (state: any) => void;
  // New bill flow
  onStartNewBill: () => void;
  onAddNewItem?: () => void;
  onClearAllItems?: () => void;
  onExitPos?: () => void;
  // Focus management
  itemSearchInputRef?: React.RefObject<HTMLInputElement>;
  // Item count for disabling PRINT BILL
  itemCount: number;
  // Loading state
  isPrinting?: boolean;
  /** Offline bill queued — show TMP number + sync pending badge */
  offlinePending?: boolean;
  offlineInvoiceLabel?: string | null;
  // Item rows for calculating total quantity (POS mode summary)
  itemRows?: Array<{ itemId?: string; name?: string; quantity?: number }>;
  // Bluetooth printing (optional – all props must be provided together)
  bluetooth?: {
    /** Whether the barcode_thermal_printer feature is enabled. */
    enabled: boolean;
    /** Web Bluetooth / Capacitor BLE available in current runtime. */
    supported: boolean;
    /** Count of printers paired on this device for this business. */
    pairedCount: number;
    /** Current value of the "auto-print to BT on save" toggle. */
    autoPrint: boolean;
    /** Change the auto-print toggle. */
    onAutoPrintChange: (next: boolean) => void;
    /** Manually send the current order to BT without saving. */
    onReprint: () => void | Promise<void>;
    /** True while a BT job is in flight. */
    isReprinting?: boolean;
    /** Short status under the BT buttons (connected / will connect on print). */
    printerHint?: string;
  };
}

export function POSLayout({
  children,
  invoiceNumber,
  invoiceDate,
  grandTotal,
  subtotal,
  totalTax,
  payments,
  onPaymentsChange,
  onPrintBill,
  onSaveBill,
  onParkBill,
  customerName,
  customerPhone = '',
  onCustomerPhoneChange,
  onCustomerSelect,
  onAddNewCustomer,
  onResumeBill,
  getInvoiceState,
  restoreInvoiceState,
  onStartNewBill,
  onAddNewItem,
  onClearAllItems,
  onExitPos,
  itemSearchInputRef,
  itemCount,
  isPrinting = false,
  offlinePending = false,
  offlineInvoiceLabel = null,
  itemRows = [],
  bluetooth,
}: POSLayoutProps) {
  const [posMode, setPosMode] = useState(false);
  const [parkedBillsOpen, setParkedBillsOpen] = useState(false);
  const [phoneSearchQuery, setPhoneSearchQuery] = useState(customerPhone || '');
  const [phoneSearchResults, setPhoneSearchResults] = useState<any[]>([]);
  const [phoneSearchOpen, setPhoneSearchOpen] = useState(false);
  const [phoneSearching, setPhoneSearching] = useState(false);
  const phoneSearchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const parkedBillsCount = getParkedBills().length;
  const { business, user } = useAuth();
  const leftPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPosMode(getPosMode());
  }, []);

  // Update fixed summary position when layout changes
  useEffect(() => {
    if (!posMode || !leftPanelRef.current) return;

    const updatePosition = () => {
      if (leftPanelRef.current) {
        const rect = leftPanelRef.current.getBoundingClientRect();
        document.documentElement.style.setProperty('--left-panel-offset', `${rect.left}px`);
        document.documentElement.style.setProperty('--left-panel-width', `${rect.width}px`);
      }
    };

    // Initial position
    updatePosition();

    // Update on resize
    window.addEventListener('resize', updatePosition);
    // Update on scroll (in case parent scrolls)
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [posMode]);

  // Auto-focus item search on POS load
  useEffect(() => {
    if (posMode && itemSearchInputRef?.current) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        itemSearchInputRef.current?.focus();
      }, 100);
    }
  }, [posMode, itemSearchInputRef]);

  const handleParkBill = useCallback(() => {
    const state = getInvoiceState();
    const tempNumber = `TEMP-${Date.now()}`;
    saveParkedBill({
      invoiceNumber: tempNumber,
      total: grandTotal,
      itemCount: state.rows?.length || 0,
      customerName: customerName,
      data: state,
    });
    onParkBill();
    // Start new bill immediately
    onStartNewBill();
    toast.success('Bill parked');
    // Focus item search after park
    setTimeout(() => {
      itemSearchInputRef?.current?.focus();
    }, 100);
  }, [getInvoiceState, grandTotal, customerName, onParkBill, onStartNewBill, itemSearchInputRef]);

  const handlePrintBill = useCallback(async () => {
    try {
      // onPrintBill handles save, print, and startNewBill
      await onPrintBill();
    } catch (error) {
      console.error('Print bill error:', error);
      toast.error('Failed to print bill');
    }
  }, [onPrintBill]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!posMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger if not typing in input/textarea
      const target = e.target as HTMLElement;
      const inField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (e.key === 'F4') {
        e.preventDefault();
        document.getElementById('pos-received-cash')?.focus();
        return;
      }
      if (e.key === 'F5') {
        e.preventDefault();
        document.getElementById('pos-customer-phone')?.focus();
        return;
      }
      if (e.key === 'F6') {
        e.preventDefault();
        const totalPaid = sumPaymentsRupee(payments);
        const canPrint = itemCount > 0 && paymentCoversGrandTotal(totalPaid, grandTotal);
        if (canPrint && !isPrinting) {
          handlePrintBill();
        }
        return;
      }
      if (e.key === 'F7') {
        e.preventDefault();
        if (itemCount > 0 && !isPrinting) {
          void onSaveBill?.();
        }
        return;
      }

      if (inField && !e.ctrlKey && !e.metaKey) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        handleParkBill();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setParkedBillsOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        onAddNewItem?.();
      } else if (e.ctrlKey && e.key === 'Escape') {
        e.preventDefault();
        onExitPos?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [posMode, handleParkBill, handlePrintBill, payments, itemCount, grandTotal, isPrinting, onSaveBill, onAddNewItem, onExitPos]);

  // Phone number search
  useEffect(() => {
    if (phoneSearchTimeoutRef.current) {
      clearTimeout(phoneSearchTimeoutRef.current);
    }

    if (!phoneSearchQuery || phoneSearchQuery.length < 3 || !business?.id || !user?.id) {
      setPhoneSearchResults([]);
      setPhoneSearchOpen(false);
      return;
    }

    phoneSearchTimeoutRef.current = setTimeout(async () => {
      setPhoneSearching(true);
      try {
        const res = await fetch(
          `/api/customers?business_id=${business.id}&search=${encodeURIComponent(phoneSearchQuery)}&limit=5&user_id=${user.id}`
        );
        if (res.ok) {
          const data = await res.json();
          const results = data.customers || [];
          setPhoneSearchResults(results);
          // Auto-select if exactly one match
          if (results.length === 1) {
            // Small delay to allow state update
            setTimeout(() => {
              onCustomerSelect?.(results[0]);
              setPhoneSearchQuery(results[0].phone || '');
              onCustomerPhoneChange?.(results[0].phone || '');
              setPhoneSearchOpen(false);
              setPhoneSearchResults([]);
            }, 100);
          } else {
            setPhoneSearchOpen(results.length > 1);
          }
        }
      } catch (err) {
        console.error('Phone search error:', err);
        setPhoneSearchResults([]);
        setPhoneSearchOpen(false);
      } finally {
        setPhoneSearching(false);
      }
    }, 300);

    return () => {
      if (phoneSearchTimeoutRef.current) {
        clearTimeout(phoneSearchTimeoutRef.current);
      }
    };
  }, [phoneSearchQuery, business?.id, user?.id, onCustomerSelect, onCustomerPhoneChange]);

  // Sync phone query with prop
  useEffect(() => {
    setPhoneSearchQuery(customerPhone || '');
  }, [customerPhone]);

  const handlePhoneChange = (value: string) => {
    setPhoneSearchQuery(value);
    onCustomerPhoneChange?.(value);
    
    // Clear customer if phone is cleared
    if (!value.trim()) {
      onCustomerSelect?.(null);
      setPhoneSearchResults([]);
      setPhoneSearchOpen(false);
      return;
    }
    
    // Reset search state when phone changes
    setPhoneSearchOpen(false);
    setPhoneSearchResults([]);
  };

  const handleCustomerSelect = (customer: any) => {
    onCustomerSelect?.(customer);
    setPhoneSearchQuery(customer.phone || '');
    onCustomerPhoneChange?.(customer.phone || '');
    setPhoneSearchOpen(false);
    setPhoneSearchResults([]);
  };

  const handleResumeBill = (bill: ParkedBill) => {
    restoreInvoiceState(bill.data);
    setParkedBillsOpen(false);
    toast.success('Bill resumed');
    // Focus item search after resume
    setTimeout(() => {
      itemSearchInputRef?.current?.focus();
    }, 100);
  };

  if (!posMode) {
    return <>{children}</>;
  }

  // Calculate payment totals (rupee sum + paise-safe compare to grand total)
  const totalPaid = sumPaymentsRupee(payments);
  const paymentComplete = paymentCoversGrandTotal(totalPaid, grandTotal);
  const canPrint = itemCount > 0 && paymentComplete;

  return (
    <>
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 shrink-0 text-xs"
              onClick={() => onExitPos?.()}
            >
              <LogOut className="mr-1 h-3.5 w-3.5" />
              Exit POS
              <span className="ml-1 text-[10px] opacity-70">Ctrl+Esc</span>
            </Button>
            <div>
              <div className="text-[10px] uppercase text-gray-500">Invoice</div>
              <div className="truncate text-sm font-bold text-gray-900">
                {offlineInvoiceLabel || invoiceNumber || 'New'}
              </div>
              {offlinePending && (
                <div className="text-[10px] font-medium text-amber-700">Offline · sync pending</div>
              )}
            </div>
            <div className="hidden sm:block">
              <div className="text-[10px] uppercase text-gray-500">Date</div>
              <div className="text-sm font-medium text-gray-700">{format(new Date(invoiceDate), 'dd-MM-yyyy')}</div>
            </div>
          </div>

          <div className="flex max-w-xl flex-1 items-center justify-center gap-3">
            <div className="relative w-56">
              <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="pos-customer-phone"
                type="tel"
                value={phoneSearchQuery}
                onChange={(e) => handlePhoneChange(e.target.value)}
                placeholder="Customer phone · F5"
                className="h-9 pl-10 pr-8 text-sm"
                autoFocus={!phoneSearchQuery}
              />
              {phoneSearchQuery && (
                <button
                  onClick={() => handlePhoneChange('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-gray-100"
                  type="button"
                >
                  <X className="h-3 w-3 text-gray-400" />
                </button>
              )}
              {phoneSearching && (
                <Loader2 className="absolute right-8 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />
              )}
              {phoneSearchOpen && phoneSearchResults.length > 0 && (
                <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
                  {phoneSearchResults.map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => handleCustomerSelect(customer)}
                      className="w-full border-b border-gray-100 px-3 py-2 text-left last:border-0 hover:bg-gray-50"
                    >
                      <div className="text-sm font-medium text-gray-900">{customer.name || 'Unnamed'}</div>
                      <div className="text-xs text-gray-500">{customer.phone}</div>
                    </button>
                  ))}
                </div>
              )}
              {phoneSearchOpen && phoneSearchResults.length === 0 && phoneSearchQuery.length >= 3 && !phoneSearching && (
                <div className="absolute z-50 mt-1 w-full rounded-md border border-gray-200 bg-white p-3 shadow-lg">
                  <div className="mb-2 text-sm text-gray-600">No customer found</div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      onAddNewCustomer?.();
                      setPhoneSearchOpen(false);
                    }}
                    className="w-full"
                  >
                    <UserPlus className="mr-2 h-4 w-4" />
                    Create Customer
                  </Button>
                </div>
              )}
            </div>
            <div className="hidden w-40 md:block">
              <div className="text-[10px] uppercase text-gray-500">Customer</div>
              <div className="truncate text-sm font-medium text-gray-700">{customerName || 'Cash sale'}</div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={handleParkBill} className="h-8 text-xs">
              <Save className="mr-1 h-3.5 w-3.5" />
              Hold
              <span className="ml-1 text-[10px] opacity-70">Ctrl+H</span>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setParkedBillsOpen(true)} className="h-8 text-xs">
              <Clock className="mr-1 h-3.5 w-3.5" />
              Held ({parkedBillsCount})
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 bg-slate-50 px-3 py-1.5">
          <Button type="button" variant="secondary" size="sm" className="h-8 text-xs" onClick={() => onAddNewItem?.()}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            New item
            <span className="ml-1 text-[10px] opacity-70">Ctrl+I</span>
          </Button>
          <span className="hidden text-xs text-gray-500 sm:inline">F1 search · F4 received · F5 customer</span>
          <button
            type="button"
            className="ml-auto text-xs font-medium text-red-600 hover:underline"
            onClick={() => {
              if (itemCount === 0) return;
              if (window.confirm('Clear all items on this bill?')) onClearAllItems?.();
            }}
          >
            <Trash2 className="mr-1 inline h-3 w-3" />
            Clear bill
          </button>
        </div>
      </div>

      {/* POS Two-Column Layout */}
      <div className="flex h-[calc(100vh-7rem)] gap-4">
        {/* Left Panel - Items (65%) - with bottom padding for fixed summary */}
        <div 
          ref={leftPanelRef}
          className="flex-1 relative" 
          style={{ width: '65%' }}
        >
          {/* Scrollable content area with bottom padding to prevent overlap with fixed summary */}
          <div className="h-full overflow-y-auto" style={{ paddingBottom: '90px' }}>
            {children}
          </div>
        </div>

        {/* Right Panel - Totals + Payment (35%) */}
        <div className="w-[35%] bg-white border-l border-gray-200 p-5 flex flex-col">
          {/* SECTION 1: PAYMENT INPUTS (POS STYLE) */}
          <div className="mb-4">
            <h3 className="text-xs font-bold uppercase text-gray-700 mb-3 tracking-wide">Payment</h3>
            <POSPaymentInputs
              grandTotal={grandTotal}
              payments={payments}
              onChange={onPaymentsChange}
            />
          </div>

          {/* SECTION 2: PRIMARY ACTION - PRINT BILL */}
          <div className="mt-4 space-y-2">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => void onSaveBill?.()}
              disabled={itemCount === 0 || isPrinting}
              className="h-12 w-full text-base font-semibold"
            >
              Save bill
              <span className="ml-2 text-xs opacity-70">(F7)</span>
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={handlePrintBill}
              disabled={!canPrint || isPrinting}
              isLoading={isPrinting}
              className="h-16 w-full text-lg font-bold shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Printer className="mr-2 h-5 w-5" />
              {isPrinting ? 'PRINTING...' : 'Save & print'}
              <span className="ml-2 text-xs opacity-70">(F6)</span>
            </Button>
            {!canPrint && itemCount === 0 && (
              <p className="text-xs text-red-600 text-center mt-2">Add items to print</p>
            )}
            {!canPrint && itemCount > 0 && !paymentComplete && (
              <p className="text-xs text-red-600 text-center mt-2">Payment incomplete</p>
            )}
          </div>

          {/* SECTION 3: BLUETOOTH PRINTER CONTROLS */}
          {bluetooth?.enabled && (
            <div className="mt-4 border-t border-gray-200 pt-4 space-y-2">
              <label
                className={`flex items-center justify-between gap-3 text-xs font-medium cursor-pointer ${
                  bluetooth.supported && bluetooth.pairedCount > 0
                    ? 'text-gray-700'
                    : 'text-gray-400 cursor-not-allowed'
                }`}
                title={
                  !bluetooth.supported
                    ? 'Bluetooth not supported in this browser'
                    : bluetooth.pairedCount === 0
                      ? 'Pair a printer in Settings → Print & devices first'
                      : 'On desktop: send receipt to Bluetooth after PRINT BILL. The Android app always uses Bluetooth when a printer is paired.'
                }
              >
                <span className="flex items-center gap-2">
                  <Bluetooth className="w-3.5 h-3.5" />
                  Auto-print to Bluetooth
                </span>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300"
                  checked={bluetooth.autoPrint}
                  disabled={!bluetooth.supported || bluetooth.pairedCount === 0}
                  onChange={(e) => bluetooth.onAutoPrintChange(e.target.checked)}
                />
              </label>
              <Button
                variant="secondary"
                size="sm"
                className="w-full h-9"
                onClick={() => bluetooth.onReprint()}
                disabled={
                  !bluetooth.supported ||
                  bluetooth.pairedCount === 0 ||
                  itemCount === 0 ||
                  !!bluetooth.isReprinting
                }
                title={
                  !bluetooth.supported
                    ? 'Bluetooth not supported in this browser'
                    : bluetooth.pairedCount === 0
                      ? 'Pair a printer in Settings → Print & devices first'
                      : 'Print this order to the Bluetooth printer without saving'
                }
              >
                {bluetooth.isReprinting ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Bluetooth className="w-3.5 h-3.5 mr-1.5" />
                )}
                {bluetooth.isReprinting
                  ? 'Printing to Bluetooth…'
                  : 'Print to Bluetooth'}
              </Button>
              {bluetooth.printerHint && (
                <p className="text-caption text-gray-600 text-center">{bluetooth.printerHint}</p>
              )}
              {!bluetooth.supported && (
                <p className="text-caption text-gray-500 text-center">
                  Browser has no Bluetooth support
                </p>
              )}
              {bluetooth.supported && bluetooth.pairedCount === 0 && (
                <p className="text-caption text-gray-500 text-center">
                  Pair a printer in Settings → Print & devices
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Fixed Sales Summary at Bottom of Viewport (Left Panel Only) */}
      {/* Positioned fixed at viewport bottom, aligned with left panel */}
      <div 
        className="fixed bottom-0 bg-gray-50 border-t-2 border-gray-300 px-6 py-4 z-50 shadow-lg"
        style={{ 
          left: 'var(--left-panel-offset, 0px)',
          width: 'var(--left-panel-width, 65%)',
          maxWidth: 'calc(65vw - 1rem)' // Account for gap and padding
        }}
      >
        <div className="flex items-center justify-between gap-6">
          {/* Item Count */}
          <div className="flex flex-col items-center">
            <span className="text-display text-gray-500 uppercase font-semibold">Items</span>
            <span className="text-display-lg font-bold text-gray-900 text-center">{itemRows.filter(r => r.itemId && r.name).length}</span>
          </div>
          {/* Subtotal */}
          <div className="flex flex-col items-center">
            <span className="text-display text-gray-500 uppercase font-semibold">Subtotal</span>
            <span className="text-display-lg font-bold text-gray-900 text-center">₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          {/* Total Tax */}
          <div className="flex flex-col items-center">
            <span className="text-display text-gray-500 uppercase font-semibold">Total Tax</span>
            <span className="text-display-lg font-bold text-gray-900 text-center">₹{totalTax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          {/* Grand Total - Most Prominent */}
          <div className="flex flex-col items-center ml-auto">
            <span className="text-display text-gray-500 uppercase font-semibold">Grand Total</span>
            <span className="text-display-lg font-bold text-primary-700 text-center">₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>

      {/* Parked Bills Drawer */}
      <ParkedBillsDrawer
        isOpen={parkedBillsOpen}
        onClose={() => setParkedBillsOpen(false)}
        onResume={handleResumeBill}
      />
    </>
  );
}
