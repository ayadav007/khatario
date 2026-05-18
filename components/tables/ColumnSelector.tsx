'use client';

import React, { useState } from 'react';
import { Settings, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';


export interface ColumnOption {
  id: string;
  label: string;
  defaultVisible?: boolean;
}

interface ColumnSelectorProps {
  columns: ColumnOption[];
  visibleColumns: string[];
  onColumnsChange: (visibleIds: string[]) => void;
  storageKey?: string;
}

export const ColumnSelector: React.FC<ColumnSelectorProps> = ({
  columns,
  visibleColumns,
  onColumnsChange,
  storageKey,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleToggleColumn = (columnId: string) => {
    const newVisible = visibleColumns.includes(columnId)
      ? visibleColumns.filter(id => id !== columnId)
      : [...visibleColumns, columnId];
    
    onColumnsChange(newVisible);
    
    // Save to localStorage
    if (storageKey && typeof window !== 'undefined') {
      try {
        localStorage.setItem(`table_columns_${storageKey}`, JSON.stringify(newVisible));
      } catch (error) {
        console.error('Failed to save column preferences:', error);
      }
    }
  };

  const handleReset = () => {
    const defaultVisible = columns
      .filter(col => col.defaultVisible !== false)
      .map(col => col.id);
    onColumnsChange(defaultVisible);
    
    if (storageKey && typeof window !== 'undefined') {
      try {
        localStorage.setItem(`table_columns_${storageKey}`, JSON.stringify(defaultVisible));
      } catch (error) {
        console.error('Failed to save column preferences:', error);
      }
    }
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2"
      >
        <Settings className="w-4 h-4" />
        <span className="hidden sm:inline">Columns</span>
      </Button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm text-gray-900">Show Columns</h3>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 hover:bg-gray-100 rounded transition-colors"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>
            <div className="p-2 max-h-96 overflow-y-auto">
              {columns.map((column) => {
                const isVisible = visibleColumns.includes(column.id);
                return (
                  <button
                    key={column.id}
                    onClick={() => handleToggleColumn(column.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-gray-50 rounded transition-colors"
                  >
                    <div className={`w-4 h-4 border-2 rounded flex items-center justify-center ${
                      isVisible ? 'bg-primary-500 border-primary-500' : 'border-gray-300'
                    }`}>
                      {isVisible && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <span className="flex-1">{column.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="p-3 border-t border-gray-200">
              <button
                onClick={handleReset}
                className="w-full text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                Reset to Default
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

