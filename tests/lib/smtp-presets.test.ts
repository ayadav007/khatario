/** Provider presets and plain-language SMTP errors used by Settings → Email. */
import {
  detectSmtpProvider,
  friendlySmtpError,
  getSmtpPreset,
  portForSecure,
  secureForPort,
} from '@/lib/smtp-presets';

describe('detectSmtpProvider', () => {
  it.each([
    ['smtp.gmail.com', 'gmail'],
    ['SMTP.GMAIL.COM ', 'gmail'],
    ['smtp.zoho.in', 'zoho'],
    ['smtppro.zoho.in', 'zoho_pro'],
    ['smtp.hostinger.com', 'hostinger'],
    ['smtp.office365.com', 'outlook'],
    ['smtp-mail.outlook.com', 'outlook'],
    ['mail.example.in', 'custom'],
    ['', 'gmail'],
  ])('%s → %s', (host, expected) => {
    expect(detectSmtpProvider(host)).toBe(expected);
  });
});

it('presets keep port and SSL/TLS consistent', () => {
  for (const id of ['gmail', 'zoho', 'zoho_pro', 'hostinger', 'outlook'] as const) {
    const p = getSmtpPreset(id);
    expect(secureForPort(p.port)).toBe(p.secure);
  }
  expect(portForSecure(true)).toBe(465);
  expect(portForSecure(false)).toBe(587);
});

describe('friendlySmtpError', () => {
  it('explains Gmail App Password errors', () => {
    const raw = 'Invalid login: 534-5.7.9 Application-specific password required.';
    expect(friendlySmtpError(raw, 'smtp.gmail.com')).toMatch(/App Password/);
  });

  it('explains a rejected Gmail login', () => {
    const raw = "Invalid login: 535-5.7.8 Username and Password not accepted.";
    expect(friendlySmtpError(raw, 'smtp.gmail.com')).toMatch(/App Password/);
  });

  it('gives a generic login message for other providers', () => {
    expect(friendlySmtpError('Invalid login: 535 Authentication Failed', 'smtp.zoho.in')).toMatch(
      /rejected the username or password/
    );
  });

  it('explains Outlook basic-auth being switched off', () => {
    const raw = 'Invalid login: 535 5.7.139 Authentication unsuccessful, basic authentication is disabled.';
    expect(friendlySmtpError(raw, 'smtp.office365.com')).toMatch(/Microsoft/);
  });

  it('explains a port / SSL mismatch', () => {
    expect(friendlySmtpError('ssl3_get_record:wrong version number', 'smtp.gmail.com')).toMatch(/465/);
  });

  it('explains a bad host name', () => {
    expect(friendlySmtpError('getaddrinfo ENOTFOUND smtp.gmial.com', 'smtp.gmial.com')).toMatch(/host name/);
  });

  it('explains a timeout', () => {
    expect(friendlySmtpError('Greeting never received', 'smtp.gmail.com')).toMatch(/Could not reach/);
  });

  it('returns unknown errors unchanged', () => {
    expect(friendlySmtpError('Something odd happened', 'smtp.gmail.com')).toBe('Something odd happened');
  });
});
