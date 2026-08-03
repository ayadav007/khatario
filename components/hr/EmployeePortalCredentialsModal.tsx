'use client';

import { useState } from 'react';
import { Copy, KeyRound, Loader2, Mail, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  type EmployeePortalInviteResult,
  formatPortalCredentials,
} from '@/components/hr/employee-portal-invite-api';

export function EmployeePortalCredentialsModal({
  invite,
  employeeName,
  title,
  onClose,
}: {
  invite: EmployeePortalInviteResult;
  employeeName?: string;
  title: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(formatPortalCredentials(invite));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <Card className="w-full max-w-md space-y-4 p-4 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
            {employeeName ? (
              <p className="text-sm text-text-secondary">{employeeName}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-text-secondary hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="rounded-md border border-border bg-gray-50 p-3 text-sm">
          <p className="break-all text-text-secondary">Portal: {invite.portal_url}</p>
          <p className="text-text-secondary">Employee ID: {invite.employee_code}</p>
          <p className="font-mono font-medium text-text-primary">
            Password: {invite.temporary_password}
          </p>
          <p className="mt-2 text-xs text-text-muted">
            Employee must change this password on next sign-in.
          </p>
        </div>

        {invite.errors.length > 0 ? (
          <ul className="list-disc pl-5 text-xs text-amber-800">
            {invite.errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        ) : null}

        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={() => void copy()}>
            <Copy className="mr-1 h-3.5 w-3.5" />
            {copied ? 'Copied' : 'Copy credentials'}
          </Button>
          <Button type="button" className="flex-1" onClick={onClose}>
            Done
          </Button>
        </div>
      </Card>
    </div>
  );
}
