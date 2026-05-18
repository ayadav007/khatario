'use client';

import React, { useState } from 'react';
import { 
  Trash2, Download, Edit, CheckCircle, XCircle, Send, Copy, 
  Archive, MoreHorizontal, X
} from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';


export interface BulkAction {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  variant?: 'default' | 'danger' | 'success';
  onClick: (selectedIds: string[]) => void | Promise<void>;
  confirmMessage?: string;
}

interface BulkActionsBarProps {
  selectedIds: string[];
  totalCount: number;
  onClearSelection: () => void;
  actions: BulkAction[];
  entityName?: string; // e.g., 'invoice', 'customer', 'item'
}

export const BulkActionsBar: React.FC<BulkActionsBarProps> = ({
  selectedIds,
  totalCount,
  onClearSelection,
  actions,
  entityName = 'item',
}) => {
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  const [showMoreActions, setShowMoreActions] = useState(false);

  if (selectedIds.length === 0) {
    return null;
  }

  const handleAction = async (action: BulkAction) => {
    // Show confirmation if required
    if (action.confirmMessage) {
      const confirmed = confirm(
        action.confirmMessage.replace('{count}', selectedIds.length.toString())
      );
      if (!confirmed) return;
    }

    setLoading(true);
    try {
      await action.onClick(selectedIds);
      onClearSelection();
    } catch (error) {
      console.error('Bulk action failed:', error);
      toast.error('Action failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const selectedCount = selectedIds.length;
  const primaryActions = actions.slice(0, 3);
  const moreActions = actions.slice(3);

  return (
    <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 animate-slide-up">
      <div className="bg-primary-600 dark:bg-primary-700 text-white rounded-lg shadow-large px-6 py-4 flex items-center gap-4">
        {/* Selection Count */}
        <div className="flex items-center gap-2 border-r border-primary-500 dark:border-primary-600 pr-4">
          <div className="bg-white text-primary-600 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm">
            {selectedCount}
          </div>
          <span className="font-medium">
            {selectedCount} {entityName}{selectedCount !== 1 ? 's' : ''} selected
          </span>
        </div>

        {/* Primary Actions */}
        <div className="flex items-center gap-2">
          {primaryActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                onClick={() => handleAction(action)}
                disabled={loading}
                className={`
                  flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all
                  ${action.variant === 'danger' 
                    ? 'bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800' 
                    : action.variant === 'success'
                    ? 'bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800'
                    : 'bg-white bg-opacity-20 hover:bg-opacity-30'
                  }
                  disabled:opacity-50 disabled:cursor-not-allowed
                `}
              >
                <Icon className="w-4 h-4" />
                <span>{action.label}</span>
              </button>
            );
          })}

          {/* More Actions Dropdown */}
          {moreActions.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowMoreActions(!showMoreActions)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-white bg-opacity-20 hover:bg-opacity-30 transition-all"
              >
                <MoreHorizontal className="w-4 h-4" />
                <span>More</span>
              </button>

              {showMoreActions && (
                <div className="absolute bottom-full mb-2 right-0 bg-white dark:bg-gray-800 rounded-lg shadow-large py-2 min-w-[200px]">
                  {moreActions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.id}
                        onClick={() => {
                          handleAction(action);
                          setShowMoreActions(false);
                        }}
                        disabled={loading}
                        className="w-full flex items-center gap-3 px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-all disabled:opacity-50"
                      >
                        <Icon className="w-4 h-4" />
                        <span>{action.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Clear Selection */}
        <button
          onClick={onClearSelection}
          className="ml-2 p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-all"
          aria-label="Clear selection"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

// Predefined bulk actions for common use cases
export const COMMON_BULK_ACTIONS = {
  delete: (onDelete: (ids: string[]) => Promise<void>): BulkAction => ({
    id: 'delete',
    label: 'Delete',
    icon: Trash2,
    variant: 'danger',
    onClick: onDelete,
    confirmMessage: 'Are you sure you want to delete {count} item(s)? This action cannot be undone.',
  }),

  export: (onExport: (ids: string[]) => Promise<void>): BulkAction => ({
    id: 'export',
    label: 'Export',
    icon: Download,
    onClick: onExport,
  }),

  markAsPaid: (onMarkPaid: (ids: string[]) => Promise<void>): BulkAction => ({
    id: 'mark-paid',
    label: 'Mark as Paid',
    icon: CheckCircle,
    variant: 'success',
    onClick: onMarkPaid,
  }),

  markAsUnpaid: (onMarkUnpaid: (ids: string[]) => Promise<void>): BulkAction => ({
    id: 'mark-unpaid',
    label: 'Mark as Unpaid',
    icon: XCircle,
    onClick: onMarkUnpaid,
  }),

  send: (onSend: (ids: string[]) => Promise<void>): BulkAction => ({
    id: 'send',
    label: 'Send',
    icon: Send,
    onClick: onSend,
  }),

  duplicate: (onDuplicate: (ids: string[]) => Promise<void>): BulkAction => ({
    id: 'duplicate',
    label: 'Duplicate',
    icon: Copy,
    onClick: onDuplicate,
  }),

  archive: (onArchive: (ids: string[]) => Promise<void>): BulkAction => ({
    id: 'archive',
    label: 'Archive',
    icon: Archive,
    onClick: onArchive,
    confirmMessage: 'Archive {count} item(s)?',
  }),
};
