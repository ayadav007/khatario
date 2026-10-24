import React from 'react';
import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';

function hasVisibleText(node: React.ReactNode): boolean {
  return React.Children.toArray(node).some((child) => {
    if (typeof child === 'string') return child.trim().length > 0;
    if (typeof child === 'number') return true;
    if (React.isValidElement<{ children?: React.ReactNode }>(child)) {
      return hasVisibleText(child.props.children);
    }
    return false;
  });
}

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
    /** 40px / 14px at 375px; desktop sm stays 14px. Not full-width — pass w-full for a form's primary action. */
    sm: 'w-fit max-w-full px-3 text-base min-h-10 md:px-4 md:text-sm',
    /** 44px / 14px at 375px; 16px from the desktop type scale. */
    md: 'w-fit max-w-full px-4 text-base min-h-11 md:px-6',
    /** 44px on mobile, taller with 18px type from md up. */
    lg: 'w-fit max-w-full px-4 text-base min-h-11 md:min-h-12 md:px-8 md:text-lg',
  };

  const iconOnly = !hasVisibleText(children);

  return (
    <button
      className={clsx(variantClasses[variant], sizeClasses[size], iconOnly && 'tap-target-44', className)}
      disabled={isLoading || disabled}
      {...props}
    >
      {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
};
