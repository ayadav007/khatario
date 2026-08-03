'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2 } from 'lucide-react';
import { useEmployeePortal } from '@/components/employee-portal/EmployeePortalContext';

export default function EmployeePortalLeaveNewPage() {
  const router = useRouter();
  const { slug, session } = useEmployeePortal();
  const [types, setTypes] = useState<Array<{ id: string; leave_name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [totalDays, setTotalDays] = useState<number | null>(null);
  const [form, setForm] = useState({
    leave_type_id: '',
    start_date: '',
    end_date: '',
    reason: '',
    attachment_url: '',
  });

  useEffect(() => {
    if (!session) return;
    (async () => {
      const res = await fetch(
        `/api/leave-types?business_id=${session.business.id}&active_only=true`,
        { credentials: 'include' },
      );
      if (res.ok) {
        const data = await res.json();
        setTypes(data.leave_types ?? data.types ?? []);
      }
      setLoading(false);
    })();
  }, [session]);

  useEffect(() => {
    if (!session || !form.start_date || !form.end_date || !form.leave_type_id) {
      setTotalDays(null);
      return;
    }
    (async () => {
      const params = new URLSearchParams({
        business_id: session.business.id,
        start_date: form.start_date,
        end_date: form.end_date,
        leave_type_id: form.leave_type_id,
      });
      const res = await fetch(`/api/hr/leave/preview-days?${params}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setTotalDays(data.total_days);
      }
    })();
  }, [session, form.start_date, form.end_date, form.leave_type_id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/employees/leave-requests', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: session.business.id,
          employee_id: session.employee.id,
          ...form,
        }),
      });
      if (res.ok) {
        router.push(`/${slug}/employees/leaves`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <Card className="space-y-4 p-4">
        <h1 className="text-lg font-semibold text-text-primary">Apply for leave</h1>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-text-secondary">Leave type</label>
            <select
              className="input w-full"
              value={form.leave_type_id}
              onChange={(e) => setForm({ ...form, leave_type_id: e.target.value })}
              required
            >
              <option value="">Select</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.leave_name}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="Start date"
            type="date"
            value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            required
          />
          <Input
            label="End date"
            type="date"
            value={form.end_date}
            onChange={(e) => setForm({ ...form, end_date: e.target.value })}
            required
          />
          {totalDays != null && (
            <p className="text-sm text-text-secondary">
              Working days (incl. sandwich policy): <strong className="text-gray-900">{totalDays}</strong>
            </p>
          )}
          <Input
            label="Reason"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
          <Input
            label="Attachment URL (if required)"
            value={form.attachment_url}
            onChange={(e) => setForm({ ...form, attachment_url: e.target.value })}
            placeholder="https://…"
          />
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit request'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
