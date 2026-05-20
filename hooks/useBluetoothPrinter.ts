/**
 * useBluetoothPrinter
 *
 * React hook that glues the bluetooth driver + storage + UI together. Every
 * consumer page (settings, bulk labels, purchase modal, invoice view) uses
 * this hook so behaviour stays consistent.
 *
 * Responsibilities:
 *   - expose the saved printers for the current business
 *   - manage a "current status" (idle / scanning / connected / printing)
 *   - provide imperative methods: pair, print, printLabels, printReceipt,
 *     disconnect, forget
 *
 * The hook is intentionally thin: it doesn't know anything about the
 * domain models. Consumers pass the data they want rendered, the hook
 * routes it through the right encoder and driver.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import {
  getActiveTransport,
  getDriver,
  getDriverForPrinter,
  isBluetoothSupported,
  isCapacitorNative,
} from '@/lib/bluetooth/driver-registry';
import type { BondedBluetoothDevice } from '@/lib/bluetooth/native/khatario-bluetooth-spp';
import {
  ensureSppPermissions,
  isSppPluginAvailable,
  listBondedBluetoothDevices,
  openAndroidBluetoothSettings,
} from '@/lib/bluetooth/native/khatario-bluetooth-spp';
import { createCapacitorSppDriver } from '@/lib/bluetooth/drivers/capacitor-spp';
import type { PrinterTransport } from '@/lib/printer/capabilities';
import {
  listSavedPrinters,
  savePrinter,
  removePrinter,
  setPreferredFor,
  touchPrinter,
  getPreferredPrinter,
} from '@/lib/bluetooth/storage';
import type {
  BluetoothPrinterStatus,
  PrinterProfileId,
  SavedBluetoothPrinter,
  PrinterLanguage,
} from '@/lib/bluetooth/types';
import { getProfile, guessProfileFromName } from '@/lib/bluetooth/printer-profiles';
import {
  buildLabelEscPos,
  type BuildLabelEscPosArgs,
} from '@/lib/bluetooth/label-to-escpos';
import {
  buildInvoiceReceiptEscPos,
  type ReceiptData,
  type BuildReceiptOptions,
} from '@/lib/bluetooth/invoice-to-escpos';
import { EscPosBuilder } from '@/lib/bluetooth/escpos';
import { shouldShowKhatarioFooterFromSubscription } from '@/lib/print-branding-rules';

export interface UseBluetoothPrinterResult {
  /** True when the current runtime can use Bluetooth at all. */
  supported: boolean;
  /** True when running inside the Capacitor Android/iOS shell. */
  isNative: boolean;
  /** Active printer transport for this runtime, if any. */
  activeTransport: PrinterTransport | null;
  /** Coarse status used to drive the UI. */
  status: BluetoothPrinterStatus;
  /** Last non-fatal error message. */
  error: string | null;
  /** All printers the user has paired on this device for this business. */
  savedPrinters: SavedBluetoothPrinter[];
  /** Currently-connected printer, if any. */
  activePrinter: SavedBluetoothPrinter | null;
  /** True when Android Classic Bluetooth (SPP) plugin is available. */
  supportsClassicBluetooth: boolean;
  /** Bonded devices from phone Settings (Android app only). */
  listBondedDevices(): Promise<BondedBluetoothDevice[]>;
  /** Connect a bonded device by MAC address (BillBook-style picker). */
  connectBondedDevice(
    device: BondedBluetoothDevice,
    profileId?: PrinterProfileId
  ): Promise<SavedBluetoothPrinter | null>;
  /** Open Android system Bluetooth settings. */
  openBluetoothSettings(): Promise<void>;
  /** Trigger the OS picker to pair a new printer. */
  pair(profileId?: PrinterProfileId): Promise<SavedBluetoothPrinter | null>;
  /** Forget a printer (removes from localStorage + disconnects if active). */
  forget(printerId: string): void;
  /** Connect to a saved printer without opening the picker. */
  connect(printer: SavedBluetoothPrinter): Promise<void>;
  /** Disconnect the currently-connected printer. */
  disconnect(): Promise<void>;
  /** Set which printer should be preferred for labels or receipts. */
  setPreferred(
    printerId: string,
    usage: 'labels' | 'receipts'
  ): void;
  /** Returns the preferred printer for an intended usage, if any. */
  getPreferred(usage: 'labels' | 'receipts'): SavedBluetoothPrinter | undefined;
  /** Send a small "printer OK" test print. */
  printTest(printer?: SavedBluetoothPrinter): Promise<void>;
  /** Send a label batch. */
  printLabels(
    args: BuildLabelEscPosArgs,
    printer?: SavedBluetoothPrinter
  ): Promise<void>;
  /** Send an invoice receipt. */
  printReceipt(
    data: ReceiptData,
    options?: BuildReceiptOptions,
    printer?: SavedBluetoothPrinter
  ): Promise<void>;
  /** Send pre-built ESC/POS or ZPL bytes (escape hatch). */
  printBytes(
    bytes: Uint8Array,
    language: PrinterLanguage,
    printer?: SavedBluetoothPrinter
  ): Promise<void>;
}

