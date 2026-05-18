'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getPosMode, saveParkedBill, getParkedBills, ParkedBill } from '@/lib/pos-settings';
import { ParkedBillsDrawer } from './ParkedBillsDrawer';
import { POSPaymentInputs } from './POSPaymentInputs';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Printer, Save, Clock, Phone, UserPlus, Loader2, X, Bluetooth } from 'lucide-react';
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
  // Focus management
  itemSearchInputRef?: React.RefObject<HTMLInputElement>;
  // Item count for disabling PRINT BILL
  itemCount: number;
  // Loading state
  isPrinting?: boolean;
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
  itemSearchInputRef,
  itemCount,
  isPrinting = false,
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
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        // Allow Ctrl/Cmd combinations and F6
        if (!e.ctrlKey && !e.metaKey && e.key !== 'F6') return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault();
        handleParkBill();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        setParkedBillsOpen(true);
      } else if (e.key === 'F6') {
        e.preventDefault();
        // Calculate canPrint inline for keyboard shortcut
        const totalPaid = sumPaymentsRupee(payments);
        const canPrint = itemCount > 0 && paymentCoversGrandTotal(totalPaid, grandTotal);
        // Only print if conditions are met
        if (canPrint && !isPrinting) {
          handlePrintBill();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [posMode, handleParkBill, handlePrintBill, payments, itemCount, grandTotal, isPrinting]);

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
      {/* POS Top Bar - Compact Single Row */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        {/* LEFT: Invoice Number & Date */}
        <div className="flex items-center gap-6">
          <div>
            <div className="text-[10px] text-gray-500 uppercase">Invoice</div>
            <div className="font-bold text-sm text-gray-900">{invoiceNumber || 'New'}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 uppercase">Date</div>
            <div className="font-medium text-sm text-gray-700">{format(new Date(invoiceDate), 'dd-MM-yyyy')}</div>
          </div>
        </div>

        {/* CENTER: Phone Number Input & Customer Name */}
        <div className="flex items-center gap-4 flex-1 justify-center max-w-2xl">
          <div className="relative w-64">
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type="tel"
                value={phoneSearchQuery}
                onChange={(e) => handlePhoneChange(e.target.value)}
                placeholder="Enter phone number"
                className="pl-10 pr-8 h-9 text-sm"
                autoFocus={!phoneSearchQuery}
              />
              {phoneSearchQuery && (
                <button
                  onClick={() => handlePhoneChange('')}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 hover:bg-gray-100 rounded"
                  type="button"
                >
                  <X className="w-3 h-3 text-gray-400" />
                </button>
              )}
              {phoneSearching && (
                <Loader2 className="absolute right-8 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
              )}
              {/* Search Results Dropdown */}
              {phoneSearchOpen && phoneSearchResults.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
                  {phoneSearchResults.map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => handleCustomerSelect(customer)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                    >
                      <div className="font-medium text-sm text-gray-900">{customer.name || 'Unnamed'}</div>
                      <div className="text-xs text-gray-500">{customer.phone}</div>
                    </button>
                  ))}
                </div>
              )}
              {/* No results - show create option */}
              {phoneSearchOpen && phoneSearchResults.length === 0 && phoneSearchQuery.length >= 3 && !phoneSearching && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg p-3">
                  <div className="text-sm text-gray-600 mb-2">No customer found</div>
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
                    <UserPlus className="w-4 h-4 mr-2" />
                    Create Customer
                  </Button>
                </div>
              )}
            </div>
          </div>
          {/* Customer Name Display (Read-only) */}
          <div className="w-48">
            <div className="text-[10px] text-gray-500 uppercase">Customer</div>
            <div className="font-medium text-sm text-gray-700">{customerName || 'Cash Sale'}</div>
          </div>
        </div>

        {/* RIGHT: Park Bill & Parked Bills */}
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleParkBill}
            className="flex items-center gap-1.5 h-8 text-xs"
          >
            <Save className="w-3.5 h-3.5" />
            Park
            <span className="text-[10px] opacity-70">(Ctrl+H)</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setParkedBillsOpen(true)}
            className="flex items-center gap-1.5 h-8 text-xs"
          >
            <Clock className="w-3.5 h-3.5" />
            Parked ({parkedBillsCount})
            <span className="text-[10px] opacity-70">(Ctrl+B)</span>
          </Button>
        </div>
      </div>

      {/* POS Two-Column Layout */}
      <div className="flex gap-4 h-[calc(100vh-60px)]">
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
          <div className="mt-4">
            <Button
              variant="primary"
              size="lg"
              onClick={handlePrintBill}
              disabled={!canPrint || isPrinting}
              isLoading={isPrinting}
              className="w-full h-16 text-lg font-bold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Printer className="w-5 h-5 mr-2" />
              {isPrinting ? 'PRINTING...' : 'PRINT BILL'}
              <span className="text-[10px] opacity-70 ml-2">(F6)</span>
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
                      ? 'Pair a printer in Settings → Bluetooth Printer first'
                      : 'Automatically send receipt to the default Bluetooth printer after each save'
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
                      ? 'Pair a printer in Settings → Bluetooth Printer first'
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
              {!bluetooth.supported && (
                <p className="text-[11px] text-gray-500 text-center">
                  Browser has no Bluetooth support
                </p>
              )}
              {bluetooth.supported && bluetooth.pairedCount === 0 && (
                <p className="text-[11px] text-gray-500 text-center">
                  Pair a printer in Settings → Bluetooth Printer
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
            <span className="text-[28px] text-gray-500 uppercase font-semibold">Items</span>
            <span className="text-[36px] font-bold text-gray-900 text-center">{itemRows.filter(r => r.itemId && r.name).length}</span>
          </div>
          {/* Subtotal */}
          <div className="flex flex-col items-center">
            <span className="text-[28px] text-gray-500 uppercase font-semibold">Subtotal</span>
            <span className="text-[36px] font-bold text-gray-900 text-center">₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          {/* Total Tax */}
          <div className="flex flex-col items-center">
            <span className="text-[28px] text-gray-500 uppercase font-semibold">Total Tax</span>
            <span className="text-[36px] font-bold text-gray-900 text-center">₹{totalTax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          {/* Grand Total - Most Prominent */}
          <div className="flex flex-col items-center ml-auto">
            <span className="text-[28px] text-gray-500 uppercase font-semibold">Grand Total</span>
            <span className="text-[36px] font-bold text-primary-700 text-center">₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
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
