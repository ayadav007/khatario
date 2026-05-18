'use client';

import { useState, useEffect } from 'react';
import { ColumnOption } from '@/components/tables/ColumnSelector';

/**
 * Hook to manage table column visibility
 */
export function useTableColumns(
  columns: ColumnOption[],
  storageKey?: string
) {
  const getDefaultVisible = () => {
    return columns
      .filter(col => col.defaultVisible !== false)
      .map(col => col.id);
  };

  const loadFromStorage = (): string[] | null => {
    if (!storageKey || typeof window === 'undefined') {
      return null;
    }

    try {
      const stored = localStorage.getItem(`table_columns_${storageKey}`);
      if (stored) {
        const parsed = JSON.parse(stored) as string[];
        const valid = parsed.filter(id => columns.some(col => col.id === id));
        if (valid.length > 0) {
          return valid;
        }
      }
    } catch (error) {
      console.error('Failed to load column preferences:', error);
    }
    return null;
  };

  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const stored = loadFromStorage();
    return stored || getDefaultVisible();
  });

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') {
      return;
    }

    try {
      localStorage.setItem(`table_columns_${storageKey}`, JSON.stringify(visibleColumns));
    } catch (error) {
      console.error('Failed to save column preferences:', error);
    }
  }, [visibleColumns, storageKey]);

  return {
    visibleColumns,
    setVisibleColumns,
    isFeatureEnabled: true,
  };
}
