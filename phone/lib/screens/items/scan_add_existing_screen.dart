import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'scan_add_logic.dart';

/// A scanned barcode already in the shop: add stock, add another pack size that shares the
/// barcode, or skip. Phone side of `components/items/ScanAddExistingActions.tsx`.
/// Pops with a line for the session list, or null when skipped.
class ScanAddExistingScreen extends StatefulWidget {
  const ScanAddExistingScreen({super.key, required this.session, required this.barcode, required this.match, required this.canAddStock});

  final AppSession session;
  final String barcode;
  final Map<String, dynamic> match;

  /// Plan has inventory adjustments; Add stock uses that flow.
  final bool canAddStock;

  @override
  State<ScanAddExistingScreen> createState() => _ScanAddExistingScreenState();
}

enum _Action { choose, stock, size }

class _ScanAddExistingScreenState extends State<ScanAddExistingScreen> {
  late final Map<String, dynamic> _item = widget.match['item'] is Map ? Map<String, dynamic>.from(widget.match['item'] as Map) : const {};
  late final List<Map<String, dynamic>> _variants = (widget.match['variants'] as List? ?? const [])
      .whereType<Map>()
      .map((v) => Map<String, dynamic>.from(v))
      .toList();
  final _qty = TextEditingController();
  final _sizeName = TextEditingController();
  late final _existingSize = TextEditingController(text: _item['net_quantity']?.toString() ?? '');
  late final _itemName = TextEditingController(text: nameWithoutSize(_item['name']?.toString() ?? '', _item['net_quantity']?.toString()));
  final _selling = TextEditingController();
  final _purchase = TextEditingController();
  final _batch = TextEditingController();
  final _mfg = TextEditingController();
  final _exp = TextEditingController();
  late String? _variantId = widget.match['matched_variant_id']?.toString() ?? (_variants.length == 1 ? _variants.first['id']?.toString() : null);
  _Action _action = _Action.choose;
  bool _saving = false;
  Map<String, String> _errors = const {};
  String _key = newScanAddKey();

  bool get _hasVariants => _item['has_variants'] == true;

  /// A plain item that has been sold or bought cannot be split into sizes.
  bool get _canAddSize => _hasVariants || widget.match['has_history'] != true;

  @override
  void dispose() {
    for (final c in [_qty, _sizeName, _existingSize, _itemName, _selling, _purchase, _batch, _mfg, _exp]) {
      c.dispose();
    }
    super.dispose();
  }

  void _open(_Action a) => setState(() {
    _key = newScanAddKey();
    _errors = const {};
    _action = a;
  });

  Future<void> _post(String path, Map<String, dynamic> body) => widget.session.api.postJson(path, body, headers: {'X-Idempotency-Key': _key});

