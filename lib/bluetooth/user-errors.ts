/**
 * Map native / Web Bluetooth errors to cashier-facing copy.
 */
export function mapBluetoothUserMessage(raw: unknown): string {
  let message = '';
  if (typeof raw === 'string') message = raw;
  else if (raw instanceof Error) message = raw.message;
  else if (raw && typeof raw === 'object') {
    const o = raw as { message?: string; errorMessage?: string };
    message = o.message || o.errorMessage || '';
  }
  const m = message.toLowerCase();

  if (m.includes('permission')) {
    return 'Allow Bluetooth for Khatario in Android settings, then try again.';
  }
  if (m.includes('turned off') || m.includes('bluetooth is off') || m.includes('not enabled')) {
    return 'Turn on Bluetooth on this phone, then try again.';
  }
  if (m.includes('did not respond') || m.includes('timed out') || m.includes('timeout')) {
    return 'Printer did not respond. Turn it on, stay nearby, and tap Connect again.';
  }
  if (
    m.includes('socket') ||
    m.includes('read failed') ||
    m.includes('broken pipe') ||
    m.includes('econnreset') ||
    m.includes('connection refused') ||
    m.includes('connection failed')
  ) {
    return 'Could not reach the printer. Turn it on, keep it paired in phone Bluetooth settings, then tap Connect.';
  }
  if (m.includes('not connected') || m.includes('printer not connected')) {
    return 'Printer disconnected. Tap Connect and print again.';
  }
  if (m.includes('no paired bluetooth') || m.includes('no paired')) {
    return 'No paired printers yet. Pair the printer in phone Bluetooth settings, then tap Refresh.';
  }
  if (!message.trim()) {
    return 'Could not print. Check the printer and try again.';
  }
  return message.replace(/^Connection failed:\s*/i, '').trim();
}
