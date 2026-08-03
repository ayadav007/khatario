'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState, useCallback } from 'react';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import { OrgChart } from '@/components/hr/OrgChart';
import type { OrgChartNode } from '@/lib/hr/org-chart';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useSearchParams } from 'next/navigation';

export default function OrgChartPage() {
  const { business, user } = useAuth();
  const searchParams = useSearchParams();
  const scope = searchParams?.get('scope');
  const [roots, setRoots] = useState<OrgChartNode[]>([]);
  const [orphans, setOrphans] = useState<OrgChartNode[]>([]);
  const [cycleIds, setCycleIds] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [department, setDepartment] = useState('');
  const [loading, setLoading] = useState(true);

  const { status: authStatus } = useAuthorizationGuard({
    resource: 'employees',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

  const fetchChart = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user.id,
      });
      if (department) params.set('department', department);
      if (scope === 'my_subtree') params.set('scope', 'my_subtree');

      const res = await fetch(`/api/employees/org-chart?${params}`);
      if (res.ok) {
        const data = await res.json();
        setRoots(data.roots || []);
        setOrphans(data.orphans || []);
        setCycleIds(data.cycleIds || []);
        setDepartments(data.departments || []);
      }
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id, department, scope]);

  useEffect(() => {
    fetchChart();
  }, [fetchChart]);

  if (authStatus === 'denied') {
    return <AccessDenied module="employees" action="read" />;
  }

  return (
    <div>
      <ListPageHeader
        title={scope === 'my_subtree' ? 'My org subtree' : 'Org chart'}
        description="Reporting hierarchy for your organization"
      />

      {departments.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDepartment('')}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              !department
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-border text-text-secondary'
            }`}
          >
            All
          </button>
          {departments.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDepartment(d)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                department === d
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-border text-text-secondary'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      )}

      <Card className="p-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
          </div>
        ) : (
          <OrgChart roots={roots} orphans={orphans} cycleIds={cycleIds} />
        )}
      </Card>
    </div>
  );
}
