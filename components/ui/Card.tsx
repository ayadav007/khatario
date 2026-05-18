import React from 'react';
import { clsx } from 'clsx';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hover?: boolean;
}

export const Card: React.FC<CardProps> = ({ 
  children, 
  className,
  padding = 'md',
  hover = false,
  ...props
}) => {
  const paddingClasses = {
    none: '',
    /** Mobile-dense spacing; widen from sm / md breakpoints */
    sm: 'p-3 sm:p-4',
    md: 'p-4 sm:p-5 md:p-6',
    lg: 'p-4 sm:p-6 md:p-8',
  };

  return (
    <div
      className={clsx(
        'card',
        paddingClasses[padding],
        hover && 'hover:shadow-medium transition-shadow duration-200',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