  Future<void> _saveStock() async {
    final qty = num.tryParse(_qty.text.trim()) ?? 0;
    final errors = {...batchErrors(_mfg.text, _exp.text)};
    if (qty <= 0) errors['quantity'] = 'Enter how many you have';
    if (_hasVariants && _variantId == null) errors['variant'] = 'Pick the size';
    setState(() => _errors = errors);
    if (errors.isNotEmpty) return;
    setState(() => _saving = true);
    try {
      await _post('/api/inventory-adjustments', {
        'adjustment_type': 'QUANTITY',
        'item_id': _item['id'],
        if (_hasVariants) 'variant_id': _variantId,
        'direction': 'INCREASE',
        'quantity': qty,
        'reason_code': 'STOCK_TAKE',
        'reason_notes': 'Scan & Add Items',
        'adjustment_date': DateTime.now().toIso8601String().substring(0, 10),
        'batch': ?batchBody(_qty.text, _batch.text, _mfg.text, _exp.text),
      });
      if (mounted) Navigator.of(context).pop('${_item['name']}: $qty added');
    } on ApiException catch (e) {
      // Kept as typed; retrying sends the same key, so the stock cannot be added twice.
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _saveSize() async {
    final qty = num.tryParse(_qty.text.trim()) ?? 0;
    final converting = !_hasVariants;
    final errors = {...batchErrors(_mfg.text, _exp.text)};
    if (_sizeName.text.trim().isEmpty) errors['size'] = 'Enter the new pack size, e.g. 75 g';
    if (converting && _existingSize.text.trim().isEmpty) errors['existing'] = 'Enter the size you already have';
    if (qty > 0 && !((num.tryParse(_purchase.text.trim()) ?? 0) > 0)) errors['purchase_price'] = 'Enter the purchase price for the stock you have';
    setState(() => _errors = errors);
    if (errors.isNotEmpty) return;
    setState(() => _saving = true);
    try {
      await _post('/api/items/scan-add/variant', {
        'item_id': _item['id'],
        'variant_name': _sizeName.text.trim(),
        if (_selling.text.trim().isNotEmpty) 'selling_price': _selling.text.trim(),
        if (_purchase.text.trim().isNotEmpty) 'purchase_price': _purchase.text.trim(),
        'opening_stock': qty,
        'batch': ?batchBody(_qty.text, _batch.text, _mfg.text, _exp.text),
        if (converting) 'existing_variant_name': _existingSize.text.trim(),
        if (converting) 'item_name': _itemName.text.trim(),
      });
      final name = converting ? _itemName.text.trim() : _item['name'];
      if (mounted) Navigator.of(context).pop('$name ${_sizeName.text.trim()} added');
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _f(TextEditingController c, String label, {String? field, bool number = false, String? hint}) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpace.md),
    child: TextField(
      controller: c,
      keyboardType: number ? const TextInputType.numberWithOptions(decimal: true) : null,
      style: AppText.body,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        errorText: field == null ? null : _errors[field],
        filled: true,
        fillColor: AppColors.surface,
      ),
    ),
  );

  List<Widget> _batchFields() => [
    _f(_batch, 'Batch no. (optional)'),
    Row(
      children: [
        Expanded(
          child: _f(_mfg, 'Mfg date', field: 'manufacturing_date', hint: '2026-09'),
        ),
        const SizedBox(width: AppSpace.md),
        Expanded(
          child: _f(_exp, 'Expiry date', field: 'expiry_date', hint: '2027-03'),
        ),
      ],
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final sizes = _variants.map((v) => v['variant_name']?.toString() ?? '').where((v) => v.isNotEmpty).join(', ');
    final matched = _variants.where((v) => v['id']?.toString() == widget.match['matched_variant_id']?.toString()).firstOrNull;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              height: 64,
              child: Row(
                children: [
                  const SizedBox(width: 4),
                  KIconButton(icon: LucideIcons.x, tooltip: 'Close', onTap: () => Navigator.pop(context)),
                  const SizedBox(width: 4),
                  Expanded(child: Text('Already in your shop', style: AppText.heading.copyWith(fontSize: 18))),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
                children: [
                  KCard(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text('${_item['name'] ?? ''}${matched != null ? ' · ${matched['variant_name']}' : ''}', style: AppText.body),
                        const SizedBox(height: 4),
                        Text(
                          'Barcode ${widget.barcode} · Stock ${matched?['current_stock'] ?? _item['current_stock'] ?? 0} ${_item['unit'] ?? ''}'
                          '${sizes.isEmpty ? '' : ' · Sizes: $sizes'}',
                          style: AppText.label,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpace.md),
                  if (_action == _Action.choose) ...[
                    if (widget.canAddStock) ...[KButton(label: 'Add stock', onPressed: () => _open(_Action.stock)), const SizedBox(height: AppSpace.sm)],
                    if (_canAddSize) ...[
                      KButton.secondary(label: 'Another size, same barcode', onPressed: () => _open(_Action.size)),
                      const SizedBox(height: AppSpace.sm),
                    ],
                    KButton.secondary(label: 'Skip, scan next', onPressed: () => Navigator.of(context).pop()),
                    if (!_canAddSize) ...[
                      const SizedBox(height: AppSpace.md),
                      Text(
                        'This item has sales or purchases, so it cannot be split into sizes. Add a different size as a separate item without this barcode.',
                        style: AppText.label,
                      ),
                    ],
                  ],
                  if (_action == _Action.stock) ...[
                    if (_hasVariants) ...[
                      Text('Size', style: AppText.label),
                      const SizedBox(height: AppSpace.sm),
                      KChipBar<String>(
                        value: _variantId ?? '',
                        padding: EdgeInsets.zero,
                        options: [for (final v in _variants) (v['id'].toString(), v['variant_name']?.toString() ?? '')],
                        onChanged: (v) => setState(() => _variantId = v),
                      ),
                      if (_errors['variant'] != null) Text(_errors['variant']!, style: AppText.label.copyWith(color: AppColors.negative)),
                      const SizedBox(height: AppSpace.md),
                    ],
                    _f(_qty, 'How many to add *', field: 'quantity', number: true),
                    ..._batchFields(),
                    Text("Valued at the item's current purchase price.", style: AppText.label),
                  ],
                  if (_action == _Action.size) ...[
                    if (!_hasVariants) ...[
                      Text('${_item['name']} will become one product with sizes. Scanning this barcode at billing will ask which size.', style: AppText.body),
                      const SizedBox(height: AppSpace.md),
                      _f(_itemName, 'Product name (without size)'),
                      _f(_existingSize, 'Size you already have *', field: 'existing', hint: '100 g'),
                    ],
                    _f(_sizeName, 'New size *', field: 'size', hint: '75 g'),
                    Row(
                      children: [
                        Expanded(child: _f(_selling, 'Selling price', number: true)),
                        const SizedBox(width: AppSpace.md),
                        Expanded(child: _f(_purchase, 'Purchase price', field: 'purchase_price', number: true)),
                      ],
                    ),
                    _f(_qty, 'Stock you have now', number: true),
                    ..._batchFields(),
                  ],
                ],
              ),
            ),
            if (_action != _Action.choose)
              KBottomBar(
                children: [
                  Expanded(
                    child: KButton.secondary(label: 'Back', onPressed: _saving ? null : () => setState(() => _action = _Action.choose)),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: KButton(
                      label: _action == _Action.stock ? 'Add stock' : 'Save size',
                      loading: _saving,
                      onPressed: _action == _Action.stock ? _saveStock : _saveSize,
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
