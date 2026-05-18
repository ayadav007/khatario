'use client';

import React, { useRef, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { X, Pencil, MoreHorizontal, ArrowLeft } from 'lucide-react';

export interface DetailPanelTab {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  show?: boolean;
}

interface DetailPanelShellProps {
  /** Title shown in the header (e.g., entity name) */
  title: string;
  /** Optional subtitle under the title */
  subtitle?: React.ReactNode;
  /** Avatar/icon on the left of the title (image url or ReactNode) */
  avatar?: React.ReactNode;
  /** Tabs to render. `activeTab` and `onTabChange` control selection. */
  tabs: DetailPanelTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  /** Called when close (X) or mobile back is pressed */
  onClose: () => void;
  /** Called when the header pencil (edit) icon is pressed. If omitted, edit is hidden. */
  onEdit?: () => void;
  /** Items for the More dropdown menu */
  moreActions?: Array<{
    label: string;
    onClick: () => void;
    icon?: React.ComponentType<{ className?: string }>;
    variant?: 'default' | 'danger';
  }>;
  /** Content for the active tab */
  children: React.ReactNode;
  className?: string;
}

/**
 * Reusable shell for a Zoho-style detail panel rendered inside SplitPaneLayout's detail slot.
 * Provides consistent header (avatar, title, subtitle, edit, more, close), tabs, and body scroll area.
 */
export function DetailPanelShell({
  title,
  subtitle,
  avatar,
  tabs,
  activeTab,
  onTabChange,
  onClose,
  onEdit,
  moreActions,
  children,
  className,
}: DetailPanelShellProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [moreOpen]);

  const visibleTabs = tabs.filter((t) => t.show !== false);

  return (
    <div
      className={clsx(
        'flex flex-col h-full bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-card shadow-small overflow-hidden',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 md:px-6 py-3 md:py-4 border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
        {/* Mobile back button */}
        <button
          type="button"
          onClick={onClose}
          className="md:hidden p-2 -ml-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-text-secondary"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {avatar && <div className="shrink-0">{avatar}</div>}

        <div className="min-w-0 flex-1">
          <h2 className="text-base md:text-lg font-semibold text-text-primary truncate">{title}</h2>
          {subtitle && (
            <div className="text-xs md:text-sm text-text-secondary mt-0.5 truncate">{subtitle}</div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-text-secondary hover:text-text-primary transition-colors"
              aria-label="Edit"
              title="Edit"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          {moreActions && moreActions.length > 0 && (
            <div className="relative" ref={moreRef}>
              <button
                type="button"
                onClick={() => setMoreOpen((o) => !o)}
                className="flex items-center gap-1 px-2 py-1.5 rounded-md border border-border hover:bg-gray-50 dark:hover:bg-gray-800 text-text-secondary hover:text-text-primary text-sm transition-colors"
                aria-label="More actions"
                aria-expanded={moreOpen}
              >
                More
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {moreOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-md shadow-lg z-20 py-1">
                  {moreActions.map((action, idx) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          action.onClick();
                          setMoreOpen(false);
                        }}
                        className={clsx(
                          'w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors',
                          action.variant === 'danger'
                            ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
                            : 'text-text-primary hover:bg-gray-50 dark:hover:bg-gray-800'
                        )}
                      >
                        {Icon && <Icon className="w-4 h-4" />}
                        {action.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="hidden md:inline-flex p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-text-secondary hover:text-text-primary transition-colors"
            aria-label="Close"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      {visibleTabs.length > 0 && (
        <div className="border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
          <div className="flex overflow-x-auto no-scrollbar">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabChange(tab.id)}
                  className={clsx(
                    'px-4 md:px-6 py-3 text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap border-b-2',
                    isActive
                      ? 'text-primary-600 dark:text-sky-400 border-primary-500 dark:border-sky-500'
                      : 'text-text-secondary border-transparent hover:text-text-primary dark:hover:text-slate-100'
                  )}
                  aria-selected={isActive}
                  role="tab"
                >
                  {Icon && <Icon className="w-4 h-4" />}
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
    </div>
  );
}
