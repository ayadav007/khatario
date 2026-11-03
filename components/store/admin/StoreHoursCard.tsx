'use client';

import { Clock } from 'lucide-react';
import { SetupBlock, SetupGroup, SetupSwitch } from '@/components/store/admin/StoreSetupLayout';
import {
  sanitizeStoreHours,
  STORE_DAYS,
  type StoreDay,
  type StoreHours,
} from '@/lib/store/store-hours';

/** What the card edits: each day keeps its times while switched off, so turning it back on restores them. */
export type StoreHoursDraft = Record<StoreDay, { on: boolean; open: string; close: string }>;

const DAY_NAMES: Record<StoreDay, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

const DEFAULT_OPEN = '09:00';
const DEFAULT_CLOSE = '21:00';

export function storeHoursDraft(hours: StoreHours | null | undefined): StoreHoursDraft {
  const out = {} as StoreHoursDraft;
  for (const d of STORE_DAYS) {
    const h = hours?.[d];
    out[d] = h ? { on: true, open: h.open, close: h.close } : { on: false, open: DEFAULT_OPEN, close: DEFAULT_CLOSE };
  }
  return out;
}

/** The value saved: days switched off are closed, and no open day means hours are not set (null). */
export function storeHoursFromDraft(draft: StoreHoursDraft): StoreHours | null {
  const raw: Record<string, { open: string; close: string } | null> = {};
  for (const d of STORE_DAYS) raw[d] = draft[d].on ? { open: draft[d].open, close: draft[d].close } : null;
  return sanitizeStoreHours(raw);
}

const timeClass =
  'h-10 w-[7.25rem] rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-gray-50 disabled:text-gray-400';

export function StoreHoursCard({
  value,
  onChange,
}: {
  value: StoreHoursDraft;
  onChange: (next: StoreHoursDraft) => void;
}) {
  const setDay = (d: StoreDay, patch: Partial<StoreHoursDraft[StoreDay]>) =>
    onChange({ ...value, [d]: { ...value[d], ...patch } });

  const copyMonday = () => {
    const next = {} as StoreHoursDraft;
    for (const d of STORE_DAYS) next[d] = { ...value.mon };
    onChange(next);
  };

  return (
    <SetupGroup
      icon={Clock}
      title="Store hours"
      testId="store-setup-hours"
      action={
        <button
          type="button"
          onClick={copyMonday}
          className="text-xs font-medium text-primary-600 hover:text-primary-700"
        >
          Copy Monday to all days
        </button>
      }
    >
      <SetupBlock muted>
        <p className="text-xs leading-relaxed text-gray-500">
          India time. Your store can show whether you are open now. Shoppers can still order while you are closed.
          Leave every day off to hide store hours.
        </p>
      </SetupBlock>
      {STORE_DAYS.map((d) => {
        const day = value[d];
        const bad = day.on && !(day.open && day.close && day.close > day.open);
        return (
          <div key={d} className="px-5 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex min-w-[9rem] flex-1 items-center gap-3">
                <SetupSwitch label={`Open on ${DAY_NAMES[d]}`} on={day.on} onToggle={() => setDay(d, { on: !day.on })} />
                <span className="text-sm font-medium text-gray-900">{DAY_NAMES[d]}</span>
                {!day.on ? <span className="text-xs text-gray-500">Closed</span> : null}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  aria-label={`${DAY_NAMES[d]} opens at`}
                  value={day.open}
                  disabled={!day.on}
                  onChange={(e) => setDay(d, { open: e.target.value })}
                  className={timeClass}
                />
                <span className="text-xs text-gray-500">to</span>
                <input
                  type="time"
                  aria-label={`${DAY_NAMES[d]} closes at`}
                  value={day.close}
                  disabled={!day.on}
                  onChange={(e) => setDay(d, { close: e.target.value })}
                  className={timeClass}
                />
              </div>
            </div>
            {bad ? (
              <p className="mt-1.5 text-xs text-amber-700">
                Closing time must be after opening time. This day is saved as closed.
              </p>
            ) : null}
          </div>
        );
      })}
    </SetupGroup>
  );
}
