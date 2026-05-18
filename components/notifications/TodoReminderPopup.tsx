'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Bell, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';

interface TodoReminder {
  id: string;
  notificationId: string;
  title: string;
  message: string;
  todoId: string;
  createdAt: string;
}

interface TodoReminderPopupProps {
  reminder: TodoReminder;
  onClose: () => void;
  onMarkAsRead?: (notificationId: string) => void;
}

export function TodoReminderPopup({ reminder, onClose, onMarkAsRead }: TodoReminderPopupProps) {
  const router = useRouter();
  const [isVisible, setIsVisible] = useState(true);

  const handleClose = useCallback(() => {
    setIsVisible(false);
    setTimeout(() => {
      onClose();
    }, 300); // Wait for fade animation
  }, [onClose]);

  // Popup stays visible until user takes action (no auto-dismiss)

  const handleOpen = () => {
    // Mark as read if handler provided
    if (onMarkAsRead) {
      onMarkAsRead(reminder.notificationId);
    }
    // Navigate to todo page
    router.push(`/tools/todo`);
    handleClose();
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/20 backdrop-blur-sm pointer-events-auto"
        onClick={handleClose}
      />
      
      {/* Popup Card */}
      <div 
        className={clsx(
          'relative bg-white rounded-2xl shadow-2xl',
          'min-w-[320px] max-w-[420px] w-full',
          'transform transition-all duration-300 ease-out',
          isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0',
          'pointer-events-auto'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-gray-100 transition-colors z-10"
          aria-label="Close"
        >
          <X className="w-4 h-4 text-gray-500" />
        </button>

        {/* Content */}
        <div className="p-6 pt-8">
          {/* Bell Icon with Badge */}
          <div className="flex justify-center mb-4">
            <div className="relative">
              <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center shadow-md">
                <Bell className="w-8 h-8 text-yellow-600" />
              </div>
              {/* Badge - showing count of 1 for single reminder */}
              <div className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center shadow-lg">
                <span className="text-xs font-bold text-white">1</span>
              </div>
            </div>
          </div>

          {/* Task / notification title (from API: "Reminder: {task name}") */}
          <h3 className="text-2xl font-bold text-center text-gray-900 mb-2 line-clamp-3">
            {reminder.title
              ? (reminder.title.replace(/^\s*Reminder:\s*/i, '').trim() || reminder.title)
              : 'Reminder'}
          </h3>
          
          {/* Divider */}
          <div className="h-px bg-gray-200 mb-4" />

          {/* Message (usually includes due context from the notification row) */}
          <div className="mb-6">
            <p className="text-sm text-gray-600 text-center leading-relaxed">
              {reminder.message && String(reminder.message).trim() !== ''
                ? reminder.message
                : 'Tap OPEN to view this task in your list.'}
            </p>
          </div>

          {/* Open Button */}
          <button
            onClick={handleOpen}
            className={clsx(
              'w-full py-3 px-6 rounded-lg',
              'bg-gradient-to-r from-primary-600 to-primary-700',
              'text-white font-bold text-sm uppercase',
              'shadow-lg hover:shadow-xl',
              'transform hover:scale-[1.02] active:scale-[0.98]',
              'transition-all duration-200',
              'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2'
            )}
          >
            OPEN
          </button>
        </div>
      </div>
    </div>
  );
}
