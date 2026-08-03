'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmployeeShiftSelect } from '@/components/hr/EmployeeShiftSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';

type Branch = { id: string; name: string };

export default function BulkShiftAssignPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    shift_id: '',
    department: '',
    branch_id: '',
    effective_from: new Date().toISOString().slice(0, 10),
    effective_to: '',
  });

  useEffect(() => {
    if (!business?.id) return;
    void (async () => {
      const [branchRes, empRes] = await Promise.all([
        fetch(`/api/branches?business_id=${business.id}`, { credentials: 'include' }),
        fetch(`/api/employees?business_id=${business.id}&limit=500`, { credentials: 'include' }),
      ]);
      if (branchRes.ok) {
        const data = await branchRes.json();
        setBranches(data.branches ?? []);
      }
      if (empRes.ok) {
        const data = await empRes.json();
        const depts = new Set<string>();
        for (const e of data.employees ?? []) {
          if (e.department) depts.add(e.department);
        }
        setDepartments([...depts].sort());
      }
    })();
  }, [business?.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!business?.id || !user?.id) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/hr/shifts/bulk-assign', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          shift_id: form.shift_id || null,
          department: form.department || undefined,
          branch_id: form.branch_id || undefined,
          effective_from: form.effective_from,
          effective_to: form.effective_to || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Bulk assign failed');
        return;
      }
      toast.success(`Assigned shift to ${data.assigned} employee(s)`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <ListPageHeader
        title="Bulk shift assignment"
        description="Assign a shift to all active employees, or filter by department or branch"
      />

      <Card className="mx-auto max-w-xl p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <EmployeeShiftSelect
            businessId={business?.id}
            value={form.shift_id}
            onChange={(v) => setForm({ ...form, shift_id: v })}
            label="Shift"
          />

          <div>
            <label className="mb-1 block text-sm font-medium text-text-secondary">Department (optional)</label>
            <select
              className="input w-full"
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-text-secondary">Branch (optional)</label>
            <select
              className="input w-full"
              value={form.branch_id}
              onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
            >
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <Input
            label="Effective from *"
            type="date"
            value={form.effective_from}
            onChange={(e) => setForm({ ...form, effective_from: e.target.value })}
            required
          />
          <Input
            label="Effective to (optional)"
            type="date"
            value={form.effective_to}
            onChange={(e) => setForm({ ...form, effective_to: e.target.value })}
          />

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Users className="mr-2 h-4 w-4" />
            )}
            Assign shift
          </Button>
        </form>
      </Card>
    </div>
  );
}
