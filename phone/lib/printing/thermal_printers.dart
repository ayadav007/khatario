import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api.dart';

/// How a saved printer is reached from this phone.
enum PrinterConnection { bluetooth, usb, network }

/// Command language: bills are ESC/POS; label printers speak TSPL (TSC, Xprinter, TVS LP) or ZPL (Zebra).
enum PrinterLanguage { escpos, tspl, zpl }

extension on PrinterLanguage {
  String get wire => switch (this) { PrinterLanguage.escpos => 'ESCPOS', PrinterLanguage.tspl => 'TSPL', PrinterLanguage.zpl => 'ZPL' };
}

/// A printer saved on this phone, with the same options as the website's Printers page.
class ThermalPrinter {
  ThermalPrinter({
    required this.id,
    required this.name,
    required this.connection,
    required this.address,
    this.language = PrinterLanguage.escpos,
    this.paperWidthMm = 58,
    this.copies = 1,
    this.autoCut = true,
    this.cashDrawer = 'never',
    this.labelDensity,
    this.labelSpeed,
    this.labelGapMm,
    this.dpi = 203,
    this.forBills = false,
    this.forLabels = false,
  });

  final String id;
  String name;
  final PrinterConnection connection;

  /// Bluetooth MAC, USB device name, or `ip:port`.
  final String address;
  PrinterLanguage language;
  int paperWidthMm;
  int copies;
  bool autoCut;

  /// never | cash | always
  String cashDrawer;
  int? labelDensity;
  int? labelSpeed;
  int? labelGapMm;
  int dpi;
  bool forBills;
  bool forLabels;

  bool get isLabelPrinter => language != PrinterLanguage.escpos;

  String get connectionLabel => switch (connection) {
        PrinterConnection.bluetooth => 'Bluetooth',
        PrinterConnection.usb => 'USB',
        PrinterConnection.network => 'Wi‑Fi / LAN $address',
      };

  /// The `printer` object /api/print/render expects.
  Map<String, dynamic> renderSpec({bool openDrawer = false}) => {
        'language': language.wire,
        'paper_width_mm': paperWidthMm,
        'dpi': dpi,
        'copies': copies,
        'auto_cut': autoCut,
        'open_drawer': openDrawer,
        if (labelDensity != null) 'density': labelDensity,
        if (labelSpeed != null) 'speed': labelSpeed,
        if (labelGapMm != null) 'gap_mm': labelGapMm,
        'name': name,
      };

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'connection': connection.name,
        'address': address,
        'language': language.name,
        'paperWidthMm': paperWidthMm,
        'copies': copies,
        'autoCut': autoCut,
        'cashDrawer': cashDrawer,
        'labelDensity': labelDensity,
        'labelSpeed': labelSpeed,
        'labelGapMm': labelGapMm,
        'dpi': dpi,
        'forBills': forBills,
        'forLabels': forLabels,
      };

  static ThermalPrinter? fromJson(Map<String, dynamic> j) {
    final connection = PrinterConnection.values.where((c) => c.name == j['connection']).firstOrNull;
    if (connection == null || j['id'] is! String || j['address'] is! String) return null;
    return ThermalPrinter(
      id: j['id'] as String,
      name: (j['name'] as String?) ?? 'Printer',
      connection: connection,
      address: j['address'] as String,
      language: PrinterLanguage.values.where((l) => l.name == j['language']).firstOrNull ?? PrinterLanguage.escpos,
      paperWidthMm: j['paperWidthMm'] == 80 ? 80 : 58,
      copies: (j['copies'] as num?)?.toInt().clamp(1, 3) ?? 1,
      autoCut: j['autoCut'] != false,
      cashDrawer: const ['never', 'cash', 'always'].contains(j['cashDrawer']) ? j['cashDrawer'] as String : 'never',
      labelDensity: (j['labelDensity'] as num?)?.toInt(),
      labelSpeed: (j['labelSpeed'] as num?)?.toInt(),
      labelGapMm: (j['labelGapMm'] as num?)?.toInt(),
      dpi: j['dpi'] == 300 ? 300 : 203,
      forBills: j['forBills'] == true,
      forLabels: j['forLabels'] == true,
    );
  }
}

/// Guesses the language from the model name printed on the device (same rules as the website).
PrinterLanguage guessPrinterLanguage(String name) {
  final n = name.toUpperCase();
  const zpl = ['ZEBRA', 'ZD2', 'ZD4', 'ZQ', 'GK4', 'GC4', 'GX4', 'ZT'];
  const tspl = ['TSC', 'TTP', 'TE2', 'TE3', 'TA2', 'XP-36', 'XP-37', 'XP-42', 'XP-46', 'XP-47', 'XP-DT', 'TVS LP', 'LP 4', 'GAINSCHA', 'GODEX', 'LABEL'];
  if (zpl.any(n.contains)) return PrinterLanguage.zpl;
  if (tspl.any(n.contains)) return PrinterLanguage.tspl;
  return PrinterLanguage.escpos;
}

/// A failure with a message ready for the cashier.
class PrintFailure implements Exception {
  PrintFailure(this.message, {this.code});
  final String message;
  final String? code;
  bool get needsPermission => code == 'PERMISSION';

  @override
  String toString() => message;
}

/// Saved printers (per business, on this phone) and printing through them.
class ThermalPrinting {
  ThermalPrinting(this.api, this.businessId);

  final KhatarioApi api;
  final String businessId;

  static const _channel = MethodChannel('khatario/thermal_printer');

  String get _key => 'khatario.thermal-printers.$businessId';

