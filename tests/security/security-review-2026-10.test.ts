import { csvSafeText } from '@/lib/csv-safe';
import { isNonPublicIp, loadOutboundMedia, OutboundMediaError } from '@/lib/http/outbound-media';
import {
  isEssApiAllowed,
  isKioskSessionApiAllowed,
  isKioskSessionToken,
} from '@/lib/employee-portal/ess-api-allowlist';
import { createKioskDeviceToken, verifyKioskDeviceToken } from '@/lib/employee-portal/kiosk-device';
import { parseHrPortalSettings } from '@/lib/hr/hr-portal-settings';
import { sanitizeDocumentTemplateHtml, escapeDocumentValue } from '@/lib/hr/document-html';
import { getClientIp } from '@/lib/rate-limit';
import { readStoreCustomer, signStoreCustomer } from '@/lib/store/customer-session';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-security-review';

describe('C2: outbound WhatsApp media', () => {
  it.each(['/proc/self/environ', 'file:///etc/passwd', 'http://example.com/a.png', 'C:\\Windows\\win.ini'])(
    'refuses %s',
    async (media) => {
      await expect(loadOutboundMedia(media)).rejects.toBeInstanceOf(OutboundMediaError);
    }
  );

  it('refuses https URLs on private and metadata addresses', async () => {
    await expect(loadOutboundMedia('https://169.254.169.254/latest/meta-data')).rejects.toBeInstanceOf(OutboundMediaError);
    await expect(loadOutboundMedia('https://127.0.0.1/x')).rejects.toBeInstanceOf(OutboundMediaError);
    await expect(loadOutboundMedia('https://[::1]/x')).rejects.toBeInstanceOf(OutboundMediaError);
  });

  it('decodes data URLs and passes buffers through', async () => {
    const buf = await loadOutboundMedia('data:image/png;base64,' + Buffer.from('hello').toString('base64'));
    expect(buf.toString()).toBe('hello');
    const b = Buffer.from('x');
    expect(await loadOutboundMedia(b)).toBe(b);
  });

  it('classifies addresses', () => {
    for (const ip of ['10.0.0.1', '172.16.5.4', '192.168.1.1', '127.0.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isNonPublicIp(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) {
      expect(isNonPublicIp(ip)).toBe(false);
    }
  });
});

describe('C1/C4: employee portal and kiosk', () => {
  it('no longer lets a portal cookie reach every GET under /api/employees/', () => {
    expect(isEssApiAllowed('GET', '/api/employees/salary/payments')).toBe(false);
    expect(isEssApiAllowed('GET', '/api/employees/org-chart')).toBe(false);
    expect(isEssApiAllowed('GET', '/api/employees/salary/payslips')).toBe(true);
  });

  it('limits kiosk sessions to check-in and check-out', () => {
    expect(isKioskSessionToken('k_abc')).toBe(true);
    expect(isKioskSessionToken('abc')).toBe(false);
    expect(isKioskSessionApiAllowed('POST', '/api/employees/attendance/check-in')).toBe(true);
    expect(isKioskSessionApiAllowed('POST', '/api/employees/attendance/check-out')).toBe(true);
    expect(isKioskSessionApiAllowed('GET', '/api/employees/salary/payslips')).toBe(false);
    expect(isKioskSessionApiAllowed('POST', '/api/employees/leave-requests')).toBe(false);
  });

  it('keeps the kiosk off unless a business turns it on', () => {
    expect(parseHrPortalSettings(null).kiosk_enabled).toBe(false);
    expect(parseHrPortalSettings({}).kiosk_enabled).toBe(false);
    expect(parseHrPortalSettings({ kiosk_enabled: true }).kiosk_enabled).toBe(true);
  });

  it('accepts only a device token signed for the same business and generation', () => {
    const token = createKioskDeviceToken('biz-a', 2);
    expect(verifyKioskDeviceToken(token, 'biz-a', 2)).toBe(true);
    expect(verifyKioskDeviceToken(token, 'biz-b', 2)).toBe(false);
    expect(verifyKioskDeviceToken(token, 'biz-a', 3)).toBe(false);
    expect(verifyKioskDeviceToken(token.replace(/.$/, 'x'), 'biz-a', 2)).toBe(false);
    expect(verifyKioskDeviceToken(undefined, 'biz-a', 2)).toBe(false);
  });
});

describe('H3: client IP', () => {
  it('prefers X-Real-IP and never trusts the first X-Forwarded-For hop', () => {
    const spoofed = new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 9.9.9.9' } });
    expect(getClientIp(spoofed)).toBe('9.9.9.9');
    const proxied = new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '5.6.7.8' } });
    expect(getClientIp(proxied)).toBe('5.6.7.8');
  });
});

describe('H13: HR document templates', () => {
  it('strips scripts, frames, handlers and remote images', () => {
    const out = sanitizeDocumentTemplateHtml(
      '<p onclick="x()">Hi</p><script>alert(1)</script><iframe src="http://169.254.169.254/"></iframe>' +
        '<img src="http://10.0.0.1/a.png"><div style="background:url(http://10.0.0.1)">x</div>'
    );
    expect(out).not.toMatch(/script|iframe|onclick|10\.0\.0\.1|169\.254/);
    expect(out).toContain('<p>Hi</p>');
  });

  it('escapes merge values', () => {
    expect(escapeDocumentValue('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('M16: CSV formula injection', () => {
  it('neutralizes formula cells but keeps numbers', () => {
    expect(csvSafeText('=HYPERLINK("http://evil")')).toBe('\'=HYPERLINK("http://evil")');
    expect(csvSafeText('+91 98765')).toBe("'+91 98765");
    expect(csvSafeText('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvSafeText('-250.50')).toBe('-250.50');
    expect(csvSafeText('Acme Traders')).toBe('Acme Traders');
  });
});

describe('Low: store shopper tokens expire and are domain-separated', () => {
  it('round-trips a fresh token and rejects the old 3-part format', () => {
    const t = signStoreCustomer('biz', 'cust');
    expect(readStoreCustomer(t)).toEqual({ businessId: 'biz', customerId: 'cust' });
    const [b, c, , sig] = t.split('.');
    expect(readStoreCustomer(`${b}.${c}.${sig}`)).toBeNull();
    const [, , , s2] = t.split('.');
    expect(readStoreCustomer(`${b}.${c}.1.${s2}`)).toBeNull();
  });
});
