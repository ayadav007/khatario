'use client';

import { useState, useCallback, useMemo } from 'react';

export interface BulkSelectionState {
  selectedIds: string[];
  isAllSelected: boolean;
  isIndeterminate: boolean;
  toggleItem: (id: string) => void;
  toggleAll: (allIds: string[]) => void;
  clearSelection: () => void;
  selectMultiple: (ids: string[]) => void;
  isSelected: (id: string) => boolean;
}

/**
 * Hook for managing bulk selection state in tables
 */
export function useBulkSelection(): BulkSelectionState {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const toggleItem = useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((selectedId) => selectedId !== id);
      } else {
        return [...prev, id];
      }
    });
  }, []);

  const toggleAll = useCallback((allIds: string[]) => {
    setSelectedIds((prev) => {
      if (prev.length === allIds.length) {
        return []; // Deselect all
      } else {
        return allIds; // Select all
      }
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const selectMultiple = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const newIds = [...prev];
      for (const id of ids) {
        if (!newIds.includes(id)) {
          newIds.push(id);
        }
      }
      return newIds;
    });
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedIds.includes(id),
    [selectedIds]
  );

  const isAllSelected = useMemo(
    () => selectedIds.length > 0,
    [selectedIds.length]
  );

  const isIndeterminate = useMemo(
    () => selectedIds.length > 0 && !isAllSelected,
    [selectedIds.length, isAllSelected]
  );

  return {
    selectedIds,
    isAllSelected,
    isIndeterminate,
    toggleItem,
    toggleAll,
    clearSelection,
    selectMultiple,
    isSelected,
  };
}
