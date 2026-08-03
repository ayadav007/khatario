'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';

const REPORTS = [
  {
    id: 'attendance',
    title: 'Monthly attendance register',
    description: 'Daily attendance rows for all employees in the selected month.',
    needsMonth: true,
  },
  {
    id: 'leave-balances',
    title: 'Leave balance summary',
    description: 'Current leave balances by employee and leave type for a year.',
    needsMonth: false,
    needsYear: true,
  },
  {
    id: 'leave-consumption',
    title: 'Leave consumption',
    description: 'Approved and pending leave requests for a year.',
    needsMonth: false,
    needsYear: true,
  },
  {
    id: 'leave-negative-balances',
    title: 'Negative leave balances',
    description: 'Employees with negative balances for a leave year.',
    needsMonth: false,
    needsYear: true,
  },
  {
    id: 'leave-accrual',
    title: 'Leave accrual register',
    description: 'Scheduled accrual job runs for the year.',
    needsMonth: false,
    needsYear: true,
  },
  {
    id: 'leave-carry-forward',
    title: 'Year-end carry forward',
    description: 'Year-end processing summary for a leave year.',
    needsMonth: false,
    needsYear: true,
  },
  {
    id: 'leave-encashment',
    title: 'Leave encashment',
    description: 'Pending and applied encashment entries.',
    needsMonth: false,
    needsYear: true,
  },
  {
    id: 'payroll-register',
    title: 'Payroll register',
    description: 'Salary payment records for the selected month.',
    needsMonth: true,
  },
  {
    id: 'statutory-ecr',
    title: 'Statutory PF/ESI CSV',
    description: 'Employee/employer PF & ESI amounts for the month (simplified ECR helper).',
    needsMonth: true,
    customPath: '/api/hr/reports/statutory-ecr',
  },
  {
    id: 'overtime-register',
    title: 'Overtime register',
    description: 'Overtime requests for the selected month.',
    needsMonth: true,
  },
  {
    id: 'headcount',
    title: 'Headcount',
    description: 'Active employees grouped by department and employment type.',
    needsMonth: false,
  },
  {
    id: 'new-joinings',
    title: 'New joinings (this month)',
    description: 'Employees who joined in the current calendar month.',
    needsMonth: false,
  },
  {
    id: 'employees-registered',
    title: 'Registered employees',
    description: 'Employees who have logged into the employee portal at least once.',
    needsMonth: false,
  },
  {
    id: 'employees-unregistered',
    title: 'Unregistered employees',
    description: 'Invited to portal but have not signed in yet.',
    needsMonth: false,
  },
] as const;

export default function HrReportsPage() {
  const { business } = useAuth();
  const toast = useToastContext();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [downloading, setDownloading] = useState<string | null>(null);

  async function download(report: (typeof REPORTS)[number]) {
    if (!business?.id) return;
    setDownloading(report.id);
    try {
      const params = new URLSearchParams({ business_id: business.id });
      if (report.needsMonth) {
        params.set('year', String(year));
        params.set('month', String(month));
        params.set(
          'salary_month',
          `${year}-${String(month).padStart(2, '0')}`,
        );
      } else if ('needsYear' in report && report.needsYear) {
        params.set('year', String(year));
        params.set('month', '1');
      }
      const path =
        'customPath' in report && report.customPath
          ? report.customPath
          : `/api/hr/reports/${report.id}`;
      const res = await fetch(`${path}?${params}`, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Download failed');
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `${report.id}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Download failed');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <SettingsPageShell
      title="HR reports"
      description="Export operational HR data as CSV"
      icon={FileSpreadsheet}
    >
      <Card className="mb-6 space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-text-secondary">Year</label>
            <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[year - 1, year, year + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-text-secondary">Month</label>
            <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {new Date(2000, m - 1, 1).toLocaleString('en-IN', { month: 'long' })}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-text-muted">
          Month applies to attendance and payroll reports. Leave balances use year only.
        </p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {REPORTS.map((report) => (
          <Card key={report.id} className="flex flex-col gap-3 p-4">
            <div>
              <h3 className="font-semibold text-text-primary">{report.title}</h3>
              <p className="mt-1 text-sm text-text-secondary">{report.description}</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="mt-auto w-full sm:w-auto"
              disabled={downloading === report.id}
              onClick={() => void download(report)}
            >
              {downloading === report.id ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="mr-2 h-4 w-4" />
              )}
              Download CSV
            </Button>
          </Card>
        ))}
      </div>
    </SettingsPageShell>
  );
}
