'use client';

import React from 'react';
import { Clock, Hand } from 'lucide-react';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import {
  DEFAULT_AFTER_HOURS_MESSAGE,
  DEFAULT_FALLBACK_MESSAGE,
  DEFAULT_HANDOFF_MESSAGE,
  MAX_TRIGGER_PHRASES,
  MESSAGE_MAX,
  type AgentSettings,
} from '@/lib/ai-agent/types';
import { DaysOfWeek, TimezoneOptions, type DayOfWeek } from '@/types/business-hours-presets';
import type { WhatsAppBotUIConfig } from '@/types/whatsapp-bot-config';
import { ChipInput } from './ChipInput';
import type { StaffOption } from './LeadQualificationEditor';
import { FieldLabel, SectionCard } from './SectionCard';

type Hours = NonNullable<WhatsAppBotUIConfig['businessHours']>;

const ALL_DAYS: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const DEFAULT_HOURS: Hours = {
  timezone: 'Asia/Kolkata',
  schedule: ALL_DAYS.map((day) =>
    day === 'sunday' ? { day, isOpen: false } : { day, isOpen: true, openTime: '09:00', closeTime: '20:00' },
  ),
};

function HoursEditor({ hours, onChange }: { hours: Hours; onChange: (h: Hours) => void }) {
  const byDay = new Map(hours.schedule.map((s) => [s.day, s]));
  const schedule = ALL_DAYS.map((day) => byDay.get(day) || { day, isOpen: false });
  const setDay = (day: DayOfWeek, patch: Partial<Hours['schedule'][number]>) =>
    onChange({ ...hours, schedule: schedule.map((s) => (s.day === day ? { ...s, ...patch } : s)) });

  return (
    <div className="space-y-3">
      <div className="max-w-sm">
        <FieldLabel>Timezone</FieldLabel>
        <select className="input" value={hours.timezone} onChange={(e) => onChange({ ...hours, timezone: e.target.value })}>
          {TimezoneOptions.map((tz) => (
            <option key={tz.value} value={tz.value}>{tz.label} ({tz.offset})</option>
          ))}
        </select>
      </div>
      <div className="divide-y divide-border rounded-lg border border-border">
        {schedule.map((s) => (
          <div key={s.day} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <label className="flex w-32 items-center gap-2 text-sm font-medium text-text-primary">
              <input
                type="checkbox"
                checked={s.isOpen}
                onChange={(e) =>
                  setDay(s.day, e.target.checked
                    ? { isOpen: true, openTime: s.openTime || '09:00', closeTime: s.closeTime || '20:00' }
                    : { isOpen: false, openTime: undefined, closeTime: undefined })
                }
                className="h-4 w-4 rounded border-border text-primary-600"
              />
              {DaysOfWeek[s.day].label}
            </label>
            {s.isOpen ? (
              <div className="flex items-center gap-2 text-sm">
                <input
                  type="time"
                  className="input h-9 w-28 py-1"
                  value={s.openTime || '09:00'}
                  onChange={(e) => setDay(s.day, { openTime: e.target.value })}
                  aria-label={`${DaysOfWeek[s.day].label} opening time`}
                />
                <span className="text-text-muted">to</span>
                <input
                  type="time"
                  className="input h-9 w-28 py-1"
                  value={s.closeTime || '20:00'}
                  onChange={(e) => setDay(s.day, { closeTime: e.target.value })}
                  aria-label={`${DaysOfWeek[s.day].label} closing time`}
                />
              </div>
            ) : (
              <span className="text-sm text-text-muted">Closed</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HandoffSection({
  settings,
  onChange,
  staff,
}: {
  settings: AgentSettings;
  onChange: (patch: Partial<AgentSettings>) => void;
  staff: StaffOption[];
}) {
  const hours = settings.behavior.businessHours;
  const handoff = settings.handoff;
  const setHandoff = (patch: Partial<AgentSettings['handoff']>) => onChange({ handoff: { ...handoff, ...patch } });
  const setHours = (h: Hours | undefined) => onChange({ behavior: { ...settings.behavior, businessHours: h } });

  return (
    <SectionCard
      id="handoff"
      icon={Hand}
      title="Hours & handoff"
      description="When the agent replies, what it says when it can't help, and when a person takes over."
    >
      <div className="space-y-6">
        <div className="space-y-4">
          <Switch
            checked={!!hours}
            onChange={(on) => setHours(on ? DEFAULT_HOURS : undefined)}
            label={<span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4" /> Business hours</span>}
            description="Outside these hours the agent sends your after-hours message once a day per chat, then keeps answering."
          />
          {hours && (
            <>
              <HoursEditor hours={hours} onChange={setHours} />
              <div>
                <FieldLabel>After-hours message</FieldLabel>
                <Textarea
                  rows={2}
                  value={settings.afterHoursMessage}
                  maxLength={MESSAGE_MAX}
                  placeholder={DEFAULT_AFTER_HOURS_MESSAGE}
                  onChange={(e) => onChange({ afterHoursMessage: e.target.value })}
                />
              </div>
            </>
          )}
        </div>

        <div className="border-t border-border pt-5">
          <FieldLabel hint="Sent when the agent can't answer or something goes wrong. Required before going Live.">
            Fallback message
          </FieldLabel>
          <Textarea
            rows={2}
            value={settings.fallbackMessage}
            maxLength={MESSAGE_MAX}
            placeholder={DEFAULT_FALLBACK_MESSAGE}
            onChange={(e) => onChange({ fallbackMessage: e.target.value })}
          />
          {!settings.fallbackMessage.trim() && (
            <button
              type="button"
              onClick={() => onChange({ fallbackMessage: DEFAULT_FALLBACK_MESSAGE })}
              className="mt-1 text-xs font-medium text-primary-700 hover:underline"
            >
              Use the suggested message
            </button>
          )}
        </div>

        <div className="space-y-4 border-t border-border pt-5">
          <Switch
            checked={handoff.enabled}
            onChange={(enabled) => setHandoff({ enabled })}
            label="Hand off to a human"
            description="When a customer asks for a person, the agent stops, tells them someone will reply, and alerts your team."
          />
          {handoff.enabled && (
            <div className="space-y-4">
              <div>
                <FieldLabel hint="If a message contains any of these, the chat is handed over straight away.">Trigger phrases</FieldLabel>
                <ChipInput
                  values={handoff.triggerPhrases}
                  onChange={(triggerPhrases) => setHandoff({ triggerPhrases })}
                  placeholder="e.g. speak to owner"
                  max={MAX_TRIGGER_PHRASES}
                />
              </div>
              <div>
                <FieldLabel>Handoff message</FieldLabel>
                <Textarea
                  rows={2}
                  value={handoff.message}
                  maxLength={MESSAGE_MAX}
                  placeholder={DEFAULT_HANDOFF_MESSAGE}
                  onChange={(e) => setHandoff({ message: e.target.value })}
                />
              </div>
              <div className="max-w-sm">
                <FieldLabel>Assign the chat to</FieldLabel>
                <select className="input" value={handoff.assignTo} onChange={(e) => setHandoff({ assignTo: e.target.value })}>
                  <option value="auto">Automatic (your inbox assignment rules)</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <Switch
            checked={handoff.pauseOnStaffReply}
            onChange={(pauseOnStaffReply) => setHandoff({ pauseOnStaffReply })}
            label="Pause the AI when a staff member replies"
            description="So the agent doesn't talk over your team. Staff can resume it from the inbox."
          />
          <label className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
            Pause for
            <input
              type="number"
              min={5}
              max={1440}
              className="input h-9 w-24 py-1"
              value={handoff.pauseMinutes}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) setHandoff({ pauseMinutes: Math.min(1440, Math.max(5, n)) });
              }}
            />
            minutes after a handoff or staff reply
          </label>
        </div>

        <div className="border-t border-border pt-5">
          <Switch
            checked={settings.quickRepliesEnabled}
            onChange={(quickRepliesEnabled) => onChange({ quickRepliesEnabled })}
            label="Quick reply buttons"
            description="Let the agent add up to 3 tap-to-reply options under a message (shown as numbered choices on the Cloud API)."
          />
        </div>
      </div>
    </SectionCard>
  );
}
