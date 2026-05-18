import React from 'react';
import { clsx } from 'clsx';

interface ChipProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'secondary';
  className?: string;
}

export const Chip: React.FC<ChipProps> = ({
  children,
  variant = 'default',
  className,
}) => {
  const variantClasses = {
    default: 'chip',
    success: 'chip-success',
    warning: 'chip-warning',
    error: 'chip-error',
    secondary: 'chip', // 'secondary' maps to 'default'
  };

  return (
    <span className={clsx(variantClasses[variant], className)}>
      {children}
    </span>
  );
};

