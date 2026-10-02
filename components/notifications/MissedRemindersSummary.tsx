'use client';

import React from 'react';
import { Bell, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import type { ReminderPopup } from '@/lib/notifications/client/notification-store';

const LISTED = 5;

/** Replaces a stack of popups when several reminders were missed (e.g. after the app was closed). */
export function MissedRemindersSummary({
  reminders,
  onDismissAll,
}: {
  reminders: ReminderPopup[];
  onDismissAll: () => void;
}) {
  const router = useRouter();
  const shown = reminders.slice(-LISTED).reverse();
  const more = reminders.length - shown.length;

  const openTasks = () => {
    onDismissAll();
    router.push('/tools/todo');
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm pointer-events-auto" onClick={onDismissAll} />
      <div
        role="dialog"
        aria-label={`${reminders.length} reminders`}
        className="relative bg-white rounded-2xl shadow-2xl min-w-[320px] max-w-[420px] w-full pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onDismissAll}
          className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-gray-100 transition-colors z-10"
          aria-label="Dismiss all reminders"
        >
          <X className="w-4 h-4 text-gray-500" />
        </button>
        <div className="p-6 pt-8">
          <div className="flex justify-center mb-4">
            <div className="relative">
              <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center shadow-md">
                <Bell className="w-8 h-8 text-yellow-600" />
              </div>
              <div className="absolute -top-1 -right-1 min-w-6 h-6 px-1 bg-red-500 rounded-full flex items-center justify-center shadow-lg">
                <span className="text-xs font-bold text-white">{reminders.length}</span>
              </div>
            </div>
          </div>
          <h3 className="text-xl font-bold text-center text-gray-900 mb-3">
            You have {reminders.length} reminders
          </h3>
          <ul className="mb-5 space-y-1.5">
            {shown.map((r) => (
              <li key={r.key} className="text-sm text-gray-700 truncate">
                • {r.title.replace(/^\s*Reminder:\s*/i, '').trim() || r.title}
              </li>
            ))}
            {more > 0 && <li className="text-sm text-gray-500">and {more} more</li>}
          </ul>
          <div className="flex gap-2">
            <button
              onClick={onDismissAll}
              className="flex-1 py-3 px-4 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50"
            >
              Dismiss all
            </button>
            <button
              onClick={openTasks}
              className={clsx(
                'flex-1 py-3 px-4 rounded-lg',
                'bg-gradient-to-r from-primary-600 to-primary-700',
                'text-white font-bold text-sm uppercase shadow-lg hover:shadow-xl'
              )}
            >
              View tasks
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
