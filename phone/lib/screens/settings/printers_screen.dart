import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../printing/thermal_printers.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'settings_kit.dart';

/// Settings › Printers: bill and barcode label printers on this phone (Bluetooth, USB OTG, Wi‑Fi).
class PrintersScreen extends StatefulWidget {
  const PrintersScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<PrintersScreen> createState() => _PrintersScreenState();
}

class _PrintersScreenState extends State<PrintersScreen> {
  late final ThermalPrinting _printing = ThermalPrinting(widget.session.api, widget.session.businessId ?? '');
  List<ThermalPrinter> _printers = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final list = await _printing.list();
    if (mounted) setState(() => (_printers = list, _loading = false));
  }

  void _toast(String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Future<void> _add() async {
    final printer = await showAddPrinterSheet(context);
    if (printer == null) return;
    await _printing.save(printer);
    await _load();
    if (!mounted) return;
    _toast('${printer.name} added');
    await _edit(printer);
  }

  Future<void> _edit(ThermalPrinter printer) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => PrinterEditScreen(printing: _printing, printer: printer),
    ));
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Printers',
      blurb: 'Bill and barcode label printers on this phone.',
      icon: LucideIcons.printer,
      loading: _loading,
      onRefresh: _load,
      children: [
        SettingsSection(
          title: 'Printers on this phone',
          why: 'Bluetooth printers paired in phone Settings, USB printers on an OTG cable, and Wi‑Fi printers.',
          children: [
            if (_printers.isEmpty)
              const Padding(
                padding: EdgeInsets.all(14),
                child: Text('No printers yet. Turn the printer on and tap Add printer.'),
              ),
            for (final p in _printers)
              SettingRow(
                label: p.name,
                help: [
                  p.connectionLabel,
                  p.isLabelPrinter ? 'Labels (${p.language.name.toUpperCase()})' : '${p.paperWidthMm} mm bills',
                  if (p.forBills) 'prints bills',
                  if (p.forLabels) 'prints labels',
                ].join(' · '),
                onTap: () => _edit(p),
                trailing: Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
              ),
          ],
        ),
        KButton(label: 'Add printer', icon: LucideIcons.plus, onPressed: _add),
        const SizedBox(height: AppSpace.lg),
        Text(
          'Tip: pair Bluetooth printers once in phone Settings › Bluetooth (PIN is usually 0000 or 1234). '
          'For a Wi‑Fi printer, hold FEED while turning it on to print its IP address.',
          style: AppText.caption,
        ),
      ],
    );
  }
}

/// Picks a new printer: paired Bluetooth device, USB printer, or a Wi‑Fi IP. Returns null when closed.
Future<ThermalPrinter?> showAddPrinterSheet(BuildContext context) {
  return showKSheet<ThermalPrinter>(
    context,
    title: 'Add printer',
    scrollable: true,
    builder: (ctx) => const _AddPrinterSheet(),
  );
}

class _AddPrinterSheet extends StatefulWidget {
  const _AddPrinterSheet();

  @override
  State<_AddPrinterSheet> createState() => _AddPrinterSheetState();
}

class _AddPrinterSheetState extends State<_AddPrinterSheet> {
  List<Map<String, dynamic>>? _bt;
  List<Map<String, dynamic>>? _usb;
  String? _error;
  final _ip = TextEditingController();
  bool _checkingIp = false;

  @override
  void initState() {
    super.initState();
    _scan();
  }

  @override
  void dispose() {
    _ip.dispose();
    super.dispose();
  }

  Future<void> _scan() async {
    setState(() => _error = null);
    try {
      final bt = await ThermalPrinting.pairedBluetooth();
      if (mounted) setState(() => _bt = bt);
    } on PrintFailure catch (e) {
      if (mounted) setState(() => (_bt = const [], _error = e.message));
    }
    try {
      final usb = await ThermalPrinting.usbPrinters();
      if (mounted) setState(() => _usb = usb);
    } on PrintFailure {
      if (mounted) setState(() => _usb = const []);
    }
  }

  void _pick(PrinterConnection connection, String address, String name) {
    Navigator.of(context).pop(ThermalPrinter(
      id: '${connection.name}:$address',
      name: name,
      connection: connection,
      address: address,
      language: guessPrinterLanguage(name),
      paperWidthMm: RegExp(r'80|T82|T88|RP3|3160|3200', caseSensitive: false).hasMatch(name) ? 80 : 58,
    ));
  }

