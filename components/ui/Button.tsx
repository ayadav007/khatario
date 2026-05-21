import React from 'react';
import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'accent' | 'secondary' | 'ghost' | 'default' | 'outline' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  className?: string;
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  children,
  className,
  isLoading = false,
  disabled,
  ...props
}) => {
  const variantClasses: Record<string, string> = {
    primary: 'button-primary',
    accent: 'button-accent',
    secondary: 'button-secondary',
    ghost: 'button-ghost',
    default: 'button-primary', // 'default' maps to 'primary'
    outline: 'button-secondary', // 'outline' maps to 'secondary'
    destructive: 'button-secondary bg-red-600 hover:bg-red-700 text-white', // 'destructive' uses secondary base with error styling
  };

  const sizeClasses = {
    /** Uses global spacing tokens */
    sm: 'px-3 py-1.5 text-xs min-h-9 md:px-4 md:py-2 md:text-sm md:min-h-[2.375rem]',
    md: 'px-3.5 py-2 text-sm min-h-10 md:px-6 md:py-2.5 md:text-base md:min-h-[2.75rem]',
    lg: 'px-4 py-2.5 text-base min-h-11 md:px-8 md:py-3 md:text-lg md:min-h-[3rem]',
  };

  return (
    <button
      className={clsx(variantClasses[variant], sizeClasses[size], className)}
      disabled={isLoading || disabled}
      {...props}
    >
      {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
};
