'use client';

import Link from 'next/link';
import { Loader2, BookText } from 'lucide-react';
import { KHATA_RULE_LABEL, type KhataRule } from '@/lib/khata/rules';
import { AffixInput, SetupBlock, SetupGroup, SetupRow, SetupSwitch, setupSelectClass } from './StoreSetupLayout';

export type StoreKhataRules = {
  overLimitRule: KhataRule;
  overdueRule: KhataRule;
  graceDays: number;
  reminderIntervalDays: number;
  allowPartPayment: boolean;
  statementsEnabled: boolean;
};

export type StoreKhataCounts = { open: number; requests: number };

const RULES = Object.keys(KHATA_RULE_LABEL) as KhataRule[];

/**
 * Business rules for store khata (docs/plan/STORE_KHATA.md): what happens when a khata customer
 * is over the limit or has overdue bills, grace days, statements and reminders. Each customer's
 * khata is opened from the customer page. The Store editor loads and saves these with its own Save.
 */
export function StoreKhataSettings({
  value: s,
  counts,
  onChange,
}: {
  value: StoreKhataRules | null;
  counts: StoreKhataCounts;
  onChange: (next: StoreKhataRules) => void;
}) {
  return (
    <SetupGroup
      icon={BookText}
      title="Khata (order now, pay monthly)"
      testId="store-setup-khata"
      meta={
        <span>
          <Link className="text-primary-600 hover:underline" href="/customers?filter=khata">
            {counts.open} open
          </Link>
          {counts.requests > 0 ? (
            <>
              {' · '}
              <Link className="font-medium text-amber-700 hover:underline" href="/customers?filter=khata-requests">
                {counts.requests} waiting for you
              </Link>
            </>
          ) : null}
        </span>
      }
    >
      <SetupBlock>
        <p className="text-xs leading-relaxed text-gray-500">
          Customers you open a khata for can pick &quot;Add to my khata&quot; at checkout and pay on their settlement
          day. Open a khata from the customer&apos;s page.
        </p>
      </SetupBlock>
      {!s ? (
        <SetupBlock>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading khata rules
          </div>
        </SetupBlock>
      ) : (
        <>
          <SetupRow label="Order goes over the credit limit" htmlFor="khata-over-limit">
            <select
              id="khata-over-limit"
              className={setupSelectClass}
              value={s.overLimitRule}
              onChange={(e) => onChange({ ...s, overLimitRule: e.target.value as KhataRule })}
            >
              {RULES.map((r) => (
                <option key={r} value={r}>
                  {KHATA_RULE_LABEL[r]}
                </option>
              ))}
            </select>
          </SetupRow>
          <SetupRow label="Customer has overdue bills" htmlFor="khata-overdue">
            <select
              id="khata-overdue"
              className={setupSelectClass}
              value={s.overdueRule}
              onChange={(e) => onChange({ ...s, overdueRule: e.target.value as KhataRule })}
            >
              {RULES.map((r) => (
                <option key={r} value={r}>
                  {KHATA_RULE_LABEL[r]}
                </option>
              ))}
            </select>
          </SetupRow>
          <SetupRow
            label="Grace period"
            hint="A bill counts as overdue only after these days past the settlement day."
            htmlFor="khata-grace"
          >
            <AffixInput
              id="khata-grace"
              min={0}
              max={60}
              suffix="days"
              value={s.graceDays}
              onChange={(v) => onChange({ ...s, graceDays: Number(v) || 0 })}
            />
          </SetupRow>
          <SetupRow label="Overdue reminder every" htmlFor="khata-reminder">
            <AffixInput
              id="khata-reminder"
              min={1}
              max={30}
              suffix="days"
              value={s.reminderIntervalDays}
              onChange={(v) => onChange({ ...s, reminderIntervalDays: Number(v) || 1 })}
            />
          </SetupRow>
          <SetupRow label="WhatsApp statement" hint="Sent on each customer's settlement day, plus overdue reminders.">
            <SetupSwitch
              label="WhatsApp statement"
              on={s.statementsEnabled}
              onToggle={() => onChange({ ...s, statementsEnabled: !s.statementsEnabled })}
            />
          </SetupRow>
          <SetupRow label="Part payment online" hint="Customers can pay some of their khata from the store.">
            <SetupSwitch
              label="Part payment online"
              on={s.allowPartPayment}
              onToggle={() => onChange({ ...s, allowPartPayment: !s.allowPartPayment })}
            />
          </SetupRow>
        </>
      )}
    </SetupGroup>
  );
}
