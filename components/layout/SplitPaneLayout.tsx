'use client';

import React, { useEffect } from 'react';
import { clsx } from 'clsx';

interface SplitPaneLayoutProps {
  /** Whether the detail panel is open */
  isDetailOpen: boolean;
  /** Called when the user wants to close the detail (X button, Escape, etc.) */
  onCloseDetail: () => void;
  /**
   * The left/primary list slot.
   * The page is responsible for rendering EITHER a full-width table (when `isDetailOpen` is false)
   * OR a compact narrow list (when `isDetailOpen` is true).
   */
  listSlot: React.ReactNode;
  /** The right/detail slot. Only rendered when `isDetailOpen` is true. */
  detailSlot: React.ReactNode;
  /** Optional: above-list filters/search area that stays put in both modes */
  toolbarSlot?: React.ReactNode;
  /** Optional: width class for the narrow left rail in split mode. Default: w-[280px] lg:w-[320px] */
  compactListWidthClass?: string;
  className?: string;
}

/**
 * Zoho-style split-pane list/detail layout.
 *
 * Desktop behaviour:
 * - When `isDetailOpen === false`: full-width list view (toolbar + list take the whole area).
 * - When `isDetailOpen === true`: list shrinks to a narrow left rail and a detail panel slides in on the right.
 *
 * Mobile behaviour (< md):
 * - When `isDetailOpen === false`: full-screen list.
 * - When `isDetailOpen === true`: full-screen detail panel (list is hidden).
 *
 * Escape key closes the detail panel.
 */
export function SplitPaneLayout({
  isDetailOpen,
  onCloseDetail,
  listSlot,
  detailSlot,
  toolbarSlot,
  compactListWidthClass = 'w-[300px] lg:w-[340px] xl:w-[360px]',
  className,
}: SplitPaneLayoutProps) {
  useEffect(() => {
    if (!isDetailOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseDetail();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isDetailOpen, onCloseDetail]);

  return (
    <div className={clsx('split-pane-layout flex flex-col', className)}>
      {toolbarSlot && (
        <div
          className={clsx(
            'split-pane-toolbar transition-all duration-300',
            isDetailOpen && 'md:hidden'
          )}
        >
          {toolbarSlot}
        </div>
      )}

      <div className="flex flex-1 min-h-0 gap-0 md:gap-4 relative">
        {/* List column */}
        <div
          className={clsx(
            'split-pane-list transition-all duration-300 ease-in-out min-w-0',
            isDetailOpen
              ? `hidden md:block md:shrink-0 ${compactListWidthClass}`
              : 'flex-1 w-full'
          )}
        >
          {listSlot}
        </div>

        {/* Detail column */}
        {isDetailOpen && (
          <div
            className={clsx(
              'split-pane-detail flex-1 min-w-0',
              'fixed inset-0 z-40 bg-background md:static md:z-auto',
              'animate-split-pane-in'
            )}
          >
            {detailSlot}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes split-pane-slide-in {
          from {
            opacity: 0;
            transform: translateX(12px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        :global(.animate-split-pane-in) {
          animation: split-pane-slide-in 220ms ease-out;
        }
      `}</style>
    </div>
  );
}
