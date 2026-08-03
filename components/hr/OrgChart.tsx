'use client';

import Link from 'next/link';
import { ChevronDown, ChevronRight, User } from 'lucide-react';
import { useState } from 'react';
import type { OrgChartNode } from '@/lib/hr/org-chart';
import { clsx } from 'clsx';

function OrgChartNodeRow({
  node,
  depth,
}: {
  node: OrgChartNode;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  return (
    <div className={clsx(depth > 0 && 'ml-4 border-l border-border pl-3')}>
      <div className="flex items-center gap-2 py-2">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="shrink-0 rounded p-0.5 text-text-secondary hover:bg-gray-100"
            aria-expanded={open}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <User className="h-4 w-4 shrink-0 text-text-muted" />
        <Link
          href={`/employees/${node.id}`}
          className="min-w-0 flex-1 link-primary"
        >
          <span className="font-medium text-text-primary">{node.name}</span>
          <span className="ml-2 text-xs text-text-secondary">{node.employee_code}</span>
        </Link>
        {(node.designation || node.department) && (
          <span className="hidden shrink-0 text-xs text-text-muted sm:inline">
            {[node.designation, node.department].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      {hasChildren && open && (
        <div>
          {node.children.map((child) => (
            <OrgChartNodeRow key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function OrgChart({
  roots,
  orphans,
  cycleIds,
}: {
  roots: OrgChartNode[];
  orphans: OrgChartNode[];
  cycleIds: string[];
}) {
  if (roots.length === 0 && orphans.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-text-secondary">
        No employees in org chart. Assign reporting managers on employee profiles.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {cycleIds.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {cycleIds.length} employee(s) excluded due to circular reporting relationships. Fix
          reporting managers on their profiles.
        </div>
      )}
      {roots.map((root) => (
        <OrgChartNodeRow key={root.id} node={root} depth={0} />
      ))}
      {orphans.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-text-secondary">Unassigned / invalid manager</h3>
          {orphans.map((node) => (
            <OrgChartNodeRow key={node.id} node={node} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}
