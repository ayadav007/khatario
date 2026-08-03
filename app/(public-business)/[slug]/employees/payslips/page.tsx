'use client';

import { useEffect, useState } from 'react';
import { format, parse } from 'date-fns';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loader2 } from 'lucide-react';
import { useEmployeePortal } from '@/components/employee-portal/EmployeePortalContext';

type PayslipRow = {
  id: string;
  salary_month: string;
  net_salary: number;
  status?: string;
};

function formatSalaryMonth(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    return format(parse(trimmed, 'yyyy-MM', new Date()), 'MMMM yyyy');
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? trimmed : format(parsed, 'MMMM yyyy');
}

export default function EmployeePortalPayslipsPage() {
  const { session } = useEmployeePortal();
  const [loading, setLoading] = useState(true);
  const [payslips, setPayslips] = useState<PayslipRow[]>([]);

  useEffect(() => {
    if (!session) return;
    (async () => {
      setLoading(true);
      const res = await fetch(
        `/api/employees/salary/payslips?business_id=${session.business.id}`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        setPayslips(data.payslips ?? []);
      }
      setLoading(false);
    })();
  }, [session]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4 md:p-6">
      {payslips.length === 0 ? (
        <p className="text-center text-sm text-text-secondary">No payslips yet.</p>
      ) : (
        payslips.map((p) => (
          <Card key={p.id} className="space-y-3 p-4">
            <div>
              <p className="font-medium text-text-primary">
                {p.salary_month ? formatSalaryMonth(p.salary_month) : 'Payslip'}
              </p>
              <p className="text-lg font-bold text-gray-900">
                ₹{Number(p.net_salary ?? 0).toLocaleString('en-IN')}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() =>
                  window.open(
                    `/api/employees/salary/payslips/${p.id}/pdf?business_id=${session!.business.id}`,
                    '_blank'
                  )
                }
              >
                View PDF
              </Button>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
