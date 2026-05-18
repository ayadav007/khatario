'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'khatario_global_todo_schedule_rail';
/** Legacy: per-page calendar toggle from earlier implementation */
const LEGACY_PAGE_KEY = 'khatario_todo_show_calendar';

type TodoScheduleRailContextValue = {
  /** Global right-rail schedule (calendar + day list) visible */
  visible: boolean;
  setVisible: (next: boolean) => void;
  /** Increment to ask the rail to refetch the current month */
  refreshNonce: number;
  bumpRefresh: () => void;
};

const TodoScheduleRailContext = createContext<TodoScheduleRailContextValue | null>(null);

export function TodoScheduleRailProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisibleState] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    try {
      const next = localStorage.getItem(STORAGE_KEY);
      if (next !== null) {
        setVisibleState(next !== 'false');
        return;
      }
      const legacy = localStorage.getItem(LEGACY_PAGE_KEY);
      if (legacy === 'false') {
        setVisibleState(false);
        localStorage.setItem(STORAGE_KEY, 'false');
      }
    } catch {
      /* ignore */
    }
  }, []);

  const setVisible = useCallback((next: boolean) => {
    setVisibleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, []);

  const bumpRefresh = useCallback(() => {
    setRefreshNonce((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({ visible, setVisible, refreshNonce, bumpRefresh }),
    [visible, setVisible, refreshNonce, bumpRefresh]
  );

  return (
    <TodoScheduleRailContext.Provider value={value}>{children}</TodoScheduleRailContext.Provider>
  );
}

export function useTodoScheduleRail(): TodoScheduleRailContextValue {
  const ctx = useContext(TodoScheduleRailContext);
  if (!ctx) {
    throw new Error('useTodoScheduleRail must be used within TodoScheduleRailProvider');
  }
  return ctx;
}
