'use client';

import React, { useState } from 'react';
import { X, Copy, Check, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface CopyTemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  template: {
    id: string;
    name: string;
    color: string;
  };
  currentDocType: string;
  onCopy: (targetDocTypes: string[]) => Promise<void>;
}

const DOCUMENT_TYPES = [
  { id: 'tax_invoice', label: 'Tax Invoice', icon: '📄' },
  { id: 'proforma_invoice', label: 'Proforma Invoice', icon: '📋' },
  { id: 'bill_of_supply', label: 'Bill of Supply', icon: '🧾' },
  { id: 'credit_note', label: 'Credit Note', icon: '🔴' },
  { id: 'debit_note', label: 'Debit Note', icon: '🟠' },
  { id: 'delivery_challan', label: 'Delivery Challan', icon: '🚚' },
  { id: 'sales_order', label: 'Sales Order', icon: '📦' },
  { id: 'purchase_order', label: 'Purchase Order', icon: '🛒' },
  { id: 'payment_receipt', label: 'Payment Receipt', icon: '💰' },
];

export const CopyTemplateDialog: React.FC<CopyTemplateDialogProps> = ({
  isOpen,
  onClose,
  template,
  currentDocType,
  onCopy
}) => {
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleToggle = (docTypeId: string) => {
    if (docTypeId === currentDocType) return; // Can't copy to itself
    
    setSelectedTypes(prev => 
      prev.includes(docTypeId)
        ? prev.filter(id => id !== docTypeId)
        : [...prev, docTypeId]
    );
  };

  const handleSelectAll = () => {
    const availableTypes = DOCUMENT_TYPES
      .map(dt => dt.id)
      .filter(id => id !== currentDocType);
    
    setSelectedTypes(prev => 
      prev.length === availableTypes.length ? [] : availableTypes
    );
  };

  const handleCopy = async () => {
    if (selectedTypes.length === 0) {
      setError('Please select at least one document type');
      return;
    }

    setError(null);
    setCopying(true);

    try {
      await onCopy(selectedTypes);
      onClose();
    } catch (err) {
      setError('Failed to copy template. Please try again.');
      console.error('Copy error:', err);
    } finally {
      setCopying(false);
    }
  };

  const availableTypes = DOCUMENT_TYPES.filter(dt => dt.id !== currentDocType);

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity"
        onClick={onClose}
      />
      
      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div 
          className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl pointer-events-auto transform transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div className="flex items-center gap-4">
              <div 
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `${template.color}20` }}
              >
                <Copy className="w-6 h-6" style={{ color: template.color }} />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Copy Template Settings</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Apply "{template.name}" to other document types
                </p>
              </div>
            </div>
            
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <X className="w-6 h-6 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            {/* Info Box */}
            <div className="mb-6 p-4 bg-slate-50 border border-primary-200 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-primary-900">
                <p className="font-semibold mb-1">What gets copied:</p>
                <ul className="list-disc list-inside space-y-0.5 text-primary-800">
                  <li>Template design and layout</li>
                  <li>Color scheme and fonts</li>
                  <li>Field visibility settings</li>
                  <li>Customizations (margins, logos, etc.)</li>
                </ul>
              </div>
            </div>

            {/* Select All Toggle */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900">
                Select Document Types ({selectedTypes.length} selected)
              </h3>
              <button
                onClick={handleSelectAll}
                className="text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                {selectedTypes.length === availableTypes.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            {/* Document Type Grid */}
            <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto">
              {DOCUMENT_TYPES.map((docType) => {
                const isCurrentType = docType.id === currentDocType;
                const isSelected = selectedTypes.includes(docType.id);

                return (
                  <button
                    key={docType.id}
                    onClick={() => handleToggle(docType.id)}
                    disabled={isCurrentType}
                    className={`
                      relative p-4 rounded-xl border-2 transition-all text-left
                      ${isCurrentType 
                        ? 'bg-gray-100 border-gray-300 cursor-not-allowed opacity-50'
                        : isSelected
                          ? 'bg-slate-50 border-primary-500 shadow-md'
                          : 'bg-white border-gray-200 hover:border-primary-300 hover:bg-gray-50'
                      }
                    `}
                  >
                    {isSelected && !isCurrentType && (
                      <div className="absolute top-2 right-2 w-6 h-6 bg-primary-600 rounded-full flex items-center justify-center">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                    
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{docType.icon}</span>
                      <div className="flex-1">
                        <p className={`font-semibold text-sm ${isSelected && !isCurrentType ? 'text-primary-900' : 'text-gray-900'}`}>
                          {docType.label}
                        </p>
                        {isCurrentType && (
                          <p className="text-xs text-gray-500 mt-0.5">Current template</p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Error Message */}
            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-800">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50">
            <p className="text-sm text-gray-600">
              {selectedTypes.length} document type{selectedTypes.length !== 1 ? 's' : ''} selected
            </p>
            
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={onClose}
                disabled={copying}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleCopy}
                disabled={copying || selectedTypes.length === 0}
              >
                {copying ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Copying...
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy to {selectedTypes.length} Type{selectedTypes.length !== 1 ? 's' : ''}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

