'use client';

import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { buildUpgradeCopy } from '@/lib/upgrade/upgrade-copy';
import type { UpgradeRequest } from '@/lib/upgrade/upgrade-request';
import { UpgradeDialog } from './UpgradeDialog';
import { UpgradeIllustration } from './UpgradeIllustration';

/** A whole page the plan does not include: the popup's parts in place, its button opens the plans. */
export function UpgradeLockedPanel({ request, className = '' }: { request: UpgradeRequest; className?: string }) {
  const [open, setOpen] = useState(false);
  const copy = useMemo(() => buildUpgradeCopy(request, null), [request]);

  return (
    <div className={`flex justify-center px-4 py-10 ${className}`}>
      <div className="w-full max-w-[440px] overflow-hidden rounded-[18px] border border-[#ead9c6] bg-[#fffdf9] text-center text-[#1d2b28]">
        <UpgradeIllustration copy={copy} className="block h-auto w-full" />
        <div className="px-6 pb-6 pt-4">
          <span className="mb-2 inline-block rounded-full bg-[#feecde] px-2.5 py-0.5 text-[11px] font-medium text-[#8e4b13]">
            {copy.tag}
          </span>
          <h2 className="mb-1.5 text-lg font-semibold leading-snug text-primary-600">{copy.title}</h2>
          <p className="mb-4 text-sm leading-relaxed text-[#5c5247]">{copy.body}</p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent-500 px-6 text-[15px] font-semibold text-white hover:bg-accent-600"
          >
            See plans <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      {open && <UpgradeDialog request={request} onClose={() => setOpen(false)} />}
    </div>
  );
}
