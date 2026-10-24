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
  updateSavedPrinter,
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
import { DEFAULT_ROLL_TEMPLATE } from '@/lib/label-document-builder';
import { buildLabelTspl } from '@/lib/print/tspl';
import { buildLabelDocumentZpl } from '@/lib/zpl-generator';
import { browserTextRasterizer } from '@/lib/print/text-raster-browser';
import { shouldShowKhatarioFooterFromSubscription } from '@/lib/print-branding-rules';
import { mapBluetoothUserMessage } from '@/lib/bluetooth/user-errors';
import { recordPrintJob } from '@/lib/printer/job-log';
import {
  desktopPrinterId,
  isDesktopPrintingAvailable,
  type DesktopPrinterTarget,
} from '@/lib/desktop/printing';

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
  /** True inside Khatario for Windows: Windows, network and COM port printers are available. */
  isDesktop: boolean;
  /** Save and connect a printer on this Windows computer (Khatario for Windows only). */
  addDesktopPrinter(
    target: DesktopPrinterTarget,
    name: string,
    profileId?: PrinterProfileId
  ): Promise<SavedBluetoothPrinter | null>;
  /** Trigger the OS picker to pair a new printer. */
  pair(profileId?: PrinterProfileId): Promise<SavedBluetoothPrinter | null>;
  /** Forget a printer (removes from localStorage + disconnects if active). */
  forget(printerId: string): void;
  /** Save edited printer settings (name, model, paper, copies, cutter, drawer, label darkness…). */
  updatePrinter(printer: SavedBluetoothPrinter): void;
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
  /** Send a test page in the printer's own language (receipt test, or a test label for TSPL/ZPL). */
  printTest(printer?: SavedBluetoothPrinter): Promise<void>;
  /** Open the cash drawer connected to a receipt printer. */
  openCashDrawer(printer?: SavedBluetoothPrinter): Promise<void>;
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
  const [isDesktop] = useState<boolean>(() => isDesktopPrintingAvailable());
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
      const started = Date.now();
      const log = (ok: boolean, error?: string) =>
        recordPrintJob({
          at: new Date(started).toISOString(),
          printer: printer.name,
          driver: printer.driver,
          language,
          bytes: bytes.length,
          ok,
          ms: Date.now() - started,
          error,
        });
      const attempt = async () => {
        setStatus('connecting');
        await driver.connect(printer);
        setActivePrinter(printer);
        setStatus('printing');
        await driver.print({ bytes, language, label: printer.name });
      };
      try {
        try {
          await attempt();
        } catch {
          await driver.disconnect().catch(() => undefined);
          await attempt();
        }
        touchPrinter(businessId, printer.id);
        refreshList();
        setStatus('connected');
        log(true);
      } catch (err: unknown) {
        const msg = mapBluetoothUserMessage(err);
        log(false, msg);
        setStatus('error');
        setError(msg);
        throw new Error(msg);
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
        throw new Error('No active business');
      }
      if (!supportsClassicBluetooth) {
        const msg = 'Classic Bluetooth is only available in the Android app';
        setError(msg);
        throw new Error(msg);
      }
      try {
        setStatus('connecting');
        setError(null);
        const ok = await ensureSppPermissions();
        if (!ok) {
          const msg = mapBluetoothUserMessage('Bluetooth permissions not granted');
          setError(msg);
          setStatus('error');
          throw new Error(msg);
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
      } catch (err: unknown) {
        const msg = mapBluetoothUserMessage(err);
        setStatus('error');
        setError(msg);
        throw new Error(msg);
      }
    },
    [businessId, supportsClassicBluetooth, refreshList]
  );

  const addDesktopPrinter = useCallback<UseBluetoothPrinterResult['addDesktopPrinter']>(
    async (target, name, profileId) => {
      if (!businessId) {
        setError('No active business');
        throw new Error('No active business');
      }
      const resolvedProfile = profileId || guessProfileFromName(name);
      const printer: SavedBluetoothPrinter = {
        id: desktopPrinterId(target),
        name,
        driver: 'desktop',
        profileId: resolvedProfile,
        paperWidthMm: getProfile(resolvedProfile).paperWidthMm,
        lastUsedAt: Date.now(),
      };
      await connectInternal(printer).catch((err: unknown) => {
        const msg = mapBluetoothUserMessage(err);
        setStatus('error');
        setError(msg);
        throw err;
      });
      savePrinter(businessId, printer);
      refreshList();
      return printer;
    },
    [businessId, connectInternal, refreshList]
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
      } catch (err: unknown) {
        const msg = mapBluetoothUserMessage(err);
        setStatus('error');
        setError(msg);
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
      } catch (err: unknown) {
        const msg = mapBluetoothUserMessage(err);
        setStatus('error');
        setError(msg);
        throw new Error(msg);
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

  const updatePrinter = useCallback<UseBluetoothPrinterResult['updatePrinter']>(
    (printer) => {
      if (!businessId) return;
      updateSavedPrinter(businessId, printer);
      if (activePrinter?.id === printer.id) setActivePrinter({ ...activePrinter, ...printer });
      refreshList();
    },
    [businessId, activePrinter, refreshList]
  );

  const printTest = useCallback<UseBluetoothPrinterResult['printTest']>(
    async (explicit) => {
      const target = pickPrinter(explicit, 'receipts') || pickPrinter(explicit, 'labels');
      if (!target) {
        setError('No printer paired');
        return;
      }
      const profile = getProfile(target.profileId);
      if (profile.language === 'TSPL' || profile.language === 'ZPL') {
        const args = testLabelArgs(target.name);
        const dpi = target.dpi ?? profile.dpi;
        if (profile.language === 'TSPL') {
          const bytes = buildLabelTspl({
            ...args,
            dpi,
            density: target.labelDensity,
            speed: target.labelSpeed,
            gapMm: target.labelGapMm,
            rasterize: browserTextRasterizer(),
          });
          await printViaDriver(target, bytes, 'TSPL');
        } else {
          const zpl = buildLabelDocumentZpl({ ...args, dpi, rasterize: browserTextRasterizer() });
          await printViaDriver(target, new TextEncoder().encode(zplJobSettings(target) + zpl), 'ZPL');
        }
        return;
      }
      const paper = receiptPaper(target);
      const b = new EscPosBuilder({ paperWidthMm: paper, rasterize: browserTextRasterizer() });
      b.init()
        .align('center')
        .bold(true)
        .sizeBig()
        .line('PRINTER OK')
        .sizeNormal()
        .bold(false)
        .line(target.name)
        .line(new Date().toLocaleString('en-IN'))
        .feed(1)
        .separator()
        .align('left')
        .line(`Paper width: ${paper}mm`)
        .line(`Model: ${profile.label}`)
        .line(`Language: ${profile.language}`)
        .separator('.')
        .line('हिंदी / ગુજરાતી / ₹ 1,234.50')
        .separator('.')
        .line('1234567890'.repeat(5).slice(0, b.colsFontA))
        .feed(1)
        .align('center')
        .qrcode('https://khatario.com', { size: 5 })
        .feed(1)
        .line('Khatario test page');
      if (target.autoCut === false) b.feed(4);
      else b.cut();
      await printViaDriver(target, b.build(), 'ESCPOS');
    },
    [pickPrinter, printViaDriver]
  );

  const openCashDrawer = useCallback<UseBluetoothPrinterResult['openCashDrawer']>(
    async (explicit) => {
      const target = pickPrinter(explicit, 'receipts');
      if (!target) {
        setError('No printer paired for receipts');
        throw new Error('No printer paired for receipts');
      }
      const bytes = new EscPosBuilder({ paperWidthMm: receiptPaper(target) }).init().openDrawer().build();
      await printViaDriver(target, bytes, 'ESCPOS');
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
      const rasterize = browserTextRasterizer();
      // Label printers get their own language (TSC/Xprinter/TVS → TSPL, Zebra → ZPL);
      // receipt printers print labels as ESC/POS strips.
      const dpi = target.dpi ?? profile.dpi;
      if (profile.language === 'TSPL') {
        const bytes = buildLabelTspl({
          ...args,
          dpi,
          density: target.labelDensity,
          speed: target.labelSpeed,
          gapMm: target.labelGapMm,
          rasterize,
        });
        await printViaDriver(target, bytes, 'TSPL');
        return;
      }
      if (profile.language === 'ZPL') {
        const zpl = buildLabelDocumentZpl({ ...args, dpi, rasterize });
        await printViaDriver(target, new TextEncoder().encode(zplJobSettings(target) + zpl), 'ZPL');
        return;
      }
      const paper: 58 | 80 = profile.paperWidthMm === 80 ? 80 : 58;
      const bytes = buildLabelEscPos({ ...args, paperWidthMm: paper, rasterize });
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
      const paper = receiptPaper(target);
      const drawer = target.cashDrawer ?? 'never';
      const paidInCash = /cash/i.test(data.paymentMode || '');
      const showKhatarioFooter =
        options?.showKhatarioFooter !== undefined
          ? options.showKhatarioFooter
          : shouldShowKhatarioFooterFromSubscription(subscription, {
              enabledFeatureIds: snapshotLoaded ? enabledFeatureIds : undefined,
            });
      const bytes = buildInvoiceReceiptEscPos(data, {
        paperWidthMm: paper,
        rasterize: browserTextRasterizer(),
        copies: target.copies ?? 1,
        skipCut: target.autoCut === false,
        openDrawer: drawer === 'always' || (drawer === 'cash' && paidInCash),
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
      isDesktop,
      addDesktopPrinter,
      pair,
      forget,
      updatePrinter,
      openCashDrawer,
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
      isDesktop,
      addDesktopPrinter,
      pair,
      forget,
      updatePrinter,
      openCashDrawer,
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

/** Receipt paper width: the printer's own setting when it is a receipt width, else the model's. */
function receiptPaper(printer: SavedBluetoothPrinter): 58 | 80 {
  if (printer.paperWidthMm === 80 || printer.paperWidthMm === 58) return printer.paperWidthMm;
  return getProfile(printer.profileId).paperWidthMm === 80 ? 80 : 58;
}

/** ZPL darkness / speed for the whole job (~SD 0–30, ^PR 2–6 ips) from the printer settings. */
function zplJobSettings(printer: SavedBluetoothPrinter): string {
  const parts: string[] = [];
  if (printer.labelDensity != null) parts.push(`~SD${String(Math.round(Math.max(0, Math.min(15, printer.labelDensity)) * 2)).padStart(2, '0')}`);
  if (printer.labelSpeed != null) parts.push(`^XA^PR${Math.max(2, Math.min(6, Math.round(printer.labelSpeed)))}^XZ`);
  return parts.length ? parts.join('') + '\n' : '';
}

/** A 50×25 mm test label: printer name, a Hindi line, a price and a barcode. */
function testLabelArgs(printerName: string): BuildLabelEscPosArgs {
  return {
    template: { ...DEFAULT_ROLL_TEMPLATE, widthMm: 50, heightMm: 25 },
    lines: [{ productName: `Test ${printerName}`.slice(0, 40), barcode: '8901234567890', copies: 1, price: 99, mrp: 120 }],
    businessName: 'Khatario test label',
  };
}
