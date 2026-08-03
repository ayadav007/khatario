'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2 } from 'lucide-react';
import { useEmployeePortal } from '@/components/employee-portal/EmployeePortalContext';
import { useToastContext } from '@/contexts/ToastContext';

export default function EmployeePortalOvertimeNewPage() {
  const router = useRouter();
  const toast = useToastContext();
  const { slug, session } = useEmployeePortal();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    request_date: new Date().toISOString().slice(0, 10),
    start_time: '',
    end_time: '',
    duration_minutes: '',
    reason: '',
    compensation_choice: '' as '' | 'monetary' | 'comp_off',
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/employees/overtime-requests', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: session.business.id,
          employee_id: session.employee.id,
          request_date: form.request_date,
          start_time: form.start_time || null,
          end_time: form.end_time || null,
          duration_minutes: Number(form.duration_minutes),
          reason: form.reason || null,
          compensation_choice: form.compensation_choice || undefined,
        }),
      });
      if (res.ok) {
        router.push(`/${slug}/employees`);
        return;
      }
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? 'Could not submit overtime request');
    } finally {
      setSubmitting(false);
    }
  };

  if (!session) return null;

  return (
    <div className="p-4 md:p-6">
      <Card className="space-y-4 p-4">
        <h1 className="text-lg font-semibold text-text-primary">Apply for overtime</h1>
        <form onSubmit={submit} className="space-y-4">
          <Input
            label="Date"
            type="date"
            value={form.request_date}
            onChange={(e) => setForm({ ...form, request_date: e.target.value })}
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Start time"
              type="time"
              value={form.start_time}
              onChange={(e) => setForm({ ...form, start_time: e.target.value })}
            />
            <Input
              label="End time"
              type="time"
              value={form.end_time}
              onChange={(e) => setForm({ ...form, end_time: e.target.value })}
            />
          </div>
          <Input
            label="Duration (minutes) *"
            type="number"
            min={1}
            value={form.duration_minutes}
            onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
            required
          />
          <div>
            <label className="mb-1 block text-sm font-medium text-text-secondary">
              Compensation preference
            </label>
            <select
              className="input w-full"
              value={form.compensation_choice}
              onChange={(e) =>
                setForm({
                  ...form,
                  compensation_choice: e.target.value as '' | 'monetary' | 'comp_off',
                })
              }
            >
              <option value="">Use policy default</option>
              <option value="monetary">Monetary payment</option>
              <option value="comp_off">Comp-off</option>
            </select>
          </div>
          <Input
            label="Reason"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit request'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
