'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarRange, Loader2 } from 'lucide-react';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { Button } from '@/components/ui/Button';
import { ShiftRosterWeekGrid } from '@/components/hr/shift/ShiftRosterWeekGrid';
import { useAuth } from '@/contexts/AuthContext';

type Branch = { id: string; name: string };

export default function ShiftRosterPage() {
  const { business } = useAuth();
  const [departments, setDepartments] = useState<string[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [department, setDepartment] = useState('');
  const [branchId, setBranchId] = useState('');

  useEffect(() => {
    if (!business?.id) return;
    void (async () => {
      const [branchRes, empRes] = await Promise.all([
        fetch(`/api/branches?business_id=${business.id}`, { credentials: 'include' }),
        fetch(`/api/employees?business_id=${business.id}&limit=500`, { credentials: 'include' }),
      ]);
      if (branchRes.ok) setBranches((await branchRes.json()).branches ?? []);
      if (empRes.ok) {
        const depts = new Set<string>();
        for (const e of (await empRes.json()).employees ?? []) {
          if (e.department) depts.add(e.department);
        }
        setDepartments([...depts].sort());
      }
    })();
  }, [business?.id]);

  return (
    <div className="space-y-6">
      <ListPageHeader
        title="Shift roster"
        description="Weekly shift allocation per employee — drives expected shift, late rules, and auto-absent marking"
        actions={
          <div className="flex gap-2">
            <Link href="/settings/shifts">
              <Button variant="secondary" type="button">
                Manage shifts
              </Button>
            </Link>
            <Link href="/hr/shifts/bulk-assign">
              <Button variant="secondary" type="button">
                Bulk assign
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Department</label>
          <select className="input" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">All</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Branch</label>
          <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">All</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <p className="flex items-center gap-1 text-xs text-text-muted">
          <CalendarRange className="h-3.5 w-3.5" />
          Assign shifts per day; use Off for weekly off or leave days on roster
        </p>
      </div>

      {!business?.id ? (
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      ) : (
        <ShiftRosterWeekGrid department={department || undefined} branchId={branchId || undefined} />
      )}
    </div>
  );
}
