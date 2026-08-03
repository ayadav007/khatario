import { queryOne } from '@/lib/db';
import { sendBusinessEmail } from '@/lib/business-email';
import { sendWhatsAppMessage, getWhatsAppStatus } from '@/lib/whatsapp';
import { ensureBusinessPortalSlug } from '@/lib/customer-surface';
import { employeePortalUrl } from '@/lib/employee-portal/urls';
import { hasFeatureAccess } from '@/lib/subscription/feature-access';
import { generateEmployeePortalTemporaryPassword } from '@/lib/employee-portal/invite-password';
import { updateEmployeePortalPassword } from '@/lib/employee-portal/password';
import {
  resolvePortalInviteChannels,
  type PortalInviteChannel,
} from '@/lib/employee-portal/invite-channels';

export { generateEmployeePortalTemporaryPassword } from '@/lib/employee-portal/invite-password';
export type { PortalInviteChannel } from '@/lib/employee-portal/invite-channels';
export { resolvePortalInviteChannels } from '@/lib/employee-portal/invite-channels';

export type EmployeePortalInviteResult = {
  temporary_password: string;
  portal_url: string;
  employee_code: string;
  email_sent: boolean;
  whatsapp_sent: boolean;
  errors: string[];
};

function buildInviteMessages(params: {
  employeeName: string;
  businessName: string;
  portalUrl: string;
  employeeCode: string;
  temporaryPassword: string;
}) {
  const { employeeName, businessName, portalUrl, employeeCode, temporaryPassword } = params;
  const text = [
    `Hello ${employeeName},`,
    '',
    `${businessName} has set up your employee portal.`,
    '',
    `Portal: ${portalUrl}`,
    `Employee ID: ${employeeCode}`,
    `Temporary password: ${temporaryPassword}`,
    '',
    'Sign in and change your password after your first login.',
  ].join('\n');

  const html = [
    '<div style="font-family: Arial, sans-serif; font-size: 16px; color: #222; line-height: 1.5;">',
    `<p>Hello ${employeeName},</p>`,
    `<p><strong>${businessName}</strong> has set up your employee portal for attendance, leave, payslips, and more.</p>`,
    `<p><a href="${portalUrl}">Open employee portal</a></p>`,
    '<table style="margin:16px 0;border-collapse:collapse;">',
    `<tr><td style="padding:4px 12px 4px 0;color:#555;">Employee ID</td><td><strong>${employeeCode}</strong></td></tr>`,
    `<tr><td style="padding:4px 12px 4px 0;color:#555;">Temporary password</td><td><strong>${temporaryPassword}</strong></td></tr>`,
    '</table>',
    '<p style="color:#555;font-size:14px;">Please change your password after signing in.</p>',
    '</div>',
  ].join('');

  return { text, html };
}

export async function setEmployeePortalPassword(
  employeeId: string,
  businessId: string,
  plainPassword: string
): Promise<void> {
  await updateEmployeePortalPassword(employeeId, businessId, plainPassword, {
    mustChange: true,
  });
}

export async function resetEmployeePortalPasswordOnly(params: {
  businessId: string;
  employeeId: string;
}): Promise<EmployeePortalInviteResult> {
  const portalEnabled = await hasFeatureAccess(params.businessId, 'hr_employee_portal');
  if (!portalEnabled) {
    throw new Error('Employee portal is not enabled on your subscription plan.');
  }

  const row = await queryOne<{
    employee_code: string;
  }>(
    `SELECT e.employee_code
     FROM employees e
     INNER JOIN users u ON u.id = e.id
     WHERE e.id = $1 AND e.business_id = $2 AND e.is_active = true AND u.is_active = true`,
    [params.employeeId, params.businessId]
  );

  if (!row) {
    throw new Error('Employee not found');
  }

  const business = await queryOne<{ name: string }>(
    `SELECT name FROM businesses WHERE id = $1`,
    [params.businessId]
  );
  const businessName = business?.name ?? 'Your employer';
  const slug = await ensureBusinessPortalSlug(params.businessId, businessName);
  const portalUrl = employeePortalUrl(slug);

  const temporaryPassword = generateEmployeePortalTemporaryPassword();
  await setEmployeePortalPassword(params.employeeId, params.businessId, temporaryPassword);

  await queryOne(
    `UPDATE employees SET portal_invited_at = CURRENT_TIMESTAMP WHERE id = $1 AND business_id = $2`,
    [params.employeeId, params.businessId]
  );

  return {
    temporary_password: temporaryPassword,
    portal_url: portalUrl,
    employee_code: row.employee_code,
    email_sent: false,
    whatsapp_sent: false,
    errors: [],
  };
}