  Future<void> _addIp() async {
    final host = _ip.text.trim();
    if (!RegExp(r'^\d{1,3}(\.\d{1,3}){3}$').hasMatch(host)) {
      setState(() => _error = 'Enter the printer IP, like 192.168.1.50.');
      return;
    }
    setState(() => (_checkingIp = true, _error = null));
    final ok = await ThermalPrinting.probeNetwork(host);
    if (!mounted) return;
    setState(() => _checkingIp = false);
    if (!ok) {
      setState(() => _error = 'No printer answered at $host. Check it is on and on the same Wi‑Fi as this phone.');
      return;
    }
    _pick(PrinterConnection.network, '$host:9100', 'Wi‑Fi printer $host');
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_error != null)
            Container(
              padding: const EdgeInsets.all(12),
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(color: AppColors.negativeSoft, borderRadius: BorderRadius.circular(AppRadius.md)),
              child: Text(_error!, style: AppText.body.copyWith(color: AppColors.negative)),
            ),
          Text('Bluetooth (paired in phone Settings)', style: AppText.label),
          const SizedBox(height: 6),
          if (_bt == null)
            const Padding(padding: EdgeInsets.all(12), child: KSpinner())
          else if (_bt!.isEmpty)
            Text('No paired devices. Pair the printer in Bluetooth settings first.', style: AppText.caption)
          else
            for (final d in _bt!)
              KSheetAction(
                icon: LucideIcons.bluetooth,
                label: d['name']?.toString() ?? 'Bluetooth device',
                subtitle: d['likelyPrinter'] == true ? d['address']?.toString() : 'Not a printer? ${d['address']}',
                onTap: () => _pick(PrinterConnection.bluetooth, d['address'].toString(), d['name']?.toString() ?? 'Bluetooth printer'),
              ),
          TextButton.icon(
            onPressed: () async {
              await ThermalPrinting.openBluetoothSettings().catchError((_) {});
            },
            icon: const Icon(LucideIcons.settings, size: 16),
            label: const Text('Open Bluetooth settings'),
          ),
          TextButton.icon(onPressed: _scan, icon: const Icon(LucideIcons.refreshCw, size: 16), label: const Text('Refresh')),
          if (_usb != null && _usb!.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text('USB (OTG cable)', style: AppText.label),
            for (final d in _usb!)
              KSheetAction(
                icon: LucideIcons.usb,
                label: d['name']?.toString() ?? 'USB printer',
                onTap: () => _pick(PrinterConnection.usb, d['device'].toString(), d['name']?.toString() ?? 'USB printer'),
              ),
          ],
          const SizedBox(height: 12),
          Text('Wi‑Fi / LAN printer', style: AppText.label),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _ip,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(hintText: 'Printer IP, e.g. 192.168.1.50', isDense: true),
                  onSubmitted: (_) => _addIp(),
                ),
              ),
              const SizedBox(width: 8),
              KButton(label: 'Add', expand: false, height: 40, loading: _checkingIp, onPressed: _checkingIp ? null : _addIp),
            ],
          ),
        ],
      ),
    );
  }
}

/// One printer's settings, test print and remove.
class PrinterEditScreen extends StatefulWidget {
  const PrinterEditScreen({super.key, required this.printing, required this.printer});

  final ThermalPrinting printing;
  final ThermalPrinter printer;

  @override
  State<PrinterEditScreen> createState() => _PrinterEditScreenState();
}

