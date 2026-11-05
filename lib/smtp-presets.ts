/**
 * SMTP provider presets for Settings → Email, plus plain-language SMTP error messages.
 * Shared by the settings form (client) and lib/business-email.ts (server); no server-only imports.
 */

export type SmtpProviderId = 'gmail' | 'zoho' | 'zoho_pro' | 'hostinger' | 'outlook' | 'custom';

export interface SmtpPreset {
  id: SmtpProviderId;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  /** Placeholder shown in the password field. */
  passwordHint: string;
  /** Provider does not accept password-based SMTP any more. */
  unsupported?: boolean;
}

export const SMTP_PRESETS: SmtpPreset[] = [
  {
    id: 'gmail',
    label: 'Gmail / Google Workspace',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    passwordHint: '16-character Google App Password',
  },
  {
    id: 'zoho',
    label: 'Zoho Mail (@zohomail.in / personal)',
    host: 'smtp.zoho.in',
    port: 465,
    secure: true,
    passwordHint: 'Zoho password, or app-specific password if 2FA is on',
  },
  {
    id: 'zoho_pro',
    label: 'Zoho Mail (your own domain, paid plan)',
    host: 'smtppro.zoho.in',
    port: 465,
    secure: true,
    passwordHint: 'Zoho password, or app-specific password if 2FA is on',
  },
  {
    id: 'hostinger',
    label: 'Hostinger email',
    host: 'smtp.hostinger.com',
    port: 465,
    secure: true,
    passwordHint: 'Your mailbox password',
  },
  {
    id: 'outlook',
    label: 'Outlook / Hotmail / Microsoft 365',
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    passwordHint: 'Microsoft password',
    unsupported: true,
  },
  {
    id: 'custom',
    label: 'Other (GoDaddy, cPanel host, etc.)',
    host: '',
    port: 465,
    secure: true,
    passwordHint: 'Mailbox password or SMTP password',
  },
];

export function getSmtpPreset(id: SmtpProviderId): SmtpPreset {
  return SMTP_PRESETS.find((p) => p.id === id) ?? SMTP_PRESETS[SMTP_PRESETS.length - 1];
}

const OUTLOOK_HOSTS = ['smtp.office365.com', 'smtp-mail.outlook.com', 'smtp.outlook.com'];

/** Which preset a saved host belongs to (anything unknown is "custom"). */
export function detectSmtpProvider(host: string | null | undefined): SmtpProviderId {
  const h = (host || '').trim().toLowerCase();
  if (!h) return 'gmail';
  if (OUTLOOK_HOSTS.includes(h)) return 'outlook';
  const match = SMTP_PRESETS.find((p) => p.id !== 'custom' && p.id !== 'outlook' && p.host === h);
  return match ? match.id : 'custom';
}

/** Port 465 uses implicit SSL/TLS; every other port (587, 25, 2525) uses STARTTLS. */
export function secureForPort(port: number): boolean {
  return port === 465;
}

export function portForSecure(secure: boolean): number {
  return secure ? 465 : 587;
}

/**
 * Turn a raw nodemailer / SMTP error into a message a business owner can act on.
 * Unknown errors are returned unchanged.
 */
export function friendlySmtpError(raw: string, host?: string | null): string {
  const msg = raw || '';
  const lower = msg.toLowerCase();
  const isGmail = (host || '').toLowerCase().includes('gmail');
  const isOutlook = OUTLOOK_HOSTS.includes((host || '').trim().toLowerCase());

  if (isOutlook && /535|5\.7\.(3|139)|basic authentication|smtpclientauthentication|auth/i.test(msg)) {
    return 'Microsoft (Outlook / Microsoft 365) no longer accepts password-based SMTP. Please use Gmail, Zoho Mail, or your web host\'s email instead.';
  }
  if (/534[- ]5\.7\.9|application-specific password required/i.test(msg)) {
    return 'Gmail needs an App Password, not your normal password. Create one at myaccount.google.com/apppasswords and paste it into SMTP password.';
  }
  if (/535|invalid login|username and password not accepted|authentication failed|badcredentials|eauth/i.test(lower)) {
    return isGmail
      ? 'Gmail rejected the login. Use a 16-character App Password (not your normal password) and make sure 2-Step Verification is on in your Google account.'
      : 'The email provider rejected the username or password. Check both, and use an app-specific password if your account has 2-step verification.';
  }
  if (/wrong version number|ssl routines|ssl3_get_record|tls_validate_record_header/i.test(lower)) {
    return 'The port and the SSL/TLS setting do not match. Use port 465 with SSL/TLS ticked, or port 587 with it unticked.';
  }
  if (/greeting never received|etimedout|timed out|timeout/i.test(lower)) {
    return 'Could not reach the mail server in time. Check the SMTP host and port (465 with SSL/TLS ticked, or 587 with it unticked).';
  }
  if (/enotfound|getaddrinfo|eai_again/i.test(lower)) {
    return 'The SMTP host name was not found. Check the spelling of the SMTP host (for example smtp.gmail.com).';
  }
  if (/econnrefused|econnreset/i.test(lower)) {
    return 'The mail server refused the connection. Check the SMTP host and port.';
  }
  if (/self[- ]signed|certificate|unable to verify/i.test(lower)) {
    return 'The mail server\'s security certificate could not be verified. Check the SMTP host name with your email provider.';
  }
  if (/550[- ]5\.4\.5|daily (user )?sending limit|sending quota|5\.4\.5/i.test(lower)) {
    return 'Your email account has reached its daily sending limit (about 500/day for free Gmail). Try again tomorrow or use a business email account.';
  }
  if (/553|sender address rejected|not owned by user|5\.7\.1.*sender|from address/i.test(lower)) {
    return 'The provider does not allow sending from this "From email". Use the same address as the SMTP username.';
  }
  return msg;
}
