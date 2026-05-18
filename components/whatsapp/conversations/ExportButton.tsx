'use client';

import React, { useState } from 'react';
import { Download, Loader2, FileSpreadsheet, FileText } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Toast } from '@/components/ui/Toast';

interface ExportButtonProps {
  businessId: string;
  conversationId?: string; // If provided, exports single conversation; otherwise exports list
  filters?: Record<string, any>; // Filters for list export
  disabled?: boolean;
}

export function ExportButton({ businessId, conversationId, filters = {}, disabled }: ExportButtonProps) {
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'excel'>('csv');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);

  const handleExport = async (format: 'csv' | 'excel') => {
    if (!businessId) return;

    setExporting(true);
    setExportFormat(format);

    try {
      const endpoint = conversationId
        ? `/api/whatsapp/conversations/${conversationId}/export`
        : '/api/whatsapp/conversations/export';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          format,
          ...(conversationId ? {} : { filters })
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Export failed');
      }

      // Get filename from Content-Disposition header or generate one
      const contentDisposition = response.headers.get('Content-Disposition');
      const filename = contentDisposition
        ? contentDisposition.split('filename=')[1]?.replace(/"/g, '')
        : conversationId
        ? `conversation-${conversationId}.${format === 'excel' ? 'xlsx' : 'csv'}`
        : `conversations.${format === 'excel' ? 'xlsx' : 'csv'}`;

      // Download file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error: any) {
      console.error('Export error:', error);
      setToast({ message: error.message || 'Failed to export. Please try again.', type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
    <div className="relative group">
      <Button
        onClick={() => {
          // Toggle format on click, or show dropdown
          handleExport(exportFormat);
        }}
        disabled={disabled || exporting}
        size="sm"
        variant="secondary"
      >
        {exporting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Exporting...
          </>
        ) : (
          <>
            <Download className="w-4 h-4 mr-2" />
            Export
          </>
        )}
      </Button>

      {/* Format selector dropdown */}
      {!exporting && (
        <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 hidden group-hover:block">
          <button
            onClick={() => handleExport('csv')}
            className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-sm"
          >
            <FileText className="w-4 h-4" />
            Export as CSV
          </button>
          <button
            onClick={() => handleExport('excel')}
            className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-sm border-t border-gray-200"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Export as Excel
          </button>
        </div>
      )}
    </div>
    {toast && (
      <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
    )}
    </>
  );
}

