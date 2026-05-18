'use client';

import React, { useState } from 'react';
import { FileText, Plus, X, Download, Save } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';

interface ReportField {
  id: string;
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'currency';
}

interface ReportBuilderProps {
  businessId: string;
  entityType: 'invoices' | 'customers' | 'items' | 'purchases';
}

const AVAILABLE_FIELDS: Record<string, ReportField[]> = {
  invoices: [
    { id: 'invoice_number', name: 'invoice_number', label: 'Invoice Number', type: 'text' },
    { id: 'customer_name', name: 'customer_name', label: 'Customer', type: 'text' },
    { id: 'invoice_date', name: 'invoice_date', label: 'Date', type: 'date' },
    { id: 'due_date', name: 'due_date', label: 'Due Date', type: 'date' },
    { id: 'grand_total', name: 'grand_total', label: 'Grand Total', type: 'currency' },
    { id: 'status', name: 'status', label: 'Status', type: 'text' },
    { id: 'payment_status', name: 'payment_status', label: 'Payment Status', type: 'text' },
    { id: 'tax_amount', name: 'tax_amount', label: 'Tax Amount', type: 'currency' },
    { id: 'discount_amount', name: 'discount_amount', label: 'Discount', type: 'currency' },
  ],
  customers: [
    { id: 'name', name: 'name', label: 'Name', type: 'text' },
    { id: 'email', name: 'email', label: 'Email', type: 'text' },
    { id: 'phone', name: 'phone', label: 'Phone', type: 'text' },
    { id: 'total_sales', name: 'total_sales', label: 'Total Sales', type: 'currency' },
    { id: 'invoice_count', name: 'invoice_count', label: 'Invoice Count', type: 'number' },
  ],
  items: [
    { id: 'name', name: 'name', label: 'Name', type: 'text' },
    { id: 'sku', name: 'sku', label: 'SKU', type: 'text' },
    { id: 'price', name: 'price', label: 'Price', type: 'currency' },
    { id: 'stock', name: 'stock', label: 'Stock', type: 'number' },
    { id: 'category', name: 'category', label: 'Category', type: 'text' },
  ],
  purchases: [
    { id: 'bill_number', name: 'bill_number', label: 'Bill Number', type: 'text' },
    { id: 'supplier_name', name: 'supplier_name', label: 'Supplier', type: 'text' },
    { id: 'bill_date', name: 'bill_date', label: 'Bill Date', type: 'date' },
    { id: 'due_date', name: 'due_date', label: 'Due Date', type: 'date' },
    { id: 'grand_total', name: 'grand_total', label: 'Grand Total', type: 'currency' },
    { id: 'status', name: 'status', label: 'Status', type: 'text' },
    { id: 'payment_status', name: 'payment_status', label: 'Payment Status', type: 'text' },
  ],
};

