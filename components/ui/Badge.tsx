import React from 'react';
import { clsx } from 'clsx';

interface BadgeProps {
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info';
  children: React.ReactNode;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'secondary',
  children,
  className
}) => {
  const variantClasses = {
    primary: 'bg-slate-100 text-primary-700 border-primary-200 dark:bg-slate-800 dark:text-primary-200 dark:border-slate-600',
    secondary: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    success: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800/60',
    warning: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800/60',
    danger: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800/60',
    info: 'bg-slate-100 text-primary-700 border-primary-200 dark:bg-slate-800 dark:text-primary-200 dark:border-slate-600',
  };

  return (
    <span className={clsx(
      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border',
      variantClasses[variant],
      className
    )}>
      {children}
    </span>
  );
};
