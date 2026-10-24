import { queryOne } from '@/lib/db';
import { sendPlatformEmail } from '@/lib/platform-email';
import type { ComplianceFinding } from './checks';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function buildComplianceEmail(
  businessName: string,
  findings: Pick<ComplianceFinding, 'title' | 'message' | 'legalRef'>[],
  appUrl: string,
): { subject: string; html: string; text: string } {
  const link = `${appUrl.replace(/\/$/, '')}/reports/gst/compliance`;
  const subject =
    findings.length === 1 ? `[Khatario] GST action needed: ${findings[0].title}` : `[Khatario] ${findings.length} GST items need action`;
  const items = findings
    .map(
      (f) => `<div style="border-left:4px solid #dc2626;background:#fef2f2;padding:12px 16px;margin:12px 0;border-radius:0 6px 6px 0">
  <p style="margin:0 0 4px;font-weight:bold">${esc(f.title)}</p>
  <p style="margin:0 0 6px">${esc(f.message)}</p>
  <p style="margin:0;font-size:12px;color:#6b7280">${esc(f.legalRef)}</p>
</div>`,
    )
    .join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937;margin:0;padding:0">
<div style="max-width:600px;margin:0 auto;padding:20px">
  <h1 style="font-size:20px;margin:0 0 8px">GST alerts for ${esc(businessName)}</h1>
  <p style="margin:0 0 8px">These need your attention now:</p>
  ${items}
  <p><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:bold">Open GST alerts</a></p>
  <p style="font-size:12px;color:#6b7280">This is general information from the GST law applied to your books in Khatario, not tax advice. Please check with your CA.
  You get this email only when an alert becomes urgent; dismiss it in Khatario once handled.</p>
</div></body></html>`;
  const text = [
    `GST alerts for ${businessName}`,
    ...findings.map((f) => `- ${f.title}\n  ${f.message}\n  (${f.legalRef})`),
    `Open GST alerts: ${link}`,
    'General information, not tax advice. Please check with your CA.',
  ].join('\n\n');
  return { subject, html, text };
}

/** One email to the business address and the primary admin listing alerts that just became critical. */
export async function sendComplianceEmail(businessId: string, findings: ComplianceFinding[]): Promise<boolean> {
  if (!findings.length) return false;
  const biz = await queryOne<{ name: string | null; email: string | null; admin_email: string | null }>(
    `SELECT b.name, b.email,
            (SELECT u.email FROM users u
              WHERE u.business_id = b.id AND u.is_primary_admin = true AND u.email IS NOT NULL AND TRIM(u.email) <> ''
              LIMIT 1) AS admin_email
       FROM businesses b WHERE b.id = $1::uuid`,
    [businessId],
  );
  if (!biz) return false;
  const to = Array.from(new Set([biz.email, biz.admin_email].map((e) => e?.trim().toLowerCase()).filter((e): e is string => !!e)));
  if (!to.length) return false;
  const mail = buildComplianceEmail(biz.name || 'your business', findings, process.env.NEXT_PUBLIC_APP_URL || 'https://app.khatario.com');
  let sent = false;
  for (const address of to) {
    const ok = await sendPlatformEmail({
      to: address,
      ...mail,
      templateKey: 'gst_compliance',
      businessId,
      metadata: { alert_keys: findings.map((f) => f.key) },
    });
    sent = sent || ok;
  }
  return sent;
}
