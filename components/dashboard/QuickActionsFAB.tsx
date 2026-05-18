'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { FileText, Package, Users, ShoppingCart, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

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
    color: 'bg-primary-500 hover:bg-primary-600',
  },
  {
    label: 'New Purchase',
    href: '/purchases/new',
    icon: ShoppingCart,
    color: 'bg-green-500 hover:bg-green-600',
  },
  {
    label: 'New Customer',
    href: '/customers/new',
    icon: Users,
    color: 'bg-purple-500 hover:bg-purple-600',
  },
  {
    label: 'New Item',
    href: '/items/new',
    icon: Package,
    color: 'bg-orange-500 hover:bg-orange-600',
  },
];

export const QuickActionsFAB: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close when clicking outside
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
      {/* Action Buttons */}
      {isOpen && (
        <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-4 duration-200">
          {quickActions.map((action, index) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href}
                href={action.href}
                onClick={() => handleActionClick(action.href)}
                className="flex items-center gap-3 group"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <span className="bg-surface text-text-primary border border-border px-3 py-2 rounded-lg shadow-lg text-sm font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  {action.label}
                </span>
                <button
                  className={`${action.color} w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg hover:shadow-xl transition-all transform hover:scale-110`}
                  aria-label={action.label}
                >
                  <Icon className="w-6 h-6" />
                </button>
              </Link>
            );
          })}
        </div>
      )}

      {/* Main Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-16 h-16 rounded-full flex items-center justify-center text-white shadow-lg hover:shadow-xl transition-all transform ${
          isOpen ? 'bg-red-500 hover:bg-red-600 rotate-45' : 'bg-primary-500 hover:bg-primary-600 rotate-0'
        }`}
        aria-label={isOpen ? 'Close actions' : 'Open quick actions'}
      >
        {isOpen ? (
          <X className="w-7 h-7" />
        ) : (
          <Plus className="w-7 h-7" />
        )}
      </button>
    </div>
  );
};

