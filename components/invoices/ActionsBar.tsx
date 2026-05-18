'use client';

import React from 'react';
import { Button } from '@/components/ui/Button';
import { Eye, Save, Send, Printer, Download } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface ActionsBarProps {
  // Handlers
  onPreview: () => void;
  onSaveDraft: () => void;
  onSaveFinal: () => void;
  onShare: () => void;
  
  // Loading states
  previewLoading: boolean;
  saving: boolean;
  
  // Display flags
  isFinal: boolean;
  isOnline: boolean;
  
  // Saved invoice info
  savedInvoiceId: string | null;
  invoicePrefix: string | null;
  invoiceNumber: string | null;
  isSeriesResolved?: boolean; // PHASE 3: Block save until series is resolved

  /** Optional: show a compact credit-limit summary (customer invoices) */
  credit?: {
    availableCredit: number | null;
    creditLimit: number;
  } | null;
}

const ActionsBar = React.memo(function ActionsBar({
  onPreview,
  onSaveDraft,
  onSaveFinal,
  onShare,
  previewLoading,
  saving,
  isFinal,
  isOnline,
  savedInvoiceId,
  invoicePrefix,
  invoiceNumber,
  isSeriesResolved = true, // PHASE 3: Default to true for backward compatibility
  credit = null,
}: ActionsBarProps) {
  const { user } = useAuth();
  const handlePrint = () => {
    if (savedInvoiceId) {
      window.open(`/api/invoices/${savedInvoiceId}/pdf?user_id=${user?.id}`, '_blank');
    }
  };

  const handleDownload = () => {
    if (savedInvoiceId) {
      const url = `/api/invoices/${savedInvoiceId}/pdf?user_id=${user?.id}`;
      const link = document.createElement('a');
      link.href = url;
      link.download = `${invoicePrefix}-${invoiceNumber}.pdf`;
      link.click();
    }
  };

  return (
    <div className="lg:col-span-1 flex flex-col gap-3">
      {!isFinal && (
        <>
          <Button variant="secondary" className="w-full justify-center" onClick={onPreview} isLoading={previewLoading} disabled={previewLoading}>
            <Eye className="w-4 h-4 mr-2" /> Preview
          </Button>
          <Button 
            variant="secondary" 
            className="w-full justify-center" 
            onClick={onSaveDraft} 
            isLoading={saving}
            disabled={!isSeriesResolved} // PHASE 3: Block save until series is resolved
            title={!isSeriesResolved ? 'Document number is not ready' : ''}
          >
            <Save className="w-4 h-4 mr-2" /> Save as Draft
          </Button>
          <div className="flex flex-col gap-1 flex-1">
            <Button 
              variant="primary" 
              className="w-full justify-center" 
              onClick={onSaveFinal} 
              isLoading={saving}
              disabled={!isOnline || !isSeriesResolved} // PHASE 3: Block save until series is resolved
              title={!isSeriesResolved ? 'Document number is not ready' : (!isOnline ? 'Sync required' : '')}
            >
              <Send className="w-4 h-4 mr-2" /> {isOnline ? 'Save & Send' : 'Sync Required'}
            </Button>
            {credit && credit.creditLimit > 0 && credit.availableCredit !== null && (
              <div className="mt-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-green-800">Available Credit Limit:</div>
                  <div className="text-sm font-bold tabular-nums text-green-900">
                    ₹{Math.max(0, credit.availableCredit).toLocaleString('en-IN')}
                  </div>
                </div>
                <div className="mt-0.5 text-[11px] text-green-700">
                  Total credit limit: ₹{credit.creditLimit.toLocaleString('en-IN')}
                </div>
              </div>
            )}
            <p className="text-[10px] text-center text-amber-700 dark:text-amber-300">
              {isOnline ? '⚠️ This will affect GST filing' : '⚠️ Offline: Sync to file GST'}
            </p>
          </div>
        </>
      )}
      {savedInvoiceId && (
        <>
          <Button variant="secondary" className="justify-center border border-border" onClick={handlePrint}>
            <Printer className="w-4 h-4 mr-2" /> Print
          </Button>
          <Button variant="secondary" className="justify-center border border-gray-300" onClick={handleDownload}>
            <Download className="w-4 h-4 mr-2" /> Download PDF
          </Button>
          {isFinal && (
            <Button variant="secondary" className="justify-center border border-border" onClick={onShare}>
              <Send className="w-4 h-4 mr-2" /> Share
            </Button>
          )}
        </>
      )}
    </div>
  );
});

export default ActionsBar;

