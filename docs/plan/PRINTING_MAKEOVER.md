# Printing makeover

Goal: printing that works plug-and-play the way Indian shops expect from Vyapar / Tally / POS software —
thermal bills, barcode/MRP labels and A4 GST invoices, on USB, network and Bluetooth printers, from the
Windows desktop app, the Android apps and the website.

## Where we are (audit, 16 Oct 2026)

| Printer | Website PC | Website Android | Android app (Capacitor) | Phone app (Flutter) | Windows app (Tauri) |
|---|---|---|---|---|---|
| Classic Bluetooth thermal | no | no | yes | no | no |
| BLE thermal | 7 known models | 7 known models | yes | no | no |
| USB thermal | PDF dialog only | no | no | no | untested |
| Network thermal | PDF dialog only | no | no | no | untested |
| Label printer (TSC/Xprinter/TVS/Zebra) | PDF only | no | wrong commands | no | untested |
| A4 laser/inkjet | PDF | PDF | PDF | PDF | untested |

Gaps: USB/TCP drivers are placeholders; labels go out as receipt commands (label printers speak TSPL/ZPL);
non-English text prints as `?`; the Flutter app has no thermal printing; printer status is never read;
the Windows app does not handle PDF pop-ups.

## Principles

1. **One print engine, many transports.** Documents (receipt, label, KOT, A4) are built once into
   printer bytes by `lib/print/*`; transports only move bytes (Bluetooth, Windows spooler, TCP 9100,
   COM port, USB-OTG). Same output everywhere.
2. **Printer = connection + language + media.** Every saved printer records how to reach it, which
   command language it speaks (ESC/POS, TSPL, ZPL), paper/label size, dpi and what it can do
   (cutter, drawer). Language and size are guessed from the model name and can be changed.
3. **Roles, not prompts.** Each business picks a default printer per role (bills, labels, KOT, A4) per
   device. Printing goes straight to it; when it is missing or unreachable, the connection wizard opens
   (already built, `hooks/usePrinterReady.tsx`).
4. **Indian text works.** Any non-ASCII text (Hindi, Gujarati, Tamil… and ₹) is drawn as a bitmap so it
   prints on printers without Indic fonts.
5. **Honest results.** Read printer status where the transport allows (paper out, cover open) and only
   say "Printed" when bytes were delivered.

## Phases

### A. Print engine core (web, shared) — started
- `lib/print/label-layout.ts`: one layout step (absolute designer layout + stacked fallback) used by
  every label language. ZPL generator moves onto it with byte-identical output (tested).
- `lib/print/tspl.ts`: TSPL (TSC, Xprinter label, TVS LP, Godex in TSPL mode) — SIZE/GAP/DIRECTION,
  TEXT, BARCODE, QRCODE, BITMAP, PRINT n.
- `lib/print/text-raster.ts`: canvas text rasterizer (browser/WebView) → 1-bit bitmap; used for
  non-ASCII text in ESC/POS (GS v 0), TSPL (BITMAP) and ZPL (^GF).
- Printer profiles gain `language` + label-printer models; Bluetooth/raw label printing picks the
  encoder by language.

### B. Windows app native printing (Rust, `desktop/`)
- Commands: list Windows printers (EnumPrinters) with status; RAW job to a printer (OpenPrinter /
  StartDocPrinter / WritePrinter); TCP 9100 send + reachability probe; list COM ports and write
  (Classic Bluetooth printers paired in Windows show up as COM ports); LAN scan for port 9100.
- New "desktop" transport in the web app driver registry; only the Khatario site may call it.
- PDF pop-ups (`window.open`) open in an in-app window with Print.
- Later: silent A4 PDF printing to a chosen printer.

### C. Printers settings makeover (web)
- "Printers" page: list per device with role badges, status, Test print, Edit (language, paper/label
  size, dpi, cutter, drawer, copies), Remove.
- Add-printer wizard by place: This computer (Windows printers), Network (IP or scan), Bluetooth
  (Android app / Chrome), with model-based defaults and a test page.
- Bill options: copies, auto-cut, open cash drawer after cash sale, logo, footer, UPI QR, language.
- Label options: label size + gap, darkness/speed, offset calibration, print test grid.

### D. Bills that match Indian practice
- Thermal GST bill: GSTIN, place of supply, HSN/SAC summary, CGST/SGST/IGST breakup, round-off,
  amount in words (print language), UPI QR, loyalty/footer, duplicate copy marking.
- KOT (restaurants) to kitchen printer(s) by item category.
- Composition-scheme "Bill of Supply" wording; e-invoice IRN/QR when present.

### E. Phone apps
- Flutter app: Classic Bluetooth + BLE + USB-OTG printing using bytes from the server
  (`/api/print/render` returns ready ESC/POS/TSPL/ZPL bytes, rasterised text included), so Dart only moves bytes.
- Capacitor app: TSPL/ZPL labels and raster text via phase A.

### F. Status, diagnostics, support
- Status read (DLE EOT) over TCP/COM/SPP where supported; job log per device; diagnostics page with
  last error, transport, bytes sent; "send logs to support".

