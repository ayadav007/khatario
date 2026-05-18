'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Trash2, Download, Mail, FileText, MoreVertical, X } from 'lucide-react';


export interface BulkAction {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: (selectedIds: string[]) => void | Promise<void>;
  variant?: 'default' | 'destructive';
}

interface BulkActionsProps {
  selectedIds: string[];
  actions: BulkAction[];
  onClearSelection: () => void;
}

export const BulkActions: React.FC<BulkActionsProps> = ({
  selectedIds,
  actions,
  onClearSelection,
}) => {
  const [showMenu, setShowMenu] = useState(false);

  if (selectedIds.length === 0) {
    return null;
  }

  const handleAction = async (action: BulkAction) => {
    try {
      await action.onClick(selectedIds);
      setShowMenu(false);
    } catch (error) {
      console.error('Bulk action failed:', error);
    }
  };

  return (
    <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 flex items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">
          {selectedIds.length} selected
        </span>
        <button
          onClick={onClearSelection}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
        >
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      <div className="h-6 w-px bg-gray-300" />

      <div className="flex items-center gap-2">
        {actions.slice(0, 3).map((action) => {
          const Icon = action.icon;
          return (
            <Button
              key={action.id}
              variant={action.variant || 'outline'}
              size="sm"
              onClick={() => handleAction(action)}
              className="flex items-center gap-1"
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{action.label}</span>
            </Button>
          );
        })}

        {actions.length > 3 && (
          <div className="relative">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowMenu(!showMenu)}
            >
              <MoreVertical className="w-4 h-4" />
            </Button>

            {showMenu && (
              <div className="absolute bottom-full right-0 mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
                {actions.slice(3).map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.id}
                      onClick={() => handleAction(action)}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left hover:bg-gray-50"
                    >
                      <Icon className="w-4 h-4" />
                      {action.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

