'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Home } from 'lucide-react';
import { generateBreadcrumbs, BreadcrumbItem } from '@/lib/breadcrumb-utils';


interface BreadcrumbsProps {
  customLabels?: Record<string, string>;
  className?: string;
  items?: Array<{ label: string; href?: string }>;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ customLabels, className = '', items }) => {
  const pathname = usePathname();
  
  // If items are provided, use them directly
  if (items) {
    const breadcrumbs = items.map(item => ({ label: item.label, href: item.href || '#' }));
    if (breadcrumbs.length <= 1) {
      return null;
    }
    return (
      <nav className={`flex items-center gap-2 text-sm text-text-secondary ${className}`} aria-label="Breadcrumb">
        <ol className="flex items-center gap-2">
          {breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1;
            
            return (
              <li key={crumb.href || index} className="flex items-center gap-2">
                {index === 0 ? (
                  <Link
                    href={crumb.href}
                    className="flex items-center gap-1 hover:text-primary-500 transition-colors"
                    aria-label="Home"
                  >
                    <Home className="w-4 h-4" />
                  </Link>
                ) : (
                  <>
                    <ChevronRight className="w-4 h-4 text-text-muted" />
                    {isLast ? (
                      <span className="text-text-primary font-medium" aria-current="page">
                        {crumb.label}
                      </span>
                    ) : (
                      <Link
                        href={crumb.href}
                        className="hover:text-primary-500 transition-colors"
                      >
                        {crumb.label}
                      </Link>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    );
  }

  // Don't show breadcrumbs on dashboard or home
  if (pathname === '/dashboard' || pathname === '/') {
    return null;
  }

  const breadcrumbs = generateBreadcrumbs(pathname, customLabels);

  if (breadcrumbs.length <= 1) {
    return null;
  }

  return (
    <nav className={`flex items-center gap-2 text-sm text-text-secondary ${className}`} aria-label="Breadcrumb">
      <ol className="flex items-center gap-2">
        {breadcrumbs.map((crumb, index) => {
          const isLast = index === breadcrumbs.length - 1;
          
          return (
            <li key={crumb.href} className="flex items-center gap-2">
              {index === 0 ? (
                <Link
                  href={crumb.href}
                  className="flex items-center gap-1 hover:text-primary-500 transition-colors"
                  aria-label="Home"
                >
                  <Home className="w-4 h-4" />
                </Link>
              ) : (
                <>
                  <ChevronRight className="w-4 h-4 text-text-muted" />
                  {isLast ? (
                    <span className="text-text-primary font-medium" aria-current="page">
                      {crumb.label}
                    </span>
                  ) : (
                    <Link
                      href={crumb.href}
                      className="hover:text-primary-500 transition-colors"
                    >
                      {crumb.label}
                    </Link>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

