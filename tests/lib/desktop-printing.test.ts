import {
  DesktopPrintError,
  bytesToBase64,
  desktopPrinterId,
  parseDesktopPrinterId,
  sendToDesktopPrinter,
} from '@/lib/desktop/printing';
import { mapBluetoothUserMessage } from '@/lib/bluetooth/user-errors';

/** The node test environment has no window; give the code under test the desktop app's globals. */
const g = globalThis as unknown as { window?: object };
function desktopApp(version: string, invoke: jest.Mock) {
  g.window = { __KHATARIO_DESKTOP__: { platform: 'windows', version }, __TAURI_INTERNALS__: { invoke } };
}

describe('Khatario for Windows printing', () => {
  afterEach(() => {
    delete g.window;
  });

  it('round-trips saved printer ids', () => {
    const targets = [
      { kind: 'windows', printer: 'TVS RP 3160 GOLD' },
      { kind: 'network', host: '192.168.1.50', port: 9100 },
      { kind: 'serial', port: 'COM5' },
    ] as const;
    for (const t of targets) expect(parseDesktopPrinterId(desktopPrinterId(t))).toEqual(t);
    expect(parseDesktopPrinterId('AA:BB:CC:DD:EE:FF')).toBeNull();
    expect(parseDesktopPrinterId('com:\\\\.\\PhysicalDrive0')).toBeNull();
    expect(parseDesktopPrinterId('net:printer.local:9100')).toBeNull();
  });

  it('encodes job bytes as base64', () => {
    expect(bytesToBase64(new Uint8Array([0x1b, 0x40]))).toBe('G0A=');
    const big = new Uint8Array(100_000).fill(0xff);
    expect(atob(bytesToBase64(big)).length).toBe(100_000);
  });

  it('sends the job to the right desktop command', async () => {
    const invoke = jest.fn().mockResolvedValue(null);
    desktopApp('0.2.0', invoke);
    const bytes = new Uint8Array([0x1b, 0x40]);
    await sendToDesktopPrinter({ kind: 'network', host: '192.168.1.50', port: 9100 }, bytes);
    await sendToDesktopPrinter({ kind: 'windows', printer: 'Xprinter XP-365B' }, bytes, 'Labels');
    await sendToDesktopPrinter({ kind: 'serial', port: 'COM5' }, bytes);
    expect(invoke.mock.calls).toEqual([
      ['desktop_print_network', { host: '192.168.1.50', port: 9100, data: 'G0A=' }],
      ['desktop_print_windows', { printer: 'Xprinter XP-365B', data: 'G0A=', title: 'Labels' }],
      ['desktop_print_serial', { port: 'COM5', data: 'G0A=' }],
    ]);
  });

  it('shows the app’s own error text, and asks older apps to update', async () => {
    const invoke = jest
      .fn()
      .mockRejectedValueOnce('No printer answered at 192.168.1.50:9100. Check it is on and connected to the same Wi‑Fi/router.')
      .mockRejectedValueOnce('Command desktop_print_serial not allowed by ACL');
    desktopApp('0.1.0', invoke);
    const first = await sendToDesktopPrinter({ kind: 'network', host: '192.168.1.50', port: 9100 }, new Uint8Array([1])).catch((e) => e);
    expect(first).toBeInstanceOf(DesktopPrintError);
    // Not turned into the Bluetooth "did not respond / timed out" copy.
    expect(mapBluetoothUserMessage(first)).toMatch(/^No printer answered at 192\.168\.1\.50/);
    const second = await sendToDesktopPrinter({ kind: 'serial', port: 'COM5' }, new Uint8Array([1])).catch((e) => e);
    expect(second.message).toBe('Update Khatario for Windows to print from this computer.');
  });
});

describe('network printer status', () => {
  const base = { answered: true, offline: false, coverOpen: false, paperOut: false, paperLow: false, error: false };
  it('explains what stops a print and ignores silent printers', () => {
    const { statusProblem } = jest.requireActual('@/lib/desktop/printing') as typeof import('@/lib/desktop/printing');
    expect(statusProblem(base)).toBeNull();
    expect(statusProblem({ ...base, paperLow: true })).toBeNull();
    expect(statusProblem({ ...base, paperOut: true })).toMatch(/out of paper/);
    expect(statusProblem({ ...base, coverOpen: true, paperOut: true })).toMatch(/cover is open/);
    expect(statusProblem({ ...base, answered: false, paperOut: true })).toBeNull();
  });
});

describe('silent A4 printing', () => {
  const { isAllowedPrintSource } = jest.requireActual('@/lib/print/print-source') as typeof import('@/lib/print/print-source');
  const { printDocumentPath } = jest.requireActual('@/lib/desktop/a4-print') as typeof import('@/lib/desktop/a4-print');

  it('loads only this site’s preview endpoints', () => {
    expect(isAllowedPrintSource('/api/invoices/0b1c-22/preview')).toBe(true);
    expect(isAllowedPrintSource('/api/documents/sales_orders/abc/preview')).toBe(true);
    expect(isAllowedPrintSource('/api/invoices/1/pdf')).toBe(false);
    expect(isAllowedPrintSource('//evil.example/api/x/preview')).toBe(false);
    expect(isAllowedPrintSource('/api/../admin/preview')).toBe(false);
    expect(isAllowedPrintSource('https://evil.example/api/x/preview')).toBe(false);
    expect(isAllowedPrintSource(null)).toBe(false);
  });

  it('asks the desktop app to print the print page on the chosen printer', async () => {
    const invoke = jest.fn().mockResolvedValue(null);
    desktopApp('0.2.0', invoke);
    const { printDocumentSilently } = jest.requireActual('@/lib/desktop/a4-print') as typeof import('@/lib/desktop/a4-print');
    await printDocumentSilently('/api/invoices/abc/preview', { printer: 'HP LaserJet M1005', copies: 2 });
    expect(invoke).toHaveBeenCalledWith('desktop_print_page', {
      path: printDocumentPath('/api/invoices/abc/preview'),
      printer: 'HP LaserJet M1005',
      copies: 2,
    });
    expect(printDocumentPath('/api/invoices/abc/preview')).toBe('/print/document?src=%2Fapi%2Finvoices%2Fabc%2Fpreview');
  });
});
