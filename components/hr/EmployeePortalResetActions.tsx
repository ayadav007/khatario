'use client';

import { useState } from 'react';
import { KeyRound, Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  postEmployeePortalInvite,
  type EmployeePortalInviteResult,
  type PortalInviteChannel,
} from '@/components/hr/employee-portal-invite-api';
import { EmployeePortalCredentialsModal } from '@/components/hr/EmployeePortalCredentialsModal';

type Props = {
  employeeId: string;
  businessId: string;
  employeeName: string;
  employeeCode?: string;
  /** compact = icon buttons for table rows */
  variant?: 'default' | 'compact';
  channels?: PortalInviteChannel;
  disabled?: boolean;
  onSuccess?: () => void;
};

export function EmployeePortalResetActions({
  employeeId,
  businessId,
  employeeName,
  employeeCode,
  variant = 'default',
  channels = 'both',
  disabled = false,
  onSuccess,
}: Props) {
  const [busy, setBusy] = useState<'invite' | 'reset' | null>(null);
  const [credentials, setCredentials] = useState<{
    invite: EmployeePortalInviteResult;
    title: string;
  } | null>(null);

  async function run(sendInvite: boolean) {
    const label = sendInvite ? 'send portal invite' : 'reset password only';
    const name = employeeCode ? `${employeeName} (${employeeCode})` : employeeName;
    if (
      !window.confirm(
        sendInvite
          ? `Send portal invite to ${name}? A new temporary password will be emailed/WhatsApp'd if configured.`
          : `Reset portal password for ${name}? No email or WhatsApp will be sent — you must share the new password manually.`
      )
    ) {
      return;
    }

    setBusy(sendInvite ? 'invite' : 'reset');
    try {
      const data = await postEmployeePortalInvite(employeeId, businessId, {
        sendInvite,
        channels,
      });
      setCredentials({
        invite: data.invite,
        title: sendInvite
          ? data.delivered
            ? 'Portal invite sent'
            : 'Password set — share manually'
          : 'New temporary password',
      });
      onSuccess?.();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  const inviteBusy = busy === 'invite';
  const resetBusy = busy === 'reset';

  if (variant === 'compact') {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || !!busy}
          title="Send portal invite"
          onClick={() => void run(true)}
        >
          {inviteBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Mail className="h-4 w-4" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || !!busy}
          title="Reset password only (no message sent)"
          onClick={() => void run(false)}
        >
          {resetBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <KeyRound className="h-4 w-4" />
          )}
        </Button>
        {credentials ? (
          <EmployeePortalCredentialsModal
            invite={credentials.invite}
            employeeName={employeeName}
            title={credentials.title}
            onClose={() => setCredentials(null)}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || !!busy}
          onClick={() => void run(true)}
        >
          {inviteBusy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Mail className="mr-2 h-4 w-4" />
          )}
          Send portal invite
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || !!busy}
          onClick={() => void run(false)}
        >
          {resetBusy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <KeyRound className="mr-2 h-4 w-4" />
          )}
          Reset password only
        </Button>
      </div>
      {credentials ? (
        <EmployeePortalCredentialsModal
          invite={credentials.invite}
          employeeName={employeeName}
          title={credentials.title}
          onClose={() => setCredentials(null)}
        />
      ) : null}
    </>
  );
}
