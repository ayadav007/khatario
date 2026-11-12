'use client';

import { TOOL_COMPONENTS } from '@/components/tools/registry';

/** Client-side holder for a tool component, so the server page never imports client-only code. */
export function FreeToolPageBody({ slug }: { slug: string }) {
  const Tool = TOOL_COMPONENTS[slug];
  if (!Tool) return null;
  return (
    <div className="free-tool-light rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <Tool />
    </div>
  );
}
