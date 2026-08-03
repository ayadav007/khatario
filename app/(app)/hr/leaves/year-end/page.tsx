'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useState } from 'react';
import { Loader2, Play, Eye } from 'lucide-react';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';

type PreviewRow = {
  employee_code: string;
  employee_name: string;
  leave_name: string;
  current_balance: number;
  treatment: string;
  carry_forward: number;
  encash_days: number;
  encash_amount: number;
};

export default function LeaveYearEndPage() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [leaveYear, setLeaveYear] = useState(new Date().getFullYear() - 1);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const loadPreview = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await fetch('/api/hr/leave/year-end', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, leave_year: leaveYear, preview: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Preview failed');
        return;
      }
      setPreview(data.preview ?? []);
    } finally {
      setLoading(false);
    }
  }, [business?.id, leaveYear, toast]);

  async function runYearEnd() {
    if (!business?.id) return;
    if (!confirm(`Run year-end for leave year ${leaveYear}? This cannot be undone.`)) return;
    setRunning(true);
    try {
      const res = await fetch('/api/hr/leave/year-end', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, leave_year: leaveYear, preview: false }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Year-end failed');
        return;
      }
      toast.success(`Processed ${data.processed} balance rows`);
      void loadPreview();
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <ListPageHeader
        title="Leave year-end"
        description="Preview and run carry-forward / encashment for a completed leave year"
      />

      <Card className="mb-6 space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-text-secondary">Leave year</label>
            <input
              type="number"
              className="input"
              value={leaveYear}
              onChange={(e) => setLeaveYear(Number(e.target.value))}
            />
          </div>
          <Button type="button" variant="secondary" onClick={() => void loadPreview()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
            Preview
          </Button>
          <Button type="button" onClick={() => void runYearEnd()} disabled={running}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Run year-end
          </Button>
        </div>
      </Card>

      {preview.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-gray-50 text-left text-text-secondary">
              <tr>
                <th className="p-3">Employee</th>
                <th className="p-3">Leave type</th>
                <th className="p-3">Balance</th>
                <th className="p-3">Treatment</th>
                <th className="p-3">Carry</th>
                <th className="p-3">Encash days</th>
                <th className="p-3">Encash ₹</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="p-3">
                    {row.employee_name}
                    <span className="ml-1 text-text-muted">({row.employee_code})</span>
                  </td>
                  <td className="p-3">{row.leave_name}</td>
                  <td className="p-3">{row.current_balance}</td>
                  <td className="p-3">{row.treatment}</td>
                  <td className="p-3">{row.carry_forward}</td>
                  <td className="p-3">{row.encash_days}</td>
                  <td className="p-3">{row.encash_amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
