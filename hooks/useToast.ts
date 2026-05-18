'use client';

import { useState, useCallback } from 'react';
import { Toast, ToastType, ToastAction } from '@/components/ui/EnhancedToast';


// Re-export Toast for use in other files
export type { Toast };

let toastIdCounter = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((
    message: string,
    type: ToastType = 'info',
    duration: number = 5000,
    action?: ToastAction
  ) => {

    const id = `toast-${++toastIdCounter}`;
    const toast: Toast = { id, message, type, duration, action };
    
    setToasts((prev) => [...prev, toast]);
    
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const success = useCallback((message: string, action?: ToastAction) => {
    return showToast(message, 'success', 3000, action);
  }, [showToast]);

  const error = useCallback((message: string, action?: ToastAction) => {
    return showToast(message, 'error', 5000, action);
  }, [showToast]);

  const warning = useCallback((message: string, action?: ToastAction) => {
    return showToast(message, 'warning', 4000, action);
  }, [showToast]);

  const info = useCallback((message: string, action?: ToastAction) => {
    return showToast(message, 'info', 3000, action);
  }, [showToast]);

  return {
    toasts,
    showToast,
    removeToast,
    success,
    error,
    warning,
    info,
  };
}

