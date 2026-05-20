/**
 * Capacitor bridge for KhatarioBluetoothSppPlugin (Android Classic Bluetooth).
 */

import { registerPlugin } from '@capacitor/core';
import { isCapacitorNative } from '@/lib/bluetooth/driver-registry';

export type BondedBluetoothDevice = {
  address: string;
  name: string;
};

export interface KhatarioBluetoothSppPlugin {
  checkPermissions(): Promise<{ granted: boolean }>;
  requestPermissions(): Promise<{ granted: boolean }>;
  openBluetoothSettings(): Promise<void>;
  listBondedDevices(): Promise<{ devices: BondedBluetoothDevice[] }>;
  connect(options: { address: string }): Promise<void>;
  disconnect(): Promise<void>;
  write(options: { data: string }): Promise<void>;
}

const plugin = registerPlugin<KhatarioBluetoothSppPlugin>('KhatarioBluetoothSpp');

export function isSppPluginAvailable(): boolean {
  return isCapacitorNative();
}

export async function ensureSppPermissions(): Promise<boolean> {
  if (!isSppPluginAvailable()) return false;
  const { granted } = await plugin.checkPermissions();
  if (granted) return true;
  const req = await plugin.requestPermissions();
  return req.granted;
}

export async function listBondedBluetoothDevices(): Promise<BondedBluetoothDevice[]> {
  if (!isSppPluginAvailable()) return [];
  const ok = await ensureSppPermissions();
  if (!ok) throw new Error('Bluetooth permissions not granted');
  const { devices } = await plugin.listBondedDevices();
  return devices ?? [];
}

export async function openAndroidBluetoothSettings(): Promise<void> {
  if (!isSppPluginAvailable()) return;
  await plugin.openBluetoothSettings();
}

export async function sppConnect(address: string): Promise<void> {
  await plugin.connect({ address });
}

export async function sppDisconnect(): Promise<void> {
  try {
    await plugin.disconnect();
  } catch {
    /* best-effort */
  }
}

export async function sppWrite(bytes: Uint8Array): Promise<void> {
  const data = uint8ToBase64(bytes);
  await plugin.write({ data });
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}
