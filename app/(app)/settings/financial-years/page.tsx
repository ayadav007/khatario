'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarRange, Loader2, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

interface FinancialYear {
  id: string;
  year_code: string;
  start_date: string;
  end_date: string;
  notes: string | null;
  is_closed?: boolean;
}

/** Typical Indian FY: Apr 1 → Mar 31; label e.g. 2026-2027 */
function suggestedIndianFinancialYear(reference = new Date()) {
  const y = reference.getFullYear();
  const m = reference.getMonth();
  if (m >= 3) {
    return {
      year_code: `${y}-${y + 1}`,
      start_date: `${y}-04-01`,
      end_date: `${y + 1}-03-31`,
    };
  }
  return {
    year_code: `${y - 1}-${y}`,
    start_date: `${y - 1}-04-01`,
    end_date: `${y}-03-31`,
  };
}

export default function FinancialYearsSettingsPage() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [years, setYears] = useState<FinancialYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    year_code: '',
    start_date: '',
    end_date: '',
    notes: '',
  });

  const load = useCallback(async () => {
    if (!business?.id) {
      setYears([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/financial-years?business_id=${business.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setYears(data.years || []);
    } catch (e) {
      console.error(e);
      toast.error('Could not load financial years');
      setYears([]);
    } finally {
      setLoading(false);
    }
  }, [business?.id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const applySuggestedIndianFY = () => {
    const s = suggestedIndianFinancialYear();
    setForm((f) => ({
      ...f,
      year_code: s.year_code,
      start_date: s.start_date,
      end_date: s.end_date,
    }));
    setShowForm(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;
    if (!form.year_code.trim() || !form.start_date || !form.end_date) {
      toast.error('Enter year label, start date, and end date');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/financial-years', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          year_code: form.year_code.trim(),
          start_date: form.start_date,
          end_date: form.end_date,
          notes: form.notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not save');
        return;
      }
      toast.success('Financial year added');
      setForm({ year_code: '', start_date: '', end_date: '', notes: '' });
      setShowForm(false);
      await load();
    } catch (err) {
      console.error(err);
      toast.error('Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-primary-600 mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Settings
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
              <CalendarRange className="w-7 h-7 text-primary-600" />
              Financial years
            </h1>
            <p className="text-sm text-text-secondary mt-1 max-w-xl">
              Define each accounting period for your business (for example April–March). Reports like closing stock,
              GST, and year-end summaries use these periods.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={applySuggestedIndianFY}>
              Use current Indian FY (Apr–Mar)
            </Button>
            <Button type="button" size="sm" onClick={() => setShowForm((v) => !v)}>
              <Plus className="w-4 h-4 mr-1" />
              Add financial year
            </Button>
          </div>
        </div>
      </div>

      {showForm && (
        <Card>
          <h2 className="text-lg font-semibold text-text-primary mb-4">New financial year</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">Year label</label>
                <Input
                  value={form.year_code}
                  onChange={(e) => setForm((f) => ({ ...f, year_code: e.target.value }))}
                  placeholder="e.g. 2026-2027"
                  required
                />
                <p className="text-xs text-text-secondary mt-1">
                  Use the same label everywhere in the app (reports, closing stock, TDS, etc.).
                </p>
              </div>
              <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">Start date</label>
                  <Input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">End date</label>
                  <Input
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                    required
                  />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-text-primary mb-1">Notes (optional)</label>
                <Input
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional note for your team"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save'
                )}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Registered years</h2>
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
          </div>
        ) : years.length === 0 ? (
          <p className="text-sm text-text-secondary py-6 text-center">
            No financial years yet. Add one above, or use &quot;Use current Indian FY&quot; to prefill typical dates.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-secondary">
                  <th className="py-2 pr-4 font-medium">Year label</th>
                  <th className="py-2 pr-4 font-medium">Start</th>
                  <th className="py-2 pr-4 font-medium">End</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y.id} className="border-b border-border/60">
                    <td className="py-3 pr-4 font-medium text-text-primary">{y.year_code}</td>
                    <td className="py-3 pr-4 text-text-secondary">{y.start_date}</td>
                    <td className="py-3 pr-4 text-text-secondary">{y.end_date}</td>
                    <td className="py-3 text-text-secondary">{y.is_closed ? 'Closed' : 'Open'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-text-secondary">
        After saving, return to{' '}
        <Link href="/reports/stock/closing-stock" className="text-primary-600 hover:underline">
          Closing stock
        </Link>{' '}
        and choose the same year label you added here.
      </p>
    </div>
  );
}