export async function sendEmployeePortalInvite(params: {
  businessId: string;
  employeeId: string;
  channels: PortalInviteChannel;
  temporaryPassword?: string;
}): Promise<EmployeePortalInviteResult> {
  const portalEnabled = await hasFeatureAccess(params.businessId, 'hr_employee_portal');
  if (!portalEnabled) {
    throw new Error('Employee portal is not enabled on your subscription plan.');
  }

  const row = await queryOne<{
    employee_code: string;
    user_name: string;
    user_email: string | null;
    user_phone: string | null;
  }>(
    `SELECT e.employee_code, u.name AS user_name, u.email AS user_email, u.phone AS user_phone
     FROM employees e
     INNER JOIN users u ON u.id = e.id
     WHERE e.id = $1 AND e.business_id = $2 AND e.is_active = true AND u.is_active = true`,
    [params.employeeId, params.businessId]
  );

  if (!row) {
    throw new Error('Employee not found');
  }

  const resolved = resolvePortalInviteChannels(params.channels, {
    email: row.user_email,
    phone: row.user_phone,
  });
  const effectiveChannels = resolved.channels;
  const wantsEmail = effectiveChannels === 'email' || effectiveChannels === 'both';
  const wantsWhatsapp = effectiveChannels === 'whatsapp' || effectiveChannels === 'both';

  const business = await queryOne<{ name: string }>(
    `SELECT name FROM businesses WHERE id = $1`,
    [params.businessId]
  );
  const businessName = business?.name ?? 'Your employer';
  const slug = await ensureBusinessPortalSlug(params.businessId, businessName);
  const portalUrl = employeePortalUrl(slug);

  const temporaryPassword =
    params.temporaryPassword?.trim() || generateEmployeePortalTemporaryPassword();
  await setEmployeePortalPassword(params.employeeId, params.businessId, temporaryPassword);

  const { text, html } = buildInviteMessages({
    employeeName: row.user_name,
    businessName,
    portalUrl,
    employeeCode: row.employee_code,
    temporaryPassword,
  });

  const errors: string[] = [...resolved.notes];
  let emailSent = false;
  let whatsappSent = false;

  if (wantsEmail && row.user_email) {
    const emailResult = await sendBusinessEmail(params.businessId, {
      to: row.user_email.trim(),
      subject: `${businessName} — your employee portal login`,
      html,
      text,
    });
    if (emailResult.success) {
      emailSent = true;
    } else {
      errors.push(emailResult.error ?? 'Failed to send email invite');
    }
  }

  if (wantsWhatsapp && row.user_phone) {
    try {
      const waStatus = await getWhatsAppStatus(params.businessId);
      if (waStatus.status !== 'connected') {
        errors.push('WhatsApp is not connected. Open More → Connect WhatsApp in the sidebar.');
      } else {
        await sendWhatsAppMessage(params.businessId, row.user_phone, text, undefined, 'text');
        whatsappSent = true;
      }
    } catch (error: unknown) {
      errors.push(
        error instanceof Error ? error.message : 'Failed to send WhatsApp invite'
      );
    }
  }

  if (emailSent || whatsappSent || !effectiveChannels) {
    await queryOne(
      `UPDATE employees SET portal_invited_at = CURRENT_TIMESTAMP WHERE id = $1 AND business_id = $2`,
      [params.employeeId, params.businessId]
    );
  }

  return {
    temporary_password: temporaryPassword,
    portal_url: portalUrl,
    employee_code: row.employee_code,
    email_sent: emailSent,
    whatsapp_sent: whatsappSent,
    errors,
  };
}