/**
 * Manage Bluetooth printer state for the current business.
 */
export function useBluetoothPrinter(): UseBluetoothPrinterResult {
  const { business, subscription: authSubscription } = useAuth();
  const {
    subscription: layoutSubscription,
    enabledFeatureIds,
    snapshotLoaded,
  } = useLayoutData();
  const businessId = business?.id || '';

  const subscription = layoutSubscription ?? authSubscription ?? null;

  const [supported] = useState<boolean>(() => isBluetoothSupported());
  const [isNative] = useState<boolean>(() => isCapacitorNative());
  const [activeTransport] = useState<PrinterTransport | null>(() =>
    getActiveTransport()
  );
  const [status, setStatus] = useState<BluetoothPrinterStatus>(
    supported ? 'idle' : 'not-supported'
  );
  const [error, setError] = useState<string | null>(null);
  const [savedPrinters, setSavedPrinters] = useState<SavedBluetoothPrinter[]>(
    []
  );
  const [activePrinter, setActivePrinter] =
    useState<SavedBluetoothPrinter | null>(null);

  /**
   * Kept in a ref so async callbacks don't capture a stale reference when
   * the user switches businesses or the list changes mid-flight.
   */
  const savedRef = useRef<SavedBluetoothPrinter[]>([]);
  savedRef.current = savedPrinters;

  // Load persisted printers on mount / business change.
  useEffect(() => {
    if (!businessId) {
      setSavedPrinters([]);
      return;
    }
    setSavedPrinters(listSavedPrinters(businessId));
  }, [businessId]);

  // ---------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------

  const refreshList = useCallback(() => {
    if (!businessId) return;
    setSavedPrinters(listSavedPrinters(businessId));
  }, [businessId]);

  const pickPrinter = useCallback(
    (
      explicit: SavedBluetoothPrinter | undefined,
      usage: 'labels' | 'receipts'
    ): SavedBluetoothPrinter | null => {
      if (explicit) return explicit;
      if (activePrinter) return activePrinter;
      if (!businessId) return null;
      return getPreferredPrinter(businessId, usage) || null;
    },
    [activePrinter, businessId]
  );

  const connectInternal = useCallback(
    async (printer: SavedBluetoothPrinter): Promise<void> => {
      setStatus('connecting');
      setError(null);
      const driver = await getDriverForPrinter(printer);
      await driver.connect(printer);
      setActivePrinter(printer);
      setStatus('connected');
    },
    []
  );

  const printViaDriver = useCallback(
    async (
      printer: SavedBluetoothPrinter,
      bytes: Uint8Array,
      language: PrinterLanguage
    ): Promise<void> => {
      const driver = await getDriverForPrinter(printer);
      setStatus('connecting');
      await driver.connect(printer);
      setActivePrinter(printer);
      setStatus('printing');
      try {
        await driver.print({ bytes, language, label: printer.name });
        touchPrinter(businessId, printer.id);
        refreshList();
        setStatus('connected');
      } catch (err: any) {
        setStatus('error');
        setError(err?.message || 'Print failed');
        throw err;
      }
    },
    [businessId, refreshList]
  );

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  const supportsClassicBluetooth = isNative && isSppPluginAvailable();

  const listBondedDevices = useCallback(async () => {
    if (!supportsClassicBluetooth) return [];
    return listBondedBluetoothDevices();
  }, [supportsClassicBluetooth]);

  const openBluetoothSettings = useCallback(async () => {
    if (!supportsClassicBluetooth) return;
    await openAndroidBluetoothSettings();
  }, [supportsClassicBluetooth]);

  const connectBondedDevice = useCallback<
    UseBluetoothPrinterResult['connectBondedDevice']
  >(
    async (device, profileId) => {
      if (!businessId) {
        setError('No active business');
        return null;
      }
      if (!supportsClassicBluetooth) {
        setError('Classic Bluetooth is only available in the Android app');
        return null;
      }
      try {
        setStatus('connecting');
        setError(null);
        const ok = await ensureSppPermissions();
        if (!ok) {
          setError('Bluetooth permissions not granted');
          setStatus('error');
          return null;
        }
        const spp = createCapacitorSppDriver();
        const resolvedProfile =
          profileId || guessProfileFromName(device.name);
        const printer: SavedBluetoothPrinter = {
          id: device.address,
          name: device.name || 'Bluetooth printer',
          driver: 'capacitor-spp',
          profileId: resolvedProfile,
          paperWidthMm: getProfile(resolvedProfile).paperWidthMm,
          lastUsedAt: Date.now(),
        };
        await spp.connect(printer);
        savePrinter(businessId, printer);
        setActivePrinter(printer);
        setStatus('connected');
        refreshList();
        return printer;
      } catch (err: any) {
        setStatus('error');
        setError(err?.message || 'Connection failed');
        return null;
      }
    },
    [businessId, supportsClassicBluetooth, refreshList]
  );

  const pair = useCallback<UseBluetoothPrinterResult['pair']>(
    async (profileId) => {
      if (!supported) {
        setError(
          isNative
            ? 'Bluetooth plugin is not available in this build'
            : 'Your browser does not support Web Bluetooth. Use Chrome on Android or desktop Chrome/Edge.'
        );
        return null;
      }
      if (!businessId) {
        setError('No active business');
        return null;
      }
      try {
        setStatus('scanning');
        setError(null);
        const driver = await getDriver();
        const { printer } = await driver.pair(profileId);
        savePrinter(businessId, printer);
        setActivePrinter(printer);
        setStatus('connected');
        refreshList();
        return printer;
      } catch (err: any) {
        setStatus('error');
        setError(err?.message || 'Pairing cancelled');
        return null;
      }
    },
    [businessId, supported, isNative, refreshList]
  );

  const forget = useCallback<UseBluetoothPrinterResult['forget']>(
    (printerId) => {
      if (!businessId) return;
      removePrinter(businessId, printerId);
      if (activePrinter?.id === printerId) {
        getDriverForPrinter(activePrinter)
          .then((d) => d.disconnect())
          .catch(() => {
            /* best-effort */
          });
        setActivePrinter(null);
        setStatus(supported ? 'idle' : 'not-supported');
      }
      refreshList();
    },
    [activePrinter, businessId, supported, refreshList]
  );

  const connect = useCallback<UseBluetoothPrinterResult['connect']>(
    async (printer) => {
      try {
        await connectInternal(printer);
      } catch (err: any) {
        setStatus('error');
        setError(err?.message || 'Connection failed');
        throw err;
      }
    },
    [connectInternal]
  );

  const disconnect = useCallback<
    UseBluetoothPrinterResult['disconnect']
  >(async () => {
    if (activePrinter) {
      const driver = await getDriverForPrinter(activePrinter);
      await driver.disconnect();
    } else {
      const driver = await getDriver();
      await driver.disconnect();
    }
    setActivePrinter(null);
    setStatus(supported ? 'idle' : 'not-supported');
  }, [supported, activePrinter]);

  const setPreferred = useCallback<
    UseBluetoothPrinterResult['setPreferred']
  >(
    (printerId, usage) => {
      if (!businessId) return;
      setPreferredFor(businessId, printerId, usage);
      refreshList();
    },
    [businessId, refreshList]
  );

  const getPreferred = useCallback<
    UseBluetoothPrinterResult['getPreferred']
  >(
    (usage) => {
      if (!businessId) return undefined;
      return getPreferredPrinter(businessId, usage);
    },
    [businessId]
  );

  const printTest = useCallback<UseBluetoothPrinterResult['printTest']>(
    async (explicit) => {
      const target = pickPrinter(explicit, 'receipts') || pickPrinter(explicit, 'labels');
      if (!target) {
        setError('No printer paired');
        return;
      }
      const profile = getProfile(target.profileId);
      const paper = profile.paperWidthMm === 80 ? 80 : 58;
      const b = new EscPosBuilder({ paperWidthMm: paper });
      b.init()
        .align('center')
        .bold(true)
        .sizeBig()
        .line('PRINTER OK')
        .sizeNormal()
        .bold(false)
        .line(target.name)
        .line(new Date().toLocaleString())
        .feed(1)
        .separator()
        .align('left')
        .line(`Paper width: ${paper}mm`)
        .line(`Profile: ${profile.label}`)
        .line(`Language: ${profile.language}`)
        .feed(1)
        .align('center')
        .qrcode('https://khatario.app', { size: 5 })
        .feed(1)
        .line('Khatario Bluetooth test page')
        .feed(3);
      await printViaDriver(target, b.build(), 'ESCPOS');
    },
    [pickPrinter, printViaDriver]
  );

  const printLabels = useCallback<
    UseBluetoothPrinterResult['printLabels']
  >(
    async (args, explicit) => {
      const target = pickPrinter(explicit, 'labels');
      if (!target) {
        setError('No printer paired for labels');
        throw new Error('No printer paired for labels');
      }
      const profile = getProfile(target.profileId);
      // For now, labels always go out as ESC/POS. ZPL-language printers
      // would get ZPL bytes from buildLabelDocumentZpl — wire that when a
      // real ZPL Bluetooth printer is available for testing.
      const paper: 58 | 80 = profile.paperWidthMm === 80 ? 80 : 58;
      const bytes = buildLabelEscPos({ ...args, paperWidthMm: paper });
      await printViaDriver(target, bytes, 'ESCPOS');
    },
    [pickPrinter, printViaDriver]
  );

  const printReceipt = useCallback<
    UseBluetoothPrinterResult['printReceipt']
  >(
    async (data, options, explicit) => {
      const target = pickPrinter(explicit, 'receipts');
      if (!target) {
        setError('No printer paired for receipts');
        throw new Error('No printer paired for receipts');
      }
      const profile = getProfile(target.profileId);
      const paper: 58 | 80 = profile.paperWidthMm === 80 ? 80 : 58;
      const showKhatarioFooter =
        options?.showKhatarioFooter !== undefined
          ? options.showKhatarioFooter
          : shouldShowKhatarioFooterFromSubscription(subscription, {
              enabledFeatureIds: snapshotLoaded ? enabledFeatureIds : undefined,
            });
      const bytes = buildInvoiceReceiptEscPos(data, {
        paperWidthMm: paper,
        ...options,
        showKhatarioFooter,
      });
      await printViaDriver(target, bytes, 'ESCPOS');
    },
    [pickPrinter, printViaDriver, subscription, snapshotLoaded, enabledFeatureIds]
  );

  const printBytes = useCallback<UseBluetoothPrinterResult['printBytes']>(
    async (bytes, language, explicit) => {
      const target = pickPrinter(explicit, 'labels');
      if (!target) {
        setError('No printer paired');
        throw new Error('No printer paired');
      }
      await printViaDriver(target, bytes, language);
    },
    [pickPrinter, printViaDriver]
  );

  return useMemo<UseBluetoothPrinterResult>(
    () => ({
      supported,
      isNative,
      activeTransport,
      status,
      error,
      savedPrinters,
      activePrinter,
      supportsClassicBluetooth,
      listBondedDevices,
      connectBondedDevice,
      openBluetoothSettings,
      pair,
      forget,
      connect,
      disconnect,
      setPreferred,
      getPreferred,
      printTest,
      printLabels,
      printReceipt,
      printBytes,
    }),
    [
      supported,
      isNative,
      activeTransport,
      status,
      error,
      savedPrinters,
      activePrinter,
      supportsClassicBluetooth,
      listBondedDevices,
      connectBondedDevice,
      openBluetoothSettings,
      pair,
      forget,
      connect,
      disconnect,
      setPreferred,
      getPreferred,
      printTest,
      printLabels,
      printReceipt,
      printBytes,
    ]
  );
}
