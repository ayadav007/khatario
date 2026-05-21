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
    sm: 'p-card-sm',
    md: 'p-card-md md:p-card-lg',
    lg: 'p-card-lg md:p-card-xl',
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
