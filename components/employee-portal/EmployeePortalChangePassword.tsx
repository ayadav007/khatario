'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2 } from 'lucide-react';
import { useEmployeePortal } from './EmployeePortalContext';

type Props = {
  forced?: boolean;
  onComplete?: () => void;
};

export function EmployeePortalChangePassword({ forced = false, onComplete }: Props) {
  const { refresh } = useEmployeePortal();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/public/employee/session/change-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: forced ? undefined : currentPassword,
          new_password: newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to update password');
        return;
      }
      await refresh();
      onComplete?.();
    } catch {
      setError('Failed to update password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={forced ? 'flex min-h-screen flex-col justify-center px-4 py-8' : 'p-4'}>
      <Card className={`mx-auto w-full max-w-sm space-y-4 p-4 ${forced ? '' : ''}`}>
        <div>
          <h1 className="text-lg font-semibold text-text-primary">
            {forced ? 'Set a new password' : 'Change password'}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            {forced
              ? 'Your employer shared a temporary password. Choose a new one to continue.'
              : 'Use at least 8 characters with letters and numbers.'}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {!forced && (
            <Input
              label="Current password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          )}
          <Input
            label="New password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
          <Input
            label="Confirm new password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save password'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