class _PrinterEditScreenState extends State<PrinterEditScreen> {
  late final ThermalPrinter _p = widget.printer;
  late final _name = TextEditingController(text: widget.printer.name);
  bool _busy = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    _p.name = _name.text.trim().isEmpty ? _p.name : _name.text.trim();
    await widget.printing.save(_p);
    if (_p.forBills) await widget.printing.setDefault(_p.id, bills: true);
    if (_p.forLabels) await widget.printing.setDefault(_p.id, bills: false);
  }

  void _change(VoidCallback fn) {
    setState(fn);
    _save();
  }

  Future<void> _run(Future<void> Function() action, String done) async {
    setState(() => _busy = true);
    try {
      await _save();
      await action();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(done)));
    } on PrintFailure catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: _p.name,
      blurb: _p.connectionLabel,
      icon: _p.connection == PrinterConnection.network
          ? LucideIcons.wifi
          : _p.connection == PrinterConnection.usb
              ? LucideIcons.usb
              : LucideIcons.bluetooth,
      loading: false,
      children: [
        SettingsSection(title: 'Printer', children: [
          TextSetting(label: 'Name', controller: _name, onChanged: (_) => _save()),
          ChoiceSetting<PrinterLanguage>(
            label: 'Printer type',
            help: 'Label printers need their own language to print barcodes.',
            value: _p.language,
            options: const [
              (PrinterLanguage.escpos, 'Bill / receipt printer'),
              (PrinterLanguage.tspl, 'Label printer (TSC, Xprinter, TVS LP)'),
              (PrinterLanguage.zpl, 'Label printer (Zebra / ZPL)'),
            ],
            onChanged: (v) => _change(() => _p.language = v),
          ),
          ToggleSetting(label: 'Print bills here', value: _p.forBills, onChanged: (v) => _change(() => _p.forBills = v)),
          ToggleSetting(label: 'Print labels here', value: _p.forLabels, onChanged: (v) => _change(() => _p.forLabels = v)),
        ]),
        if (!_p.isLabelPrinter)
          SettingsSection(title: 'Bills', children: [
            ChoiceSetting<int>(
              label: 'Paper width',
              value: _p.paperWidthMm,
              options: const [(58, '58 mm (2 inch)'), (80, '80 mm (3 inch)')],
              onChanged: (v) => _change(() => _p.paperWidthMm = v),
            ),
            ChoiceSetting<int>(
              label: 'Copies per bill',
              help: 'Extra copies print as DUPLICATE.',
              value: _p.copies,
              options: const [(1, '1'), (2, '2'), (3, '3')],
              onChanged: (v) => _change(() => _p.copies = v),
            ),
            ToggleSetting(label: 'Cut paper after each bill', value: _p.autoCut, onChanged: (v) => _change(() => _p.autoCut = v)),
            ChoiceSetting<String>(
              label: 'Cash drawer',
              value: _p.cashDrawer,
              options: const [('never', 'No cash drawer'), ('cash', 'Open for cash sales'), ('always', 'Open for every bill')],
              onChanged: (v) => _change(() => _p.cashDrawer = v),
            ),
          ])
        else
          SettingsSection(title: 'Labels', why: 'Label size and layout come from Label templates.', children: [
            ChoiceSetting<int>(
              label: 'Darkness',
              value: _p.labelDensity ?? 8,
              options: [for (var i = 0; i <= 15; i++) (i, i == 8 ? '8 (normal)' : '$i')],
              onChanged: (v) => _change(() => _p.labelDensity = v),
            ),
            ChoiceSetting<int>(
              label: 'Speed',
              value: _p.labelSpeed ?? 4,
              options: [for (var i = 1; i <= 6; i++) (i, '$i in/s')],
              onChanged: (v) => _change(() => _p.labelSpeed = v),
            ),
            ChoiceSetting<int>(
              label: 'Gap between labels',
              value: _p.labelGapMm ?? 2,
              options: const [(0, 'None (continuous)'), (2, '2 mm'), (3, '3 mm'), (4, '4 mm')],
              onChanged: (v) => _change(() => _p.labelGapMm = v),
            ),
            ChoiceSetting<int>(
              label: 'Resolution',
              value: _p.dpi,
              options: const [(203, '203 dpi'), (300, '300 dpi')],
              onChanged: (v) => _change(() => _p.dpi = v),
            ),
          ]),
        KButton(
          label: 'Test print',
          icon: LucideIcons.printer,
          loading: _busy,
          onPressed: _busy ? null : () => _run(() => widget.printing.printTest(_p), 'Test page sent'),
        ),
        if (!_p.isLabelPrinter && _p.cashDrawer != 'never') ...[
          const SizedBox(height: AppSpace.sm),
          KButton.secondary(
            label: 'Open cash drawer',
            icon: LucideIcons.banknote,
            onPressed: _busy ? null : () => _run(() => widget.printing.openDrawer(_p), 'Cash drawer opened'),
          ),
        ],
        const SizedBox(height: AppSpace.sm),
        KButton(
          label: 'Remove printer',
          kind: KButtonKind.danger,
          onPressed: () async {
            await widget.printing.remove(_p.id);
            if (context.mounted) Navigator.of(context).pop();
          },
        ),
      ],
    );
  }
}

/// Prints a saved invoice on the bill printer; with none set up, offers to add one first.
Future<void> printInvoiceOnThermal(BuildContext context, AppSession session, String invoiceId) async {
  final printing = ThermalPrinting(session.api, session.businessId ?? '');
  var printer = await printing.billPrinter();
  if (!context.mounted) return;
  final messenger = ScaffoldMessenger.of(context);
  if (printer == null) {
    messenger.showSnackBar(const SnackBar(content: Text('Printer not connected. Add your bill printer first.')));
    final added = await showAddPrinterSheet(context);
    if (added == null) return;
    await printing.save(added);
    printer = added;
  }
  try {
    await printing.printInvoice(printer, invoiceId);
    messenger.showSnackBar(SnackBar(content: Text('Bill sent to ${printer.name}')));
  } on PrintFailure catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e.message)));
  }
}

/// Prints barcode labels for one item on the label printer (asks how many first).
Future<void> printItemLabels(BuildContext context, AppSession session, String itemId) async {
  final copies = await showKSheet<int>(
    context,
    title: 'How many labels?',
    builder: (ctx) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final n in const [1, 2, 5, 10, 20, 50, 100])
            ActionChip(label: Text('$n'), onPressed: () => Navigator.of(ctx).pop(n)),
        ],
      ),
    ),
  );
  if (copies == null || !context.mounted) return;
  final printing = ThermalPrinting(session.api, session.businessId ?? '');
  var printer = await printing.labelPrinter();
  if (!context.mounted) return;
  final messenger = ScaffoldMessenger.of(context);
  if (printer == null) {
    messenger.showSnackBar(const SnackBar(content: Text('Printer not connected. Add your label printer first.')));
    final added = await showAddPrinterSheet(context);
    if (added == null) return;
    await printing.save(added);
    printer = added;
  }
  try {
    final labels = await session.api.postJson('/api/labels/print', {
      'lines': [
        {'item_id': itemId, 'copies': copies},
      ],
      'format': 'json',
      'purpose': 'standalone',
    });
    await printing.printLabels(printer, labels);
    messenger.showSnackBar(SnackBar(content: Text('$copies label${copies == 1 ? '' : 's'} sent to ${printer.name}')));
  } on PrintFailure catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e.message)));
  } on ApiException catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e.message)));
  }
}
