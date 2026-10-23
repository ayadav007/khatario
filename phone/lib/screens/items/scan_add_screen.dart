import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'scan_add_logic.dart';

/// Scan & Add Items, the phone side of `app/(app)/items/scan-add/page.tsx`.
/// Scan a barcode; if the shop already has it, say so; otherwise fill in the new item and its stock.
class ScanAddScreen extends StatefulWidget {
  const ScanAddScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ScanAddScreen> createState() => _ScanAddScreenState();
}

class _ScanAddScreenState extends State<ScanAddScreen> {
  final _controller = MobileScannerController(detectionSpeed: DetectionSpeed.normal);
  final _typed = TextEditingController();
  final _added = <String>[];
  String? _last;
  DateTime _lastAt = DateTime(2000);
  bool _busy = false;
  String? _message;
  bool _error = false;

  @override
  void dispose() {
    _controller.dispose();
    _typed.dispose();
    super.dispose();
  }

  void _say(String message, {bool error = false}) => setState(() {
        _message = message;
        _error = error;
      });

  Future<void> _handle(String code) async {
    final c = code.replaceAll(RegExp(r'\s+'), '');
    if (c.isEmpty || _busy) return;
    // The camera reports the same code many times a second; one lookup per 2 s per code.
    final now = DateTime.now();
    if (c == _last && now.difference(_lastAt) < const Duration(seconds: 2)) return;
    _last = c;
    _lastAt = now;
    setState(() => _busy = true);
    Map<String, dynamic>? match;
    try {
      final body = await widget.session.api.getJson(
        Uri(path: '/api/items/scan-add/barcode', queryParameters: {'code': c}).toString(),
      );
      final m = body['match'];
      match = m is Map ? Map<String, dynamic>.from(m) : null;
    } on ApiException catch (e) {
      // The shopkeeper can still add the item by hand.
      if (mounted) _say(e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    if (!mounted) return;
    HapticFeedback.mediumImpact();
    await _controller.stop();
    if (match != null) {
      await _showExisting(c, match);
    } else {
      await _openForm(c);
    }
    _last = null;
    if (mounted) await _controller.start();
  }

  Future<void> _openForm(String barcode) async {
    final name = await Navigator.of(context).push<String>(MaterialPageRoute(
      builder: (_) => ScanAddFormScreen(session: widget.session, barcode: barcode),
    ));
    if (!mounted) return;
    if (name != null) {
      setState(() => _added.add(name));
      _say('Added $name. Scan the next product.');
    }
  }

  Future<void> _showExisting(String barcode, Map<String, dynamic> match) async {
    final item = match['item'] is Map ? Map<String, dynamic>.from(match['item'] as Map) : const <String, dynamic>{};
    final variants = (match['variants'] as List? ?? const []).whereType<Map>().map((v) => v['variant_name']?.toString() ?? '').where((v) => v.isNotEmpty).toList();
    final stock = item['current_stock'];
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpace.gutter),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Already in your shop', style: AppText.heading.copyWith(fontSize: 18)),
              const SizedBox(height: AppSpace.sm),
              Text(item['name']?.toString() ?? '', style: AppText.body),
              const SizedBox(height: 4),
              Text(
                'Barcode $barcode · Stock ${stock ?? 0} ${item['unit'] ?? ''}${variants.isEmpty ? '' : ' · Sizes: ${variants.join(', ')}'}',
                style: AppText.label,
              ),
              const SizedBox(height: AppSpace.md),
              KButton(label: 'Skip, scan next', onPressed: () => Navigator.of(ctx).pop()),
            ],
          ),
        ),
      ),
    );
    if (mounted) _say('${item['name'] ?? 'This product'} is already in your shop.');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(_added.isEmpty ? 'Scan & add items' : '${_added.length} added'),
        actions: [
          IconButton(
            tooltip: 'Torch',
            icon: const Icon(LucideIcons.flashlight),
            onPressed: () => _controller.toggleTorch(),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                MobileScanner(
                  controller: _controller,
                  onDetect: (capture) {
                    final code = capture.barcodes.map((b) => b.rawValue).whereType<String>().firstOrNull;
                    if (code != null) _handle(code);
                  },
                  errorBuilder: (context, error) => Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        error.errorCode == MobileScannerErrorCode.permissionDenied
                            ? 'Allow camera access for Khatario in phone settings, or type the code below.'
                            : 'The camera is not available. Type the code below.',
                        textAlign: TextAlign.center,
                        style: AppText.body.copyWith(color: Colors.white),
                      ),
                    ),
                  ),
                ),
                Center(
                  child: Container(
                    width: 260,
                    height: 150,
                    decoration: BoxDecoration(
                      border: Border.all(color: Colors.white.withValues(alpha: 0.85), width: 2),
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                ),
                if (_busy) const Center(child: CircularProgressIndicator(color: Colors.white)),
              ],
            ),
          ),
          Container(
            color: AppColors.surface,
            padding: EdgeInsets.fromLTRB(16, 12, 16, 12 + MediaQuery.of(context).padding.bottom),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_message != null)
                  Container(
                    padding: const EdgeInsets.all(10),
                    margin: const EdgeInsets.only(bottom: 10),
                    decoration: BoxDecoration(
                      color: _error ? AppColors.negativeSoft : AppColors.positiveSoft,
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                    ),
                    child: Text(_message!, style: AppText.body.copyWith(color: _error ? AppColors.negative : AppColors.positive)),
                  ),
                TextField(
                  controller: _typed,
                  keyboardType: TextInputType.number,
                  textInputAction: TextInputAction.done,
                  decoration: const InputDecoration(isDense: true, hintText: 'Or type the barcode', prefixIcon: Icon(LucideIcons.scanBarcode, size: 18)),
                  onSubmitted: (v) {
                    _last = null;
                    _handle(v);
                    _typed.clear();
                  },
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: KButton.secondary(
                        label: 'No barcode',
                        onPressed: () async {
                          await _controller.stop();
                          await _openForm('');
                          if (mounted) await _controller.start();
                        },
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(child: KButton(label: 'Done', onPressed: () => Navigator.of(context).pop(_added.isNotEmpty))),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// New item details and opening stock for one scanned product. Pops with the saved item's name.
class ScanAddFormScreen extends StatefulWidget {
  const ScanAddFormScreen({super.key, required this.session, required this.barcode});

  final AppSession session;
  final String barcode;

  @override
  State<ScanAddFormScreen> createState() => _ScanAddFormScreenState();
}

class _ScanAddFormScreenState extends State<ScanAddFormScreen> {
  late final _barcode = TextEditingController(text: widget.barcode);
  final _name = TextEditingController();
  final _brand = TextEditingController();
  final _size = TextEditingController();
  final _mrp = TextEditingController();
  final _selling = TextEditingController();
  final _purchase = TextEditingController();
  final _hsn = TextEditingController();
  final _opening = TextEditingController();
  String _unit = 'PCS';
  String _tax = '0';
  bool _saving = false;
  Map<String, String> _errors = const {};
  // One key per product, reused when a failed save is retried.
  final _key = newScanAddKey();

  @override
  void dispose() {
    for (final c in [_barcode, _name, _brand, _size, _mrp, _selling, _purchase, _hsn, _opening]) {
      c.dispose();
    }
    super.dispose();
  }

  ScanAddValues get _values => ScanAddValues(
        barcode: _barcode.text,
        name: _name.text,
        brand: _brand.text,
        size: _size.text,
        unit: _unit,
        mrp: _mrp.text,
        sellingPrice: _selling.text,
        purchasePrice: _purchase.text,
        taxRate: _tax,
        hsn: _hsn.text,
        openingStock: _opening.text,
      );

  Future<void> _save() async {
    final errors = validateScanAdd(_values);
    setState(() => _errors = errors);
    if (errors.isNotEmpty) return;
    setState(() => _saving = true);
    try {
      final body = await widget.session.api.postJson('/api/items', scanAddItemBody(_values), headers: {'X-Idempotency-Key': _key});
      final item = body['item'];
      final name = item is Map ? item['name']?.toString() : null;
      if (mounted) Navigator.of(context).pop(name ?? _name.text.trim());
    } on ApiException catch (e) {
      // Everything typed stays; retrying sends the same key, so it cannot add the item twice.
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _f(TextEditingController c, String label, {String? field, bool number = false, String? hint}) => TextField(
        controller: c,
        keyboardType: number ? const TextInputType.numberWithOptions(decimal: true) : null,
        style: AppText.body,
        cursorColor: AppColors.brand,
        onChanged: field == null || !_errors.containsKey(field) ? null : (_) => setState(() => _errors = {..._errors}..remove(field)),
        decoration: InputDecoration(
          labelText: label,
          hintText: hint,
          errorText: field == null ? null : _errors[field],
          labelStyle: AppText.body.copyWith(color: AppColors.ink3),
          filled: true,
          fillColor: AppColors.surface,
          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppRadius.md),
            borderSide: const BorderSide(color: AppColors.hairline, width: 1.5),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppRadius.md),
            borderSide: BorderSide(color: AppColors.brand, width: 2),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    // Same stock units as the website's New Item form; the pack size goes in "Size on pack".
    const units = [('PCS', 'PCS'), ('KG', 'KG'), ('LTR', 'LTR'), ('BOX', 'BOX'), ('NOS', 'NOS')];
    // GST_RATE_SLABS in lib/gst/rates.ts, the ones a grocery shop uses.
    const rates = [('0', '0%'), ('5', '5%'), ('18', '18%'), ('40', '40%')];
    const gap = SizedBox(height: AppSpace.md);
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              height: 64,
              child: Row(children: [
                const SizedBox(width: 4),
                KIconButton(icon: LucideIcons.x, tooltip: 'Close', onTap: () => Navigator.pop(context)),
                const SizedBox(width: 4),
                Expanded(child: Text('New product', style: AppText.heading.copyWith(fontSize: 18))),
              ]),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
                children: [
                  Text(
                    widget.barcode.isEmpty ? 'Adding a product without a barcode.' : 'Barcode ${widget.barcode} is not in your shop yet.',
                    style: AppText.label,
                  ),
                  gap,
                  KCard(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _f(_name, 'Product name *', field: 'name', hint: 'Parle-G Biscuit'),
                        gap,
                        Row(children: [
                          Expanded(child: _f(_brand, 'Brand', hint: 'Parle')),
                          const SizedBox(width: AppSpace.md),
                          Expanded(child: _f(_size, 'Size on pack', hint: '100 g')),
                        ]),
                        gap,
                        Text('Unit', style: AppText.label),
                        const SizedBox(height: AppSpace.sm),
                        KChipBar<String>(value: _unit, padding: EdgeInsets.zero, options: units, onChanged: (v) => setState(() => _unit = v)),
                        gap,
                        _f(_barcode, 'Barcode', number: true),
                      ],
                    ),
                  ),
                  gap,
                  KCard(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(children: [
                          Expanded(child: _f(_mrp, 'MRP', field: 'mrp', number: true)),
                          const SizedBox(width: AppSpace.md),
                          Expanded(child: _f(_selling, 'Selling price', field: 'selling_price', number: true)),
                        ]),
                        gap,
                        Row(children: [
                          Expanded(child: _f(_purchase, 'Purchase price', field: 'purchase_price', number: true)),
                          const SizedBox(width: AppSpace.md),
                          Expanded(child: _f(_opening, 'Stock you have', field: 'opening_stock', number: true)),
                        ]),
                        gap,
                        Text('GST rate', style: AppText.label),
                        const SizedBox(height: AppSpace.sm),
                        KChipBar<String>(value: _tax, padding: EdgeInsets.zero, options: rates, onChanged: (v) => setState(() => _tax = v)),
                        gap,
                        _f(_hsn, 'HSN (optional)', field: 'hsn_sac', number: true),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            KBottomBar(children: [
              Expanded(child: KButton(label: 'Save and scan next', icon: LucideIcons.check, loading: _saving, onPressed: _save)),
            ]),
          ],
        ),
      ),
    );
  }
}
