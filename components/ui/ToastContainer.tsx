'use client';

import React, { useState, useEffect } from 'react';
import { EnhancedToast, ToastType, ToastAction } from './EnhancedToast';

export interface Toast {
  id: string;
  message: string;
  type?: ToastType;
  duration?: number;
  action?: ToastAction;
}

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onRemove }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Below sticky TopBar / notification cluster on mobile; desktop stays top-right.
  const positionClass =
    'fixed z-50 space-y-2 top-[4.5rem] right-3 left-3 sm:left-auto sm:right-4 lg:top-4 max-w-md sm:max-w-sm ml-auto';

  if (!mounted) {
    return <div className={positionClass} style={{ display: 'none' }} />;
  }

  if (toasts.length === 0) {
    return <div className={positionClass} />;
  }

  return (
    <div className={positionClass}>
      {toasts.map((toast) => (
        <EnhancedToast
          key={toast.id}
          {...toast}
          onClose={() => onRemove(toast.id)}
        />
      ))}
    </div>
  );
};

