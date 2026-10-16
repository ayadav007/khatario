/**
 * Printing through Khatario for Windows (desktop/src-tauri/src/printing.rs). The page builds the
 * printer bytes (ESC/POS, TSPL, ZPL); the app moves them to a Windows printer (RAW spooler job),
 * a network printer (TCP 9100) or a COM port (USB-serial / Bluetooth paired in Windows).
 */

import { tauriInvoke } from './platform';

export type DesktopPrinterAttachment = 'usb' | 'network' | 'serial' | 'bluetooth' | 'virtual' | 'other';

export type WindowsPrinterInfo = {
  name: string;
  port: string;
  driver: string;
  attachment: DesktopPrinterAttachment;
  isDefault: boolean;
  offline: boolean;
  paused: boolean;
  error: boolean;
};

/** Where a saved desktop printer is reached. */
export type DesktopPrinterTarget =
  | { kind: 'windows'; printer: string }
  | { kind: 'network'; host: string; port: number }
  | { kind: 'serial'; port: string };

/** Errors from the desktop app are already written for the cashier; show them as they are. */
export class DesktopPrintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesktopPrintError';
  }
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = tauriInvoke();
  if (!invoke) throw new DesktopPrintError('Printing to this computer’s printers needs Khatario for Windows.');
  try {
    return (await invoke(cmd, args)) as T;
  } catch (err) {
    const message = typeof err === 'string' ? err : err instanceof Error ? err.message : '';
    // An older app version without printing commands rejects them as not allowed / not found.
    if (/not allowed|not found|unknown command/i.test(message)) {
      throw new DesktopPrintError('Update Khatario for Windows to print from this computer.');
    }
    throw new DesktopPrintError(message || 'Could not print. Check the printer and try again.');
  }
}

export function isDesktopPrintingAvailable(): boolean {
  return tauriInvoke() !== null;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** What a network ESC/POS printer reports (DLE EOT); `answered: false` when it does not support status. */
export type NetworkPrinterStatus = {
  answered: boolean;
  offline: boolean;
  coverOpen: boolean;
  paperOut: boolean;
  paperLow: boolean;
  error: boolean;
};

export const getNetworkPrinterStatus = (host: string, port = 9100) =>
  call<NetworkPrinterStatus>('desktop_network_printer_status', { host, port });

/** Cashier-facing reason a printer cannot print right now, or null when it can (or cannot tell). */
export function statusProblem(status: NetworkPrinterStatus): string | null {
  if (!status.answered) return null;
  if (status.coverOpen) return 'The printer cover is open. Close it and print again.';
  if (status.paperOut) return 'The printer is out of paper. Load a new roll and print again.';
  if (status.error) return 'The printer reports an error (paper jam or cutter). Check it, then print again.';
  return null;
}

export const listWindowsPrinters = () => call<WindowsPrinterInfo[]>('desktop_list_printers');
export const listSerialPorts = () => call<string[]>('desktop_list_serial_ports');
export const scanNetworkPrinters = (port = 9100) => call<string[]>('desktop_scan_network', { port });
export const probeNetworkPrinter = (host: string, port = 9100) =>
  call<boolean>('desktop_probe_network', { host, port });

export async function sendToDesktopPrinter(target: DesktopPrinterTarget, bytes: Uint8Array, title?: string): Promise<void> {
  const data = bytesToBase64(bytes);
  switch (target.kind) {
    case 'windows':
      return call('desktop_print_windows', { printer: target.printer, data, title: title ?? 'Khatario' });
    case 'network':
      return call('desktop_print_network', { host: target.host, port: target.port, data });
    case 'serial':
      return call('desktop_print_serial', { port: target.port, data });
  }
}

/** Saved-printer ids: `win:<name>`, `net:<ip>:<port>`, `com:<COMn>`. */
export function desktopPrinterId(target: DesktopPrinterTarget): string {
  switch (target.kind) {
    case 'windows':
      return `win:${target.printer}`;
    case 'network':
      return `net:${target.host}:${target.port}`;
    case 'serial':
      return `com:${target.port}`;
  }
}

export function parseDesktopPrinterId(id: string): DesktopPrinterTarget | null {
  if (id.startsWith('win:') && id.length > 4) return { kind: 'windows', printer: id.slice(4) };
  if (id.startsWith('com:') && /^COM\d{1,3}$/i.test(id.slice(4))) return { kind: 'serial', port: id.slice(4).toUpperCase() };
  const net = /^net:(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})$/.exec(id);
  if (net) return { kind: 'network', host: net[1], port: Number(net[2]) };
  return null;
}

/** Checks the saved printer is still there (installed / port present / answering on the LAN). */
export async function checkDesktopPrinter(target: DesktopPrinterTarget): Promise<void> {
  switch (target.kind) {
    case 'windows': {
      const printers = await listWindowsPrinters();
      if (!printers.some((p) => p.name === target.printer)) {
        throw new DesktopPrintError(`"${target.printer}" is no longer installed on this computer.`);
      }
      return;
    }
    case 'serial': {
      const ports = await listSerialPorts();
      if (!ports.includes(target.port)) {
        throw new DesktopPrintError(`${target.port} is not available. Turn the printer on, or pair it again in Windows Bluetooth settings.`);
      }
      return;
    }
    case 'network': {
      if (!(await probeNetworkPrinter(target.host, target.port))) {
        throw new DesktopPrintError(`No printer answered at ${target.host}. Check it is on and connected to the same Wi‑Fi/router.`);
      }
    }
  }
}
