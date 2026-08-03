'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Eye } from 'lucide-react';
import { Chip } from '@/components/ui/Chip';

type TeamMember = {
  id: string;
  employee_code: string;
  name: string;
  designation: string | null;
  department: string | null;
  attendance_status: string | null;
};

export default function ManagerTeamPage() {
  const { business, user } = useAuth();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!business?.id || !user?.id) return;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          business_id: business.id,
          user_id: user.id,
        });
        const res = await fetch(`/api/employees/manager/team?${params}`);
        if (res.ok) {
          const data = await res.json();
          setTeam(data.team || []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [business?.id, user?.id]);

  return (
    <div>
      <ListPageHeader title="My team" description="Direct reports" />

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
        </div>
      ) : team.length === 0 ? (
        <p className="text-sm text-text-secondary">You have no direct reports assigned.</p>
      ) : (
        <div className="space-y-3">
          {team.map((m) => (
            <Card key={m.id} className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium text-text-primary">{m.name}</p>
                <p className="text-sm text-text-secondary">
                  {m.employee_code}
                  {m.designation ? ` · ${m.designation}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Chip
                  variant={
                    m.attendance_status === 'present' || m.attendance_status === 'half_day'
                      ? 'success'
                      : 'default'
                  }
                >
                  {m.attendance_status || 'absent'}
                </Chip>
                <Link
                  href={`/employees/${m.id}`}
                  className="rounded p-2 text-text-secondary hover:bg-gray-100"
                >
                  <Eye className="h-4 w-4" />
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
