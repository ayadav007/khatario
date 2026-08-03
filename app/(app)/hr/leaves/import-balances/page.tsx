'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { Upload, Download, Loader2 } from 'lucide-react';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';

const TEMPLATE = `employee_code,leave_code,opening_balance,earned_days
EMP001,CL,0,12
EMP001,SL,2,0`;

export default function LeaveBalanceImportPage() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [csv, setCsv] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null);

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leave-balances-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport() {
    if (!business?.id || !csv.trim()) return;
    setImporting(true);
    setResult(null);
    try {
      const res = await fetch('/api/hr/leave/balances/import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, csv, year }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Import failed');
        return;
      }
      setResult(data);
      toast.success(`Imported ${data.imported} rows`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <ListPageHeader
        title="Import leave balances"
        description="Bulk upload opening and earned balances via CSV"
      />

      <Card className="mb-4 space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={downloadTemplate}>
            <Download className="mr-2 h-4 w-4" />
            Download template
          </Button>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-text-secondary">Leave year</label>
          <input
            type="number"
            className="input max-w-xs"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-text-secondary">CSV content</label>
          <textarea
            className="input min-h-[160px] w-full font-mono text-sm"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={TEMPLATE}
          />
        </div>
        <Button type="button" onClick={() => void handleImport()} disabled={importing || !csv.trim()}>
          {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          Import
        </Button>
      </Card>

      {result && result.errors.length > 0 && (
        <Card className="border-red-200 bg-red-50 p-4">
          <p className="mb-2 text-sm font-medium text-red-800">Errors ({result.errors.length})</p>
          <ul className="list-inside list-disc text-sm text-red-700">
            {result.errors.slice(0, 20).map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
