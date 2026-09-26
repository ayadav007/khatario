import type { BondedBluetoothDevice } from '@/lib/bluetooth/native/khatario-bluetooth-spp';

const PRINTER_NAME =
  /printer|pos|thermal|rpp|xp-|xprinter|rongta|goojprt|tvs|bill|receipt|58mm|80mm|escpos|innerprinter|imin|sunmi|hoin|mtp/i;

export function bondedDevicePrinterScore(device: BondedBluetoothDevice): number {
  const name = device.name || '';
  if (PRINTER_NAME.test(name)) return 2;
  if (/^[0-9A-F:]{17}$/i.test(name.trim())) return 0;
  return 1;
}

/** Put likely thermal printers first so cashiers do not pick headphones or a watch. */
export function rankBondedBluetoothDevices(
  devices: BondedBluetoothDevice[]
): BondedBluetoothDevice[] {
  return [...devices].sort((a, b) => {
    const diff = bondedDevicePrinterScore(b) - bondedDevicePrinterScore(a);
    if (diff !== 0) return diff;
    return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
  });
}
