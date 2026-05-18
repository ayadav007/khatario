'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Clock, Trash2, FileText } from 'lucide-react';
import { getParkedBills, deleteParkedBill, ParkedBill } from '@/lib/pos-settings';
import { format } from 'date-fns';

interface ParkedBillsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onResume: (bill: ParkedBill) => void;
}

export function ParkedBillsDrawer({ isOpen, onClose, onResume }: ParkedBillsDrawerProps) {
  const [bills, setBills] = useState<ParkedBill[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setBills(getParkedBills());
      setSelectedIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, bills.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && bills[selectedIndex]) {
        e.preventDefault();
        onResume(bills[selectedIndex]);
      } else if (e.key === 'Delete' && bills[selectedIndex]) {
        e.preventDefault();
        if (confirm('Delete this parked bill?')) {
          deleteParkedBill(bills[selectedIndex].id);
          const updated = getParkedBills();
          setBills(updated);
          if (selectedIndex >= updated.length) {
            setSelectedIndex(Math.max(0, updated.length - 1));
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, bills, selectedIndex, onClose, onResume]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[10000] flex items-end lg:items-center lg:justify-center">
      <div className="bg-white rounded-t-2xl lg:rounded-2xl w-full lg:max-w-2xl max-h-[80vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-gray-600" />
            <h2 className="text-lg font-bold text-gray-900">Parked Bills ({bills.length})</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Bills List */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-2">
          {bills.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No parked bills</p>
            </div>
          ) : (
            bills.map((bill, index) => (
              <div
                key={bill.id}
                onClick={() => onResume(bill)}
                className={`
                  p-4 rounded-lg border-2 cursor-pointer transition-all
                  ${selectedIndex === index 
                    ? 'border-primary-500 bg-slate-50 shadow-md' 
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }
                `}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-gray-900">{bill.invoiceNumber}</span>
                      <span className="text-xs text-gray-500">
                        {format(new Date(bill.timestamp), 'HH:mm')}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 space-y-1">
                      <div>₹{bill.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                      <div>{bill.itemCount} items</div>
                      {bill.customerName && (
                        <div className="text-xs text-gray-500">{bill.customerName}</div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('Delete this parked bill?')) {
                        deleteParkedBill(bill.id);
                        const updated = getParkedBills();
                        setBills(updated);
                        if (selectedIndex >= updated.length) {
                          setSelectedIndex(Math.max(0, updated.length - 1));
                        }
                      }
                    }}
                    className="p-2 hover:bg-red-50 rounded-lg text-red-600 transition"
                    title="Delete (Del)"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {selectedIndex === index && (
                  <div className="mt-2 text-xs text-primary-600 font-medium">
                    Press Enter to resume • Del to delete
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 text-xs text-gray-500">
          <div className="flex items-center justify-between">
            <span>↑ ↓ Navigate • Enter Resume • Del Delete • Esc Close</span>
            <span>Ctrl+B to open</span>
          </div>
        </div>
      </div>
    </div>
  );
}
