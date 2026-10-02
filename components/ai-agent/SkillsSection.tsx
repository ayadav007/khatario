'use client';

import React, { useState } from 'react';
import { ChevronDown, ClipboardList, HelpCircle, PackageSearch, ShoppingCart, UserCheck, Wand2 } from 'lucide-react';
import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';
import type { AgentSettings } from '@/lib/ai-agent/types';
import type { WhatsAppBotUIConfig } from '@/types/whatsapp-bot-config';
import { LeadQualificationEditor, type StaffOption } from './LeadQualificationEditor';
import { SectionCard } from './SectionCard';

function SkillCard({
  icon: Icon,
  title,
  description,
  checked,
  onToggle,
  locked,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  checked: boolean;
  onToggle?: (v: boolean) => void;
  locked?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const expandable = !!children && checked;
  return (
    <div className={clsx('rounded-xl border transition-colors', checked ? 'border-primary-300 dark:border-primary-700' : 'border-border')}>
      <div className="flex items-start gap-3 p-4">
        <input
          type="checkbox"
          checked={checked}
          disabled={locked}
          onChange={(e) => onToggle?.(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-border text-primary-600 disabled:opacity-60"
          aria-label={title}
        />
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">
            {title}
            {locked && <span className="ml-2 text-xs font-normal text-text-muted">Always on</span>}
          </p>
          <p className="mt-0.5 text-xs text-text-secondary">{description}</p>
        </div>
        {expandable && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded p-1 text-text-muted hover:bg-gray-100 dark:hover:bg-slate-800"
            aria-expanded={open}
            aria-label={open ? `Hide ${title} options` : `Show ${title} options`}
          >
            <ChevronDown className={clsx('h-5 w-5 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>
      {expandable && open && <div className="border-t border-border p-4">{children}</div>}
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-text-primary">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border text-primary-600"
      />
      {label}
    </label>
  );
}

function OrderingOptions({
  behavior,
  onChange,
}: {
  behavior: WhatsAppBotUIConfig;
  onChange: (b: WhatsAppBotUIConfig) => void;
}) {
  const o = behavior.orderingProcess;
  const set = (patch: Partial<WhatsAppBotUIConfig['orderingProcess']>) =>
    onChange({ ...behavior, orderingProcess: { ...o, ...patch } });
  const setCollect = (k: keyof typeof o.collectCustomerInfo, v: boolean) =>
    set({ collectCustomerInfo: { ...o.collectCustomerInfo, [k]: v } });

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-medium uppercase text-text-muted">Collect from the customer</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Check label="Name" checked={o.collectCustomerInfo.name} onChange={(v) => setCollect('name', v)} />
          <Check label="Phone" checked={o.collectCustomerInfo.phone} onChange={(v) => setCollect('phone', v)} />
          <Check label="Email" checked={o.collectCustomerInfo.email} onChange={(v) => setCollect('email', v)} />
          <Check label="Address" checked={o.collectCustomerInfo.address} onChange={(v) => setCollect('address', v)} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Check
          label="Confirm the order with the customer first"
          checked={o.requireConfirmation}
          onChange={(v) => set({ requireConfirmation: v })}
        />
        <Check label="Allow bulk quantities" checked={o.allowBulkOrders} onChange={(v) => set({ allowBulkOrders: v })} />
      </div>
      <label className="flex items-center gap-2 text-sm text-text-primary">
        Minimum quantity per item
        <input
          type="number"
          min={1}
          className="input h-9 w-24 py-1"
          value={o.minimumQuantity ?? ''}
          placeholder="None"
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            set({ minimumQuantity: Number.isFinite(n) && n >= 1 ? n : undefined });
          }}
        />
      </label>
    </div>
  );
}

export function SkillsSection({
  businessId,
  settings,
  onChange,
  staff,
}: {
  businessId: string;
  settings: AgentSettings;
  onChange: (patch: Partial<AgentSettings>) => void;
  staff: StaffOption[];
}) {
  const skills = settings.skills;
  const setSkills = (patch: Partial<AgentSettings['skills']>) => onChange({ skills: { ...skills, ...patch } });

  return (
    <SectionCard id="skills" icon={Wand2} title="Skills" description="What your agent is allowed to do in a chat.">
      <div className="space-y-3">
        <SkillCard
          icon={HelpCircle}
          title="Answer questions"
          description="Prices, stock, timings and policies from your catalogue and knowledge."
          checked
          locked
        />
        <SkillCard
          icon={ShoppingCart}
          title="Take orders"
          description="Collect items and details, then create a draft order for your team."
          checked={skills.takeOrders}
          onToggle={(v) => setSkills({ takeOrders: v, ...(v ? {} : { paymentLinks: false }) })}
        >
          <OrderingOptions behavior={settings.behavior} onChange={(behavior) => onChange({ behavior })} />
        </SkillCard>
        <SkillCard
          icon={PackageSearch}
          title="Order status"
          description="Tell customers where their online-store order is."
          checked={skills.orderStatus}
          onToggle={(v) => setSkills({ orderStatus: v })}
        />
        <SkillCard
          icon={UserCheck}
          title="Lead qualification"
          description="Ask a few questions, save the answers and route good leads to your team."
          checked={settings.leadSkill.enabled}
          onToggle={(v) => onChange({ leadSkill: { ...settings.leadSkill, enabled: v } })}
        >
          <LeadQualificationEditor
            businessId={businessId}
            lead={settings.leadSkill}
            onChange={(leadSkill) => onChange({ leadSkill })}
            staff={staff}
          />
        </SkillCard>
        <p className="flex items-center gap-1.5 pt-1 text-xs text-text-muted">
          <ClipboardList className="h-3.5 w-3.5" /> Payment links are set up in the Payments section.
        </p>
      </div>
    </SectionCard>
  );
}
