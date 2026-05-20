'use client';

import React, { useState, useRef, useEffect } from 'react';
import { FileText, Package, Users, ShoppingCart, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';

interface QuickAction {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const quickActions: QuickAction[] = [
  {
    label: 'New Invoice',
    href: '/invoices/new',
    icon: FileText,
    color: 'bg-primary-500',
  },
  {
    label: 'New Purchase',
    href: '/purchases/new',
    icon: ShoppingCart,
    color: 'bg-green-600',
  },
  {
    label: 'New Customer',
    href: '/customers/new',
    icon: Users,
    color: 'bg-purple-600',
  },
  {
    label: 'New Item',
    href: '/items/new',
    icon: Package,
    color: 'bg-orange-500',
  },
];

export const QuickActionsFAB: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleActionClick = (href: string) => {
    setIsOpen(false);
    router.push(href);
  };

  return (
    <div
      ref={containerRef}
      className="fixed bottom-24 right-4 z-40 flex flex-col items-end gap-3 lg:bottom-6 lg:right-6"
    >
      {isOpen && (
        <div className="flex flex-col items-end gap-3 animate-in fade-in slide-in-from-bottom-4 duration-200">
          {quickActions.map((action, index) => {
            const Icon = action.icon;
            return (
              <button
                key={action.href}
                type="button"
                onClick={() => handleActionClick(action.href)}
                className="flex items-center gap-2.5 touch-manipulation"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <span className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-text-primary shadow-md whitespace-nowrap">
                  {action.label}
                </span>
                <span
                  className={clsx(
                    'flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white shadow-lg transition-transform active:scale-95',
                    action.color
                  )}
                  aria-hidden
                >
                  <Icon className="h-5 w-5" />
                </span>
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-all active:scale-95',
          isOpen ? 'bg-red-600' : 'bg-primary-500'
        )}
        aria-label={isOpen ? 'Close quick actions' : 'Quick actions'}
        aria-expanded={isOpen}
      >
        {isOpen ? <X className="h-7 w-7" /> : <Plus className="h-7 w-7" />}
      </button>
    </div>
  );
};

