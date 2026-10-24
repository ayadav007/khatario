'use client';

import { useCallback, useEffect, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { useAdmin } from '@/context/AdminContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import type { StagingProductionDiff } from '@/lib/staging-production-diff-types';

export default function AdminReleasesPage() {
  useAdmin();
  const [data, setData] = useState<StagingProductionDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/release-diff', platformAdminFetchInit);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load comparison');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load comparison');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-8">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold text-gray-900">
            <GitBranch className="h-8 w-8 text-primary-600" />
            Staging vs production
          </h1>
          <p className="mt-2 max-w-2xl text-gray-600">
            Commits on GitHub <code className="text-sm">main</code> (staging) that are not on{' '}
            <code className="text-sm">production</code> (khatario.com). This is the same comparison as{' '}
            <code className="text-sm">git log origin/production..origin/main</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {loading ? <p className="text-sm text-gray-600">Loading comparison…</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase text-gray-500">This server</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">{data.thisHost}</p>
              <p className="text-sm text-gray-600">
                {data.thisBranch || 'unknown branch'}
                {data.thisSha ? ` @ ${data.thisSha}` : ''}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase text-gray-500">Ahead of production</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">{data.aheadBy} commits</p>
              <p className="text-sm text-gray-600">
                {data.stagingRef} vs {data.productionRef} ({data.source})
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase text-gray-500">Ship to production</p>
              <p className="mt-1 text-sm text-gray-700">
                Cherry-pick a commit onto the <code>production</code> branch, push, then deploy{' '}
                <code>/var/www/khatario-prod</code>.
              </p>
            </div>
          </div>

          {data.hint ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{data.hint}</p>
          ) : null}

          {data.commitsOnStagingNotProduction.length === 0 ? (
            <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
              Production has everything that is on main, or the comparison could not load commits.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-600">
                  <tr>
                    <th className="px-4 py-3">Commit</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">What staging has that production does not</th>
                  </tr>
                </thead>
                <tbody>
                  {data.commitsOnStagingNotProduction.map((c) => (
                    <tr key={c.sha} className="border-b border-gray-100">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-primary-700">{c.shortSha}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                        {c.date ? new Date(c.date).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-900">{c.subject}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