export const ReportBuilder: React.FC<ReportBuilderProps> = ({ businessId, entityType }) => {
  const { user } = useAuth();
  const toast = useToastContext();
  const [selectedFields, setSelectedFields] = useState<ReportField[]>([]);
  const [reportName, setReportName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [reportData, setReportData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const availableFields = AVAILABLE_FIELDS[entityType] || [];

  const addField = (field: ReportField) => {
    if (!selectedFields.find(f => f.id === field.id)) {
      setSelectedFields([...selectedFields, field]);
    }
  };

  const removeField = (fieldId: string) => {
    setSelectedFields(selectedFields.filter(f => f.id !== fieldId));
  };

  const generateReport = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          entity_type: entityType,
          fields: selectedFields.map(f => f.name),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setReportData(data.results || []);
      }
    } catch (error) {
      console.error('Failed to generate report:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportReport = () => {
    if (reportData.length === 0) return;

    // Convert to CSV
    const headers = selectedFields.map(f => f.label).join(',');
    const rows = reportData.map(row =>
      selectedFields.map(f => row[f.name] || '').join(',')
    ).join('\n');

    const csv = `${headers}\n${rows}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reportName || 'report'}.csv`;
    a.click();
  };

  const saveReport = async () => {
    try {
      const response = await fetch('/api/reports/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          user_id: user?.id,
          name: reportName,
          entity_type: entityType,
          fields: selectedFields,
        }),
      });
      
      if (response.ok) {
        setShowSaveDialog(false);
        setReportName('');
        toast.success('Report template saved successfully!');
      } else {
        const error = await response.json();
        toast.error('Failed to save report: ' + error.error);
      }
    } catch (error) {
      console.error('Failed to save report:', error);
      toast.error('Failed to save report. Please try again.');
    }
  };

  return (
    <div className="space-y-6">
      <Card className="dark:bg-gray-800">
        <div className="flex items-center gap-3 mb-4">
          <FileText className="w-6 h-6 text-primary-600 dark:text-primary-400" />
          <h2 className="text-xl font-bold dark:text-gray-100">Report Builder</h2>
        </div>

        {/* Field Selection */}
        <div className="grid grid-cols-2 gap-6">
          {/* Available Fields */}
          <div>
            <h3 className="font-semibold mb-3 dark:text-gray-100">Available Fields</h3>
            <div className="space-y-2">
              {availableFields.map((field) => (
                <button
                  key={field.id}
                  onClick={() => addField(field)}
                  disabled={selectedFields.some(f => f.id === field.id)}
                  className="w-full flex items-center justify-between p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <span className="font-medium dark:text-gray-200">{field.label}</span>
                  <Plus className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                </button>
              ))}
            </div>
          </div>

          {/* Selected Fields */}
          <div>
            <h3 className="font-semibold mb-3 dark:text-gray-100">Selected Fields ({selectedFields.length})</h3>
            <div className="space-y-2">
              {selectedFields.map((field, index) => (
                <div
                  key={field.id}
                  className="flex items-center justify-between p-3 bg-slate-50 dark:bg-primary-900 dark:bg-opacity-20 border border-primary-200 dark:border-primary-700 rounded-lg"
                >
                  <span className="font-medium text-primary-900 dark:text-primary-200">
                    {index + 1}. {field.label}
                  </span>
                  <button
                    onClick={() => removeField(field.id)}
                    className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded"
                  >
                    <X className="w-4 h-4 text-red-600 dark:text-red-400" />
                  </button>
                </div>
              ))}

              {selectedFields.length === 0 && (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  No fields selected. Add fields from the left.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 mt-6 pt-6 border-t dark:border-gray-700">
          <Button
            onClick={generateReport}
            disabled={selectedFields.length === 0 || loading}
            className="flex items-center gap-2"
          >
            <FileText className="w-4 h-4" />
            {loading ? 'Generating...' : 'Generate Report'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setShowSaveDialog(true)}
            disabled={selectedFields.length === 0}
            className="flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            Save Template
          </Button>
        </div>
      </Card>

      {/* Report Results */}
      {reportData.length > 0 && (
        <Card className="dark:bg-gray-800">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold dark:text-gray-100">Report Results ({reportData.length} records)</h3>
            <Button
              variant="secondary"
              onClick={exportReport}
              className="flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  {selectedFields.map((field) => (
                    <th key={field.id} className="px-4 py-3 text-left font-semibold dark:text-gray-200">
                      {field.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reportData.map((row, index) => (
                  <tr key={index} className="border-b dark:border-gray-700">
                    {selectedFields.map((field) => (
                      <td key={field.id} className="px-4 py-3 dark:text-gray-300">
                        {row[field.name] || '-'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Save Dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="w-[400px] dark:bg-gray-800">
            <h3 className="text-lg font-semibold mb-4 dark:text-gray-100">Save Report Template</h3>
            <input
              type="text"
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              placeholder="Enter report name..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg mb-4 dark:bg-gray-900 dark:text-gray-200"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSaveDialog(false)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <Button onClick={saveReport} disabled={!reportName.trim()}>
                Save
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