## Hardware test bench

TVS RP3160 Gold (USB + Classic BT), Epson TM-T82X (USB/LAN), 58mm Classic BT (Everycom/Rugtek),
58mm BLE (Goojprt PT-210), TSC TTP-244 Pro (TSPL, USB), Xprinter XP-365B (TSPL, USB/BT),
Zebra ZD220 (ZPL), any A4 laser. Each phase is checked on the relevant printers before release.

## Status log

- 16 Oct 2026 — plan written; phase A started.
- 16 Oct 2026 — phase A in progress: shared label layout (ZPL moved onto it, output unchanged, double prefix fixed), TSPL generator, 1-bit bitmap + canvas text rasterizer, TSPL/ZPL label printer profiles. Next: raster text in ESC/POS and ZPL, pick encoder by printer language in useBluetoothPrinter.printLabels, delete tests/tmp-print.
- 16 Oct 2026 — phase A done (not yet checked on real printers): ESC/POS draws non-ASCII lines and bill item rows as GS v 0 images (`columns()` keeps qty/amount aligned; English bills byte-identical), ZPL draws them as ^GFA, TSPL as BITMAP; `useBluetoothPrinter.printLabels` picks TSPL / ZPL / ESC/POS from the printer profile's language. Tests: `tests/lib/print/*`. Next: phase B (Windows native printing).
- 16 Oct 2026 — phase B first cut (not yet checked on real printers): `desktop/src-tauri/src/printing.rs` lists Windows printers (EnumPrinters level 2: port → USB/network/COM/virtual, offline/paused/error flags), sends RAW spooler jobs (installed printers only), TCP 9100–9109 to private LAN addresses only, scans the PC's /24 for port 9100, lists COM ports (SERIALCOMM) and writes to COMn in 512-byte chunks; jobs come base64-encoded, max 4 MB. Allowed for the Khatario sites only (`capabilities/remote-site.json`). Web: `lib/desktop/printing.ts`, `desktop` driver kind (`lib/bluetooth/drivers/desktop.ts`, ids `win:` / `net:` / `com:`), wizard shows "Printers on this computer", COM ports and network IP/search (`components/printer/DesktopPrinterPicker.tsx`). Pop-ups: Khatario pages open in an app window (WebView PDF viewer has Print), other sites go to the default browser. Still to do in B: silent A4 PDF printing to a chosen printer, cash drawer kick, status read. Needs the web app deployed to staging and a new desktop build (older desktop builds are told to update).
- 16 Oct 2026 — phases B–F built (none yet checked on real printers):
  - B: cash drawer pulse (ESC p) per printer (never / cash sales / every bill) and an "Open cash drawer" button.
  - C: Settings › Print & devices rebuilt as a printer list (connection icon, Bills/Labels default chips, Test print, settings, remove) with "Add printer" (same wizard as print pages) and `PrinterSettingsDialog` (printer type → language, paper, copies, cutter, drawer; label darkness/speed/gap/dpi). Test print matches the printer language (test label for TSPL/ZPL). Settings live on the saved printer (`SavedBluetoothPrinter`).
  - D: thermal GST bill — TAX INVOICE / BILL OF SUPPLY title, place of supply, reverse charge, Items/Qty count, amount in words (print language), HSN/SAC-wise tax summary, composition declaration, e-invoice IRN/QR when present, copies with DUPLICATE marking.
  - E: `POST /api/print/render` returns ready bytes (bills by invoice id, labels from `/api/labels/print` JSON, test page, drawer) with Indic text drawn on the server (sharp/Pango, `lib/print/text-raster-server.ts`; the VPS needs Noto fonts). Flutter phone app: `ThermalPrinterChannel.kt` (Classic Bluetooth SPP + USB OTG), Wi‑Fi from Dart, `lib/printing/thermal_printers.dart`, Settings › Printers screen, "Print bill (thermal)" on invoices and "Print barcode labels" on items. Capacitor app already gets TSPL/ZPL + raster text from phase A.
  - F: job log on every direct print (`lib/printer/job-log.ts`) shown on Printer diagnostics with Copy JSON; network ESC/POS printers are asked for status (DLE EOT) before each bill and paper-out / cover-open are reported instead of a lost print.
  - Later: silent A4 PDF printing in the Windows app, KOT to kitchen printers (needs restaurant item categories), status reads over Bluetooth/COM.
- 16 Oct 2026 — silent A4/A5 printing in the Windows app (not yet checked on a real printer): Settings › Print & devices › "A4 / A5 bills" picks a Windows printer and copies (`components/printer/A4PrinterCard.tsx`, saved per device). Print on the invoice page, the invoice view and Save & print on the bill screen then call `desktop_print_page` (`desktop/src-tauri/src/page_print.rs`): a hidden window loads `/print/document?src=/api/invoices/<id>/preview` (only this host's `/api/…/preview`), waits for fonts/images, and WebView2's `Print` sends it to the printer with no dialog; on any failure the PDF opens as before. KOT is not built: Khatario has no restaurant / kitchen module or item-to-kitchen routing yet.
