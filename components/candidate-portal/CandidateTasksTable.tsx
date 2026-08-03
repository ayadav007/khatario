'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import { dueLabel, taskStatusLabel } from '@/lib/hr/recruitment/onboarding/validation';

export type PortalTaskListItem = {
  id: string;
  name: string;
  status: string;
  due_at: string | null;
  is_required: boolean;
};

export function CandidateTasksTable({
  tasks,
  slug,
}: {
  tasks: PortalTaskListItem[];
  slug: string;
}) {
  const required = tasks.filter((t) => t.is_required);
  const done = required.filter((t) => ['submitted', 'approved'].includes(t.status)).length;

  return (
    <section className="rounded-xl border border-border bg-white overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-4">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Tasks</h2>
          <p className="text-sm text-text-secondary mt-1">
            Complete the requested tasks to proceed further.
          </p>
        </div>
        <div className="text-sm font-medium text-text-secondary shrink-0">
          {done}/{required.length} complete
        </div>
      </div>

      {tasks.length === 0 ? (
        <p className="p-6 text-sm text-text-secondary text-center">
          No tasks assigned yet. HR will send your checklist soon.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-gray-50 text-left text-text-secondary">
                <th className="px-4 py-3 font-medium">Name of the task</th>
                <th className="px-4 py-3 font-medium">Due date</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium w-12" />
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} className="border-b border-border last:border-0 hover:bg-gray-50/80">
                  <td className="px-4 py-4 font-medium text-text-primary">{task.name}</td>
                  <td className="px-4 py-4 text-text-secondary">{dueLabel(task.due_at)}</td>
                  <td className="px-4 py-4">
                    <StatusBadge status={task.status} />
                  </td>
                  <td className="px-4 py-4">
                    <Link
                      href={`/${slug}/candidates/tasks/${task.id}`}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-gray-100"
                      aria-label={`Open ${task.name}`}
                    >
                      <ChevronRight className="h-5 w-5 text-text-secondary" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = taskStatusLabel(status);
  const tone =
    status === 'approved'
      ? 'bg-green-100 text-green-800'
      : status === 'submitted'
        ? 'bg-amber-100 text-amber-800'
        : status === 'changes_requested'
          ? 'bg-red-100 text-red-800'
          : 'bg-amber-50 text-amber-700';

  return (
    <span className={clsx('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', tone)}>
      {label}
    </span>
  );
}