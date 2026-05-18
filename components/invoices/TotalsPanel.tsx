'use client';

import React from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CreditCard, Plus, Trash2 } from 'lucide-react';

interface ExtraCharge {
  id: string;
  purpose: string;
  amount: number;
}

interface TotalsPanelProps {
  /** Optional wrapper classes (e.g. mobile full-width) */
  className?: string;
  // Totals values (from memoized calculation)
  itemSubtotal: number;
  totalDiscount: number;
  subtotal: number;
  totalExtraCharges: number;
  taxableAmount: number;
  totalCGST: number;
  totalSGST: number;
  totalIGST: number;
  grandTotal: number;
  totalPaid: number;
  balance: number;
  recordPayment: boolean;
  roundOff?: number;
  
  // Round off toggle
  enableRoundOff?: boolean;
  onEnableRoundOffChange?: (enabled: boolean) => void;
  
  // Extra charges management
  extraCharges: ExtraCharge[];
  onExtraChargesChange: (charges: ExtraCharge[]) => void;
  onAddExtraCharge: () => void;
  
  // Payment
  onPaymentClick: () => void;
  
  // Display flags
  isFinal: boolean;
  documentType: string;
  isExport: boolean;
  isIntraState: boolean;
}

const TotalsPanel = React.memo(function TotalsPanel({
  className = '',
  itemSubtotal,
  totalDiscount,
  subtotal,
  totalExtraCharges,
  taxableAmount,
  totalCGST,
  totalSGST,
  totalIGST,
  grandTotal,
  totalPaid,
  balance,
  recordPayment,
  roundOff = 0,
  enableRoundOff = false,
  onEnableRoundOffChange,
  extraCharges,
  onExtraChargesChange,
  onAddExtraCharge,
  onPaymentClick,
  isFinal,
  documentType,
  isExport,
  isIntraState,
}: TotalsPanelProps) {
  return (
    <div className={`lg:col-span-1 flex flex-col gap-3 ${className}`}>
      <div className="bg-surface rounded-lg border border-border p-4 shadow-sm space-y-2 text-sm flex-1">
        <div className="flex justify-between text-text-primary"><span>Item Subtotal</span><span>₹ {itemSubtotal.toFixed(2)}</span></div>
        {totalDiscount > 0 && (
          <div className="flex justify-between text-red-600 dark:text-red-400"><span>Discount</span><span>- ₹ {totalDiscount.toFixed(2)}</span></div>
        )}
        <div className="flex justify-between text-text-primary"><span>Subtotal</span><span>₹ {subtotal.toFixed(2)}</span></div>
        
        {/* Extra Charges */}
        {extraCharges.length > 0 && (
          <>
            {extraCharges.map((charge) => (
              <div key={charge.id} className="flex justify-between text-sm text-text-primary">
                <span>{charge.purpose || 'Extra Charge'}</span>
                <span>₹ {charge.amount.toFixed(2)}</span>
              </div>
            ))}
          </>
        )}
        
        {!isFinal && (
          <button
            type="button"
            onClick={onAddExtraCharge}
            className="flex items-center gap-2 text-primary-600 dark:text-sky-400 text-sm font-medium hover:text-primary-700 dark:hover:text-sky-300 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Extra Charges
          </button>
        )}
        
        {extraCharges.length > 0 && (
          <div className="border-t border-dashed my-2 pt-2 space-y-2">
            {extraCharges.map((charge, idx) => (
              <div key={charge.id} className="flex gap-2 items-center">
                <Input
                  type="text"
                  placeholder="Purpose (e.g., Packaging, Delivery)"
                  value={charge.purpose}
                  onChange={(e) => {
                    const updated = [...extraCharges];
                    updated[idx].purpose = e.target.value;
                    onExtraChargesChange(updated);
                  }}
                  className="text-sm flex-1"
                  disabled={isFinal}
                />
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Amount"
                  value={charge.amount || ''}
                  onChange={(e) => {
                    const updated = [...extraCharges];
                    updated[idx].amount = Number(e.target.value) || 0;
                    onExtraChargesChange(updated);
                  }}
                  className="text-sm w-24"
                  disabled={isFinal}
                />
                {!isFinal && (
                  <button
                    type="button"
                    onClick={() => onExtraChargesChange(extraCharges.filter((_, i) => i !== idx))}
                    className="text-text-muted hover:text-red-500 dark:hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        
        {totalExtraCharges > 0 && (
          <div className="flex justify-between font-semibold text-primary-600 dark:text-primary-300">
            <span>Total Extra Charges</span>
            <span>₹ {totalExtraCharges.toFixed(2)}</span>
          </div>
        )}
        
        <div className="flex justify-between font-semibold text-text-primary"><span>Taxable Amount</span><span>₹ {taxableAmount.toFixed(2)}</span></div>
        {/* Hide GST breakdown for Bill of Supply */}
        {documentType !== 'bill_of_supply' && (
          <>
            {/* For export invoices, always show IGST; otherwise show CGST/SGST for intra-state, IGST for inter-state */}
            {isExport || !isIntraState ? (
              <>{totalIGST > 0 && <div className="flex justify-between text-xs text-text-secondary"><span>IGST</span><span>₹ {totalIGST.toFixed(2)}</span></div>}</>
            ) : (
              <>
                {totalCGST > 0 && <div className="flex justify-between text-xs text-text-secondary"><span>CGST</span><span>₹ {totalCGST.toFixed(2)}</span></div>}
                {totalSGST > 0 && <div className="flex justify-between text-xs text-text-secondary"><span>SGST</span><span>₹ {totalSGST.toFixed(2)}</span></div>}
              </>
            )}
          </>
        )}
        
        {/* Round Off Toggle */}
        {!isFinal && onEnableRoundOffChange && (
          <div className="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              checked={enableRoundOff}
              onChange={(e) => onEnableRoundOffChange(e.target.checked)}
              disabled={isFinal}
              className="w-4 h-4 text-primary-600 rounded border-border dark:border-slate-500 bg-surface focus:ring-primary-500"
            />
            <label className="text-sm text-text-secondary">Enable Round Off</label>
          </div>
        )}
        
        {roundOff !== 0 && (
          <div className="flex justify-between text-xs text-text-secondary">
            <span>Round Off</span>
            <span className={roundOff > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
              {roundOff > 0 ? '+' : ''}₹ {roundOff.toFixed(2)}
            </span>
          </div>
        )}
        <div className="flex justify-between font-bold text-lg pt-2 border-t border-border text-text-primary"><span>Total</span><span>₹ {grandTotal.toFixed(2)}</span></div>
        {recordPayment && (
          <>
            <div className="flex justify-between text-green-600 dark:text-green-400 pt-2 text-xs"><span>Paid</span><span>₹ {totalPaid.toFixed(2)}</span></div>
            <div className="flex justify-between text-red-600 dark:text-red-400 font-medium pt-1 border-t border-dashed border-border text-xs"><span>Balance</span><span>₹ {balance.toFixed(2)}</span></div>
          </>
        )}
      </div>
      {/* Record Payment button - Hidden for proforma invoices */}
      {documentType !== 'proforma_invoice' && (
        <Button type="button" variant="secondary" onClick={onPaymentClick} disabled={isFinal} className="w-full">
          <CreditCard className="w-4 h-4 mr-2" />
          {recordPayment ? `Payment: ₹${totalPaid.toFixed(2)}` : 'Record Payment'}
          <span className="ml-auto text-xs opacity-60">Ctrl+P</span>
        </Button>
      )}
    </div>
  );
});

export default TotalsPanel;

