import type { CandidatePortalInviteEmailSettings } from './invite-email-settings';
import { DEFAULT_CANDIDATE_PORTAL_INVITE_EMAIL } from './invite-email-settings';

export type InviteEmailTaskRow = {
  name: string;
  due_at: string | null;
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDueAt(dueAt: string | null): string {
  if (!dueAt) return '—';
  return new Date(dueAt).toLocaleString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function replaceBasicVars(
  text: string,
  vars: { candidateName: string; businessName: string; portalUrl: string },
): string {
  return text
    .replace(/\{\{candidate_name\}\}/g, escapeHtml(vars.candidateName))
    .replace(/\{\{business_name\}\}/g, escapeHtml(vars.businessName))
    .replace(/\{\{portal_url\}\}/g, escapeHtml(vars.portalUrl));
}

export function buildTaskTableHtml(tasks: InviteEmailTaskRow[]): string {
  if (tasks.length === 0) {
    return '<p style="color:#555;">No tasks assigned.</p>';
  }
  const rows = tasks
    .map(
      (t) =>
        `<tr>
          <td style="padding:10px 12px;border:1px solid #e5e7eb;">${escapeHtml(t.name)} – Document Submission</td>
          <td style="padding:10px 12px;border:1px solid #e5e7eb;white-space:nowrap;">${escapeHtml(formatDueAt(t.due_at))}</td>
        </tr>`,
    )
    .join('');

  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
    <thead>
      <tr style="background:#f9fafb;">
        <th style="padding:10px 12px;border:1px solid #e5e7eb;text-align:left;">Task</th>
        <th style="padding:10px 12px;border:1px solid #e5e7eb;text-align:left;">Due by</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function buildDefaultLoginStepsHtml(): string {
  return `<p style="font-weight:600;margin:16px 0 8px;">Steps to sign in to the candidate portal</p>
<ol style="margin:0 0 16px;padding-left:20px;line-height:1.6;">
  <li>Click the <strong>Complete tasks</strong> button below.</li>
  <li>You will be directed to the candidate portal.</li>
  <li>Enter the email address you provided to your recruiter and click <strong>Send OTP</strong>.</li>
  <li>Enter the OTP sent to your email and click <strong>Login</strong>.</li>
  <li>Complete all assigned tasks before the due dates.</li>
  <li>Contact your recruiter if you face any difficulties.</li>
</ol>`;
}

export function buildCtaButtonHtml(portalUrl: string, label: string): string {
  return `<p style="margin:24px 0;">
    <a href="${escapeHtml(portalUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;font-size:15px;">
      ${escapeHtml(label)}
    </a>
  </p>`;
}

export type BuildInviteEmailInput = {
  settings: CandidatePortalInviteEmailSettings;
  candidateName: string;
  businessName: string;
  portalUrl: string;
  tasks: InviteEmailTaskRow[];
};

export function buildCandidatePortalInviteEmail(input: BuildInviteEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const vars = {
    candidateName: input.candidateName,
    businessName: input.businessName,
    portalUrl: input.portalUrl,
  };

  const taskTable = input.settings.include_task_table ? buildTaskTableHtml(input.tasks) : '';
  const loginSteps = input.settings.include_login_steps
    ? input.settings.login_steps_html?.trim()
      ? replaceBasicVars(input.settings.login_steps_html, vars)
      : buildDefaultLoginStepsHtml()
    : '';

  const intro = replaceBasicVars(input.settings.intro_html, vars)
    .replace(/\{\{task_table\}\}/g, taskTable)
    .replace(/\{\{login_steps\}\}/g, loginSteps);

  const footer = replaceBasicVars(input.settings.footer_html, vars);
  const cta = buildCtaButtonHtml(input.portalUrl, input.settings.cta_label);

  const bodyParts = [intro];
  if (input.settings.include_task_table && !input.settings.intro_html.includes('{{task_table}}')) {
    bodyParts.push(taskTable);
  }
  if (input.settings.include_login_steps && !input.settings.intro_html.includes('{{login_steps}}')) {
    bodyParts.push(loginSteps);
  }
  bodyParts.push(cta, footer);

  const html = [
    '<div style="font-family:Arial,sans-serif;font-size:15px;color:#111827;max-width:640px;line-height:1.5;">',
    ...bodyParts,
    '</div>',
  ].join('');

  const subject = replaceBasicVars(input.settings.subject, vars)
    .replace(/\{\{task_table\}\}/g, '')
    .replace(/\{\{login_steps\}\}/g, '')
    .trim();

  const taskLines = input.tasks
    .map((t) => `- ${t.name} (due ${formatDueAt(t.due_at)})`)
    .join('\n');

  const text = [
    `Hi ${input.candidateName},`,
    `${input.businessName} has assigned tasks for you to complete.`,
    taskLines,
    `Sign in: ${input.portalUrl}`,
    `Steps: Enter your email on the portal, request OTP, enter OTP to login.`,
    `Regards, ${input.businessName}`,
  ].join('\n\n');

  return { subject, html, text };
}

/** Preview with sample data for settings UI */
export function buildInviteEmailPreview(settings: CandidatePortalInviteEmailSettings): {
  subject: string;
  html: string;
} {
  const sampleTasks: InviteEmailTaskRow[] = [
    { name: 'ID Proof', due_at: new Date(Date.now() + 7 * 86400000).toISOString() },
    { name: "Last 3 Months' Salary Slip", due_at: new Date(Date.now() + 7 * 86400000).toISOString() },
    { name: 'Bank Account Proof', due_at: new Date(Date.now() + 7 * 86400000).toISOString() },
  ];

  const built = buildCandidatePortalInviteEmail({
    settings,
    candidateName: 'Sample Candidate',
    businessName: 'Your Company',
    portalUrl: 'https://staging.khatario.com/your-company/candidates',
    tasks: sampleTasks,
  });

  return { subject: built.subject, html: built.html };
}

export { DEFAULT_CANDIDATE_PORTAL_INVITE_EMAIL };
