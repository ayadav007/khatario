'use client';

import { useEffect, useState } from 'react';
import { Copy, Loader2, Mail, MessageCircle, KeyRound } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';
import {
  postEmployeePortalInvite,
  formatPortalCredentials,
  type PortalInviteChannel,
  type EmployeePortalInviteResult,
} from '@/components/hr/employee-portal-invite-api';
import { resolvePortalInviteChannels } from '@/lib/employee-portal/invite-channels';

type InviteResult = EmployeePortalInviteResult;

interface EmployeePortalInviteCardProps {
  employeeId: string;
  businessId: string;
  employeeEmail?: string | null;
  employeePhone?: string | null;
  employeeCode?: string;
  portalInvitedAt?: string | null;
  /** Compact layout for the new-employee form (checkbox only, no send button) */
  mode?: 'send' | 'form';
  sendPortalInvite?: boolean;
  onSendPortalInviteChange?: (value: boolean) => void;
  portalInviteVia?: PortalInviteChannel;
  onPortalInviteViaChange?: (value: PortalInviteChannel) => void;
}

export function EmployeePortalInviteCard({
  employeeId,
  businessId,
  employeeEmail,
  employeePhone,
  employeeCode,
  portalInvitedAt,
  mode = 'send',
  sendPortalInvite = false,
  onSendPortalInviteChange,
  portalInviteVia = 'both',
  onPortalInviteViaChange,
}: EmployeePortalInviteCardProps) {
  const toast = useToastContext();
  const [busy, setBusy] = useState<'invite' | 'reset' | false>(false);
  const [lastInvite, setLastInvite] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [localChannel, setLocalChannel] = useState<PortalInviteChannel>(portalInviteVia);

  const activeChannel =
    mode === 'form' ? portalInviteVia : localChannel;
  const setActiveChannel = (value: PortalInviteChannel) => {
    if (mode === 'form') {
      onPortalInviteViaChange?.(value);
    } else {
      setLocalChannel(value);
    }
  };

  async function applyInviteResult(
    data: Awaited<ReturnType<typeof postEmployeePortalInvite>>,
    invite: InviteResult
  ) {
    setLastInvite(invite);
    if (invite.email_sent && invite.whatsapp_sent) {
      toast.success('Portal invite sent by email and WhatsApp');
    } else if (invite.email_sent) {
      toast.success('Portal invite sent by email');
    } else if (invite.whatsapp_sent) {
      toast.success('Portal invite sent on WhatsApp');
    } else {
      toast.warning(data.message || 'Password generated — share credentials manually.');
    }
    invite.errors?.forEach((err) => toast.warning(err));
  }

  async function sendInvite() {
    setBusy('invite');
    try {
      const data = await postEmployeePortalInvite(employeeId, businessId, {
        sendInvite: true,
        channels: activeChannel,
      });
      await applyInviteResult(data, data.invite);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to send portal invite');
    } finally {
      setBusy(false);
    }
  }

  async function resetPasswordOnly() {
    if (
      !window.confirm(
        'Reset portal password without sending email or WhatsApp? You will need to share the new password manually.'
      )
    ) {
      return;
    }
    setBusy('reset');
    try {
      const data = await postEmployeePortalInvite(employeeId, businessId, {
        sendInvite: false,
      });
      setLastInvite(data.invite);
      toast.success(data.message || 'Temporary password set');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reset password');
    } finally {
      setBusy(false);
    }
  }

  async function copyCredentials() {
    if (!lastInvite) return;
    await navigator.clipboard.writeText(formatPortalCredentials(lastInvite));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const needsEmail = activeChannel === 'email' || activeChannel === 'both';
  const needsPhone = activeChannel === 'whatsapp' || activeChannel === 'both';
  const hasEmail = Boolean(employeeEmail?.trim());
  const hasPhone = Boolean(employeePhone?.trim());
  const resolvedPreview = resolvePortalInviteChannels(activeChannel, {
    email: employeeEmail,
    phone: employeePhone,
  });

  useEffect(() => {
    if (mode !== 'form' || !sendPortalInvite || !onPortalInviteViaChange) return;
    if (activeChannel === 'both' && hasPhone && !hasEmail) {
      onPortalInviteViaChange('whatsapp');
    } else if (activeChannel === 'email' && !hasEmail && hasPhone) {
      onPortalInviteViaChange('whatsapp');
    }
  }, [
    mode,
    sendPortalInvite,
    activeChannel,
    hasEmail,
    hasPhone,
    onPortalInviteViaChange,
  ]);

  if (mode === 'form') {
    return (
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-text-primary">Employee portal access</h3>
        <p className="mt-1 text-sm text-text-secondary">
          Send a portal link and temporary password so the employee can sign in at your company
          employee portal. Email is optional — WhatsApp or manual sharing works too.
        </p>

        <label className="mt-4 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-border text-primary-600 focus:ring-primary-500"
            checked={sendPortalInvite}
            onChange={(e) => onSendPortalInviteChange?.(e.target.checked)}
          />
          <span className="text-sm text-text-primary">
            Send portal invite with temporary password
          </span>
        </label>

        {sendPortalInvite ? (
          <div className="mt-3 space-y-2">
            <label className="block text-sm font-medium text-text-secondary">Send via</label>
            <select
              className="input w-full max-w-xs"
              value={activeChannel}
              onChange={(e) =>
                setActiveChannel(e.target.value as PortalInviteChannel)
              }
            >
              <option value="whatsapp" disabled={!hasPhone}>
                WhatsApp only{hasPhone ? '' : ' (add phone above)'}
              </option>
              <option value="email" disabled={!hasEmail}>
                Email only{hasEmail ? '' : ' (add email above)'}
              </option>
              <option value="both" disabled={!hasEmail || !hasPhone}>
                Email and WhatsApp
              </option>
            </select>
            {needsEmail && !hasEmail ? (
              <p className="text-xs text-text-secondary">
                No email — invite will go on WhatsApp or you can copy credentials after saving.
              </p>
            ) : null}
            {needsPhone && !hasPhone ? (
              <p className="text-xs text-amber-700">Phone is required for WhatsApp invite.</p>
            ) : null}
            {resolvedPreview.notes.map((note) => (
              <p key={note} className="text-xs text-text-secondary">
                {note}
              </p>
            ))}
            <p className="text-xs text-text-muted">
              Email uses your business SMTP (Settings → Email). WhatsApp uses your connected
              WhatsApp session. If neither works, credentials are shown once after create.
            </p>
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-text-primary">Employee portal</h3>
        <p className="mt-1 text-sm text-text-secondary">
          Send login credentials for the employee self-service portal
          {employeeCode ? ` (${employeeCode})` : ''}. The employee will be prompted to
          change the temporary password on first sign-in.
        </p>
      {portalInvitedAt ? (
        <p className="mt-2 text-xs text-text-muted">
          Last invite sent: {new Date(portalInvitedAt).toLocaleString()}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Send via</label>
          <select
            className="input min-w-[180px]"
            value={activeChannel}
            onChange={(e) => setActiveChannel(e.target.value as PortalInviteChannel)}
          >
            <option value="both">Email and WhatsApp</option>
            <option value="email">Email only</option>
            <option value="whatsapp">WhatsApp only</option>
          </select>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={!!busy}
          onClick={() => void sendInvite()}
        >
          {busy === 'invite' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Mail className="mr-2 h-4 w-4" />
          )}
          Send portal invite
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!!busy}
          onClick={() => void resetPasswordOnly()}
        >
          {busy === 'reset' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <KeyRound className="mr-2 h-4 w-4" />
          )}
          Reset password only
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-xs text-text-secondary">
        {employeeEmail ? (
          <span className="inline-flex items-center gap-1">
            <Mail className="h-3.5 w-3.5" />
            {employeeEmail}
          </span>
        ) : (
          <span className="text-amber-700">No email on file</span>
        )}
        {employeePhone ? (
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="h-3.5 w-3.5" />
            {employeePhone}
          </span>
        ) : (
          <span className="text-amber-700">No phone on file</span>
        )}
      </div>

      {lastInvite ? (
        <div className="mt-3 rounded-md border border-border bg-gray-50 p-3 text-sm">
          <p className="font-medium text-text-primary">Credentials (shown once)</p>
          <p className="mt-1 break-all text-text-secondary">
            Portal: {lastInvite.portal_url}
          </p>
          <p className="text-text-secondary">Employee ID: {lastInvite.employee_code}</p>
          <p className="font-mono font-medium text-text-primary">
            Password: {lastInvite.temporary_password}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => void copyCredentials()}
          >
            <Copy className="mr-1 h-3.5 w-3.5" />
            {copied ? 'Copied' : 'Copy credentials'}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

/** Show invite result returned from POST /api/employees after create */
export function EmployeePortalInviteResultBanner({
  invite,
}: {
  invite: InviteResult | null | undefined;
}) {
  const [copied, setCopied] = useState(false);
  if (!invite) return null;

  const delivered = invite.email_sent || invite.whatsapp_sent;
  const passwordReady = Boolean(invite.temporary_password?.trim());

  async function copy() {
    const text = [
      `Employee portal: ${invite!.portal_url}`,
      `Employee ID: ${invite!.employee_code}`,
      `Temporary password: ${invite!.temporary_password}`,
    ].join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card
      className={`border p-4 ${
        passwordReady
          ? 'border-green-200 bg-green-50'
          : 'border-amber-200 bg-amber-50'
      }`}
    >
      <p
        className={`text-sm font-medium ${
          passwordReady ? 'text-green-800' : 'text-amber-900'
        }`}
      >
        {passwordReady
          ? delivered
            ? 'Portal invite sent'
            : 'Portal password created — share manually'
          : 'Portal password was not saved'}
      </p>
      {passwordReady ? (
        <>
          <p className="mt-1 break-all text-sm text-green-900">{invite.portal_url}</p>
          <p className="text-sm text-green-900">
            Employee ID: <strong>{invite.employee_code}</strong> · Password:{' '}
            <strong className="font-mono">{invite.temporary_password}</strong>
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-amber-900">
          Open the employee profile and use <strong>Send portal invite</strong> or{' '}
          <strong>Reset portal password</strong> to generate new credentials.
        </p>
      )}
      {invite.errors.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-xs text-amber-800">
          {invite.errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      ) : null}
      {passwordReady ? (
        <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => void copy()}>
          <Copy className="mr-1 h-3.5 w-3.5" />
          {copied ? 'Copied' : 'Copy credentials'}
        </Button>
      ) : null}
    </Card>
  );
}
