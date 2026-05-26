'use client';

import React, { createContext, useContext, useCallback } from 'react';
import { useToast } from '@/hooks/useToast';
import { ToastContainer } from '@/components/ui/ToastContainer';
import { shouldSuppressOfflineToast } from '@/lib/network/errors';

interface ToastContextType {
  showToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info', duration?: number, action?: { label: string; onClick: () => void }) => string | undefined;
  success: (message: string, action?: { label: string; onClick: () => void }) => string | undefined;
  error: (message: string, action?: { label: string; onClick: () => void }) => string | undefined;
  warning: (message: string, action?: { label: string; onClick: () => void }) => string | undefined;
  info: (message: string, action?: { label: string; onClick: () => void }) => string | undefined;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { toasts, showToast, removeToast, success, error, warning, info } = useToast();

  const guardedError = useCallback(
    (message: string, action?: { label: string; onClick: () => void }) => {
      if (shouldSuppressOfflineToast(message)) return undefined;
      return error(message, action);
    },
    [error]
  );

  const guardedWarning = useCallback(
    (message: string, action?: { label: string; onClick: () => void }) => {
      if (shouldSuppressOfflineToast(message)) return undefined;
      return warning(message, action);
    },
    [warning]
  );

  const contextValue: ToastContextType = {
    showToast: (message, type, duration, action) => showToast(message, type, duration, action),
    success: (message, action) => success(message, action),
    error: guardedError,
    warning: guardedWarning,
    info: (message, action) => info(message, action),
  };

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToastContext() {
  const context = useContext(ToastContext);
  if (!context) {
    // Fallback if context not available
    return {
      showToast: (message: string) => { alert(message); return ''; },
      success: (message: string) => { alert(message); return ''; },
      error: (message: string) => { alert(message); return ''; },
      warning: (message: string) => { alert(message); return ''; },
      info: (message: string) => { alert(message); return ''; },
    };
  }
  return context;
}

