'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Users, Clock, CheckCircle, Calendar } from 'lucide-react';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';

type Dashboard = {
  team_count: number;
  pending_leaves: number;
  pending_expenses: number;
  present_today: number;
  absent_today: number;
};

export default function ManagerDashboardPage() {
  const { business, user } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);

  const { status: authStatus } = useAuthorizationGuard({
    resource: 'leave_requests',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

  useEffect(() => {
    if (!business?.id || !user?.id) return;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          business_id: business.id,
          user_id: user.id,
        });
        const res = await fetch(`/api/employees/manager/dashboard?${params}`);
        if (res.ok) {
          setData(await res.json());
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [business?.id, user?.id]);

  if (authStatus === 'denied') {
    return <AccessDenied module="leave_requests" action="read" />;
  }

  return (
    <div>
      <ListPageHeader
        title="Manager"
        description="Your team overview and pending actions"
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
        </div>
      ) : data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-text-secondary" />
                <div>
                  <p className="text-2xl font-bold text-gray-900">{data.team_count}</p>
                  <p className="text-xs text-text-secondary">Direct reports</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-text-secondary" />
                <div>
                  <p className="text-2xl font-bold text-gray-900">{data.pending_leaves}</p>
                  <p className="text-xs text-text-secondary">Pending leaves</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-text-secondary" />
                <div>
                  <p className="text-2xl font-bold text-gray-900">{data.pending_expenses}</p>
                  <p className="text-xs text-text-secondary">Pending expenses</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-text-secondary" />
                <div>
                  <p className="text-2xl font-bold text-gray-900">{data.present_today}</p>
                  <p className="text-xs text-text-secondary">Present today</p>
                </div>
              </div>
            </Card>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/employees/manager/team"
              className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-text-primary hover:bg-gray-50"
            >
              View team
            </Link>
            <Link
              href="/employees/manager/approvals"
              className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-text-primary hover:bg-gray-50"
            >
              Pending approvals
            </Link>
            <Link
              href="/employees/manager/attendance"
              className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-text-primary hover:bg-gray-50"
            >
              Team roll call
            </Link>
            <Link
              href="/employees/org-chart?scope=my_subtree"
              className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-text-primary hover:bg-gray-50"
            >
              My org subtree
            </Link>
          </div>
        </div>
      ) : (
        <p className="text-sm text-text-secondary">Unable to load manager dashboard.</p>
      )}
    </div>
  );
}