  Future<List<ThermalPrinter>> list() async {
    final prefs = await SharedPreferences.getInstance();
    try {
      final raw = jsonDecode(prefs.getString(_key) ?? '[]');
      if (raw is! List) return [];
      return raw.whereType<Map>().map((m) => ThermalPrinter.fromJson(Map<String, dynamic>.from(m))).whereType<ThermalPrinter>().toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> saveAll(List<ThermalPrinter> printers) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(printers.map((p) => p.toJson()).toList()));
  }

  /// Adds or replaces a printer. The first bill / label printer becomes the default for that job.
  Future<void> save(ThermalPrinter printer) async {
    final all = await list();
    final i = all.indexWhere((p) => p.id == printer.id);
    if (i >= 0) {
      all[i] = printer;
    } else {
      if (!printer.isLabelPrinter && !all.any((p) => p.forBills)) printer.forBills = true;
      if (printer.isLabelPrinter && !all.any((p) => p.forLabels)) printer.forLabels = true;
      all.add(printer);
    }
    await saveAll(all);
  }

  Future<void> remove(String id) async => saveAll((await list())..removeWhere((p) => p.id == id));

  Future<void> setDefault(String id, {required bool bills}) async {
    final all = await list();
    for (final p in all) {
      if (bills) {
        p.forBills = p.id == id;
      } else {
        p.forLabels = p.id == id;
      }
    }
    await saveAll(all);
  }

  Future<ThermalPrinter?> billPrinter() async {
    final all = await list();
    return all.where((p) => p.forBills).firstOrNull ?? all.where((p) => !p.isLabelPrinter).firstOrNull;
  }

  Future<ThermalPrinter?> labelPrinter() async {
    final all = await list();
    return all.where((p) => p.forLabels).firstOrNull ?? all.where((p) => p.isLabelPrinter).firstOrNull;
  }

  // ------------------------------------------------------------------ discovery

  /// Printers paired in phone Bluetooth settings (printers first).
  static Future<List<Map<String, dynamic>>> pairedBluetooth() async {
    final list = await _invoke<List<dynamic>>('pairedDevices') ?? const [];
    final devices = list.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
    devices.sort((a, b) => (b['likelyPrinter'] == true ? 1 : 0) - (a['likelyPrinter'] == true ? 1 : 0));
    return devices;
  }

  static Future<List<Map<String, dynamic>>> usbPrinters() async {
    final list = await _invoke<List<dynamic>>('usbDevices') ?? const [];
    return list.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
  }

  static Future<void> openBluetoothSettings() => _invoke<void>('openBluetoothSettings');

  /// True when a network printer answers on its raw-print port.
  static Future<bool> probeNetwork(String host, {int port = 9100}) async {
    try {
      final s = await Socket.connect(host, port, timeout: const Duration(milliseconds: 2500));
      s.destroy();
      return true;
    } catch (_) {
      return false;
    }
  }

  // ------------------------------------------------------------------ printing

  /// A bill for a saved invoice, built by the server (GST layout, Hindi as images).
  Future<void> printInvoice(ThermalPrinter printer, String invoiceId) async {
    final bytes = await _render({
      'kind': 'receipt',
      'invoice_id': invoiceId,
      'printer': printer.renderSpec(openDrawer: printer.cashDrawer != 'never'),
    });
    await send(printer, bytes);
  }

  /// Labels from POST /api/labels/print (format json): `{ template, lines, businessName }`.
  Future<void> printLabels(ThermalPrinter printer, Map<String, dynamic> labelsJson) async {
    final bytes = await _render({
      'kind': 'labels',
      'template': labelsJson['template'],
      'lines': labelsJson['lines'],
      'business_name': labelsJson['businessName'] ?? '',
      'printer': printer.renderSpec(),
    });
    await send(printer, bytes);
  }

  Future<void> printTest(ThermalPrinter printer) async =>
      send(printer, await _render({'kind': 'test', 'printer': printer.renderSpec()}));

  Future<void> openDrawer(ThermalPrinter printer) async =>
      send(printer, await _render({'kind': 'drawer', 'printer': printer.renderSpec()}));

  Future<Uint8List> _render(Map<String, dynamic> body) async {
    try {
      return Uint8List.fromList(await api.postForBytes('/api/print/render', body));
    } on ApiException catch (e) {
      throw PrintFailure(e.message);
    }
  }

  /// Sends ready bytes to the printer.
  static Future<void> send(ThermalPrinter printer, Uint8List bytes) async {
    switch (printer.connection) {
      case PrinterConnection.bluetooth:
        await _invoke<void>('printBluetooth', {'address': printer.address, 'bytes': bytes});
      case PrinterConnection.usb:
        await _invoke<void>('printUsb', {'device': printer.address, 'bytes': bytes});
      case PrinterConnection.network:
        final parts = printer.address.split(':');
        final host = parts.first;
        final port = parts.length > 1 ? int.tryParse(parts[1]) ?? 9100 : 9100;
        Socket? socket;
        try {
          socket = await Socket.connect(host, port, timeout: const Duration(seconds: 3));
          socket.add(bytes);
          await socket.flush();
          await socket.close();
        } on SocketException {
          throw PrintFailure('No printer answered at $host. Check it is on and on the same Wi‑Fi as this phone.');
        } finally {
          socket?.destroy();
        }
    }
  }

  static Future<T?> _invoke<T>(String method, [Map<String, dynamic>? args]) async {
    try {
      return await _channel.invokeMethod<T>(method, args);
    } on PlatformException catch (e) {
      throw PrintFailure(e.message ?? 'Could not print. Check the printer and try again.', code: e.code);
    } on MissingPluginException {
      throw PrintFailure('Update the Khatario app to print to Bluetooth and USB printers.');
    }
  }
}
