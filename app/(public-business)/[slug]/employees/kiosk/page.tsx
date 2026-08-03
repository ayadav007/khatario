'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2 } from 'lucide-react';
import { useEmployeePortal } from '@/components/employee-portal/EmployeePortalContext';

/** Shared-device check-in by employee code (no full portal login). */
export default function EmployeePortalKioskPage() {
  const { slug, session, kioskEnabled, loading: portalLoading } = useEmployeePortal();
  const [code, setCode] = useState('');
  const [employeeName, setEmployeeName] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (session) return;
    setMessage(null);
  }, [session]);

  const checkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setProcessing(true);
    setMessage(null);
    try {
      const loginRes = await fetch(`/api/public/employee/${encodeURIComponent(slug)}/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_code: code.trim(), kiosk: true }),
      });
      const loginData = await loginRes.json();
      if (!loginRes.ok) {
        setMessage(loginData.error ?? 'Invalid employee code');
        return;
      }
      setEmployeeName(loginData.employee?.name ?? code.trim());

      const attRes = await fetch('/api/employees/attendance/check-in', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'kiosk' }),
      });
      if (attRes.ok) {
        setMessage('Checked in successfully');
        setCode('');
      } else {
        const attData = await attRes.json();
        setMessage(attData.error ?? 'Check-in failed');
      }
    } finally {
      setProcessing(false);
    }
  };

  if (portalLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (kioskEnabled === false) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <Card className="w-full max-w-sm space-y-3 p-6 text-center">
          <h1 className="text-lg font-semibold text-text-primary">Kiosk unavailable</h1>
          <p className="text-sm text-text-secondary">
            Attendance kiosk has been disabled by your HR admin.
          </p>
        </Card>
      </div>
    );
  }

  if (session) {
    return (
      <div className="p-4">
        <Card className="space-y-3 p-4 text-center">
          <p className="text-sm text-text-secondary">You are logged in as {session.employee.name}.</p>
          <Button className="w-full" onClick={() => window.location.assign(`/${slug}/employees/attendance`)}>
            Go to attendance
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-text-primary">Attendance kiosk</h1>
          <p className="mt-1 text-sm text-text-secondary">Enter your employee ID to check in</p>
        </div>
        <form onSubmit={checkIn} className="space-y-4">
          <Input
            label="Employee code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            required
          />
          <Button type="submit" className="w-full" disabled={processing}>
            {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Check in'}
          </Button>
        </form>
        {employeeName && message ? (
          <p className="text-center text-sm text-green-800">{employeeName}: {message}</p>
        ) : message ? (
          <p className="text-center text-sm text-red-700">{message}</p>
        ) : null}
      </Card>
    </div>
  );
}
