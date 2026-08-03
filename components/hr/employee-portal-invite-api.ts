export type PortalInviteChannel = 'email' | 'whatsapp' | 'both';

export type EmployeePortalInviteResult = {
  temporary_password: string;
  portal_url: string;
  employee_code: string;
  email_sent: boolean;
  whatsapp_sent: boolean;
  errors: string[];
};

export type EmployeePortalInviteResponse = {
  ok: boolean;
  invite: EmployeePortalInviteResult;
  delivered: boolean;
  message: string;
};

export async function postEmployeePortalInvite(
  employeeId: string,
  businessId: string,
  options: {
    sendInvite: boolean;
    channels?: PortalInviteChannel;
  }
): Promise<EmployeePortalInviteResponse> {
  const res = await fetch(`/api/employees/${employeeId}/portal-invite`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      business_id: businessId,
      send_invite: options.sendInvite,
      channels: options.channels ?? 'both',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Portal action failed');
  }
  return data as EmployeePortalInviteResponse;
}

export function formatPortalCredentials(invite: EmployeePortalInviteResult): string {
  return [
    `Employee portal: ${invite.portal_url}`,
    `Employee ID: ${invite.employee_code}`,
    `Temporary password: ${invite.temporary_password}`,
  ].join('\n');
}
