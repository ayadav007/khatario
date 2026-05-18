'use client';

/**
 * Business Hours & Availability Section
 * 
 * Weekly schedule selector, timezone selector, after-hours auto-reply
 */

import React from 'react';
import { Card } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Textarea';
import { WhatsAppBotUIConfig } from '@/types/whatsapp-bot-config';
import {
  DaysOfWeek,
  TimezoneOptions,
  DayOfWeek,
  SafeAfterHoursMessages,
} from '@/types/business-hours-presets';
import { Info } from 'lucide-react';

interface BusinessHoursSectionProps {
  config: WhatsAppBotUIConfig;
  onUpdate: (updates: Partial<WhatsAppBotUIConfig>) => void;
}

export function BusinessHoursSection({ config, onUpdate }: BusinessHoursSectionProps) {
  const businessHours = config.businessHours || {
    timezone: 'Asia/Kolkata',
    schedule: [
      { day: 'monday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
      { day: 'tuesday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
      { day: 'wednesday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
      { day: 'thursday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
      { day: 'friday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
      { day: 'saturday', isOpen: false },
      { day: 'sunday', isOpen: false },
    ],
    afterHoursMessage: SafeAfterHoursMessages.generic,
  };

  const afterHoursEnabled = !!businessHours.afterHoursMessage;

  // Ensure all days are in schedule
  const allDays: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const scheduleMap = new Map(businessHours.schedule.map(s => [s.day, s]));
  const completeSchedule = allDays.map(day => scheduleMap.get(day) || { day, isOpen: false });

  const handleTimezoneChange = (timezone: string) => {
    onUpdate({
      businessHours: {
        ...businessHours,
        timezone,
      },
    });
  };

  const handleDayToggle = (day: DayOfWeek, isOpen: boolean) => {
    const updatedSchedule = completeSchedule.map(s =>
      s.day === day ? { ...s, isOpen, openTime: isOpen ? (s.openTime || '09:00') : undefined, closeTime: isOpen ? (s.closeTime || '18:00') : undefined } : s
    );
    onUpdate({
      businessHours: {
        ...businessHours,
        schedule: updatedSchedule,
      },
    });
  };

  const handleTimeChange = (day: DayOfWeek, field: 'openTime' | 'closeTime', value: string) => {
    const updatedSchedule = completeSchedule.map(s =>
      s.day === day ? { ...s, [field]: value } : s
    );
    onUpdate({
      businessHours: {
        ...businessHours,
        schedule: updatedSchedule,
      },
    });
  };

  const handleAfterHoursToggle = (enabled: boolean) => {
    onUpdate({
      businessHours: {
        ...businessHours,
        afterHoursMessage: enabled ? (businessHours.afterHoursMessage || SafeAfterHoursMessages.generic) : undefined,
      },
    });
  };

  const handleAfterHoursMessageChange = (message: string) => {
    if (message.length > 300) return; // Limit to 300 characters
    onUpdate({
      businessHours: {
        ...businessHours,
        afterHoursMessage: message,
      },
    });
  };

  return (
    <Card padding="lg">
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-text-primary mb-2">Business Hours & Availability</h2>
          <p className="text-sm text-text-secondary">
            Configure business hours and after-hours messaging.
          </p>
        </div>

        {/* Timezone */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-text-primary">
            Timezone
          </label>
          <select
            value={businessHours.timezone}
            onChange={(e) => handleTimezoneChange(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            {TimezoneOptions.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label} ({tz.offset})
              </option>
            ))}
          </select>
        </div>

        {/* Weekly Schedule */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-text-primary">
            Weekly Schedule
          </label>
          <div className="space-y-2">
            {completeSchedule.map((daySchedule) => {
              const dayInfo = DaysOfWeek[daySchedule.day];
              return (
                <div
                  key={daySchedule.day}
                  className="flex items-center gap-4 p-4 border border-border rounded-lg"
                >
                  <label className="flex items-center gap-3 flex-1">
                    <input
                      type="checkbox"
                      checked={daySchedule.isOpen}
                      onChange={(e) => handleDayToggle(daySchedule.day, e.target.checked)}
                      className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                    />
                    <span className="font-medium text-text-primary min-w-[100px]">
                      {dayInfo.label}
                    </span>
                  </label>
                  {daySchedule.isOpen && (
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={daySchedule.openTime || '09:00'}
                        onChange={(e) => handleTimeChange(daySchedule.day, 'openTime', e.target.value)}
                        className="px-3 py-2 border border-border rounded-lg bg-surface text-text-primary focus:ring-2 focus:ring-primary-500"
                      />
                      <span className="text-text-muted">to</span>
                      <input
                        type="time"
                        value={daySchedule.closeTime || '18:00'}
                        onChange={(e) => handleTimeChange(daySchedule.day, 'closeTime', e.target.value)}
                        className="px-3 py-2 border border-border rounded-lg bg-surface text-text-primary focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                  )}
                  {!daySchedule.isOpen && (
                    <span className="text-sm text-text-muted">Closed</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* After-Hours Auto-Reply */}
        <div className="space-y-4 border-t pt-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <label className="block text-sm font-medium text-text-primary mb-1">
                After-Hours Auto-Reply
              </label>
              <p className="text-sm text-text-secondary">
                Automatically send a message when customers contact you outside business hours
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer ml-4">
              <input
                type="checkbox"
                checked={afterHoursEnabled}
                onChange={(e) => handleAfterHoursToggle(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
            </label>
          </div>

          {afterHoursEnabled && (
            <div className="space-y-3">
              <Textarea
                label="After-Hours Message"
                value={businessHours.afterHoursMessage || ''}
                onChange={(e) => handleAfterHoursMessageChange(e.target.value)}
                rows={4}
                maxLength={300}
                helperText={`${(businessHours.afterHoursMessage || '').length}/300 characters`}
              />
              <div className="bg-slate-50 border border-primary-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-primary-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-primary-900">
                    <p className="font-medium mb-1">Important Guidelines</p>
                    <ul className="text-primary-700 space-y-1 list-disc list-inside">
                      <li>Do not make promises about delivery or service times</li>
                      <li>Keep the message professional and helpful</li>
                      <li>Include your business hours in the message</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
