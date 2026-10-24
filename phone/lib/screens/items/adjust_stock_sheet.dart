import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../ui/sheet_messenger.dart';
import '../../ui/web_ui.dart';

/// Reason options in `AdjustItemStockSheet`.
const stockAdjustReasons = [
  ('STOCK_TAKE', 'Stock take'),
  ('DAMAGE', 'Damage'),
  ('THEFT', 'Theft / missing'),
  ('EXPIRED', 'Expired'),
  ('FREE_SAMPLE', 'Free sample'),
];

/// `components/items/AdjustItemStockSheet.tsx` (mobile bottom sheet). Resolves true after "Stock updated".
Future<bool> showAdjustItemStockSheet(
  BuildContext context, {
  required AppSession session,
  required Map<String, dynamic> item,
}) async {
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    enableDrag: false,
    barrierColor: AppColors.scrim,
    backgroundColor: Colors.transparent,
    elevation: 0,
    builder: (_) => SheetMessenger(child: AdjustItemStockSheet(session: session, item: item)),
  );
  return saved == true;
}

class AdjustItemStockSheet extends StatefulWidget {
  const AdjustItemStockSheet({super.key, required this.session, required this.item});

  final AppSession session;
  final Map<String, dynamic> item;

  @override
  State<AdjustItemStockSheet> createState() => _AdjustItemStockSheetState();
}

class _AdjustItemStockSheetState extends State<AdjustItemStockSheet> {
  final _quantity = TextEditingController();
  final _notes = TextEditingController();
  String _direction = 'INCREASE';
  String _reason = 'STOCK_TAKE';
  bool _loading = false;
  bool _warehousesEnabled = false;
  List<Map<String, dynamic>> _locations = const [];
  String _locationId = '';

  KhatarioApi get _api => widget.session.api;
  num get _currentStock => toNum(widget.item['current_stock']);
  String get _unit {
    final u = widget.item['unit']?.toString() ?? '';
    return u.isEmpty ? 'PCS' : u;
  }

  @override
  void initState() {
    super.initState();
    _quantity.addListener(() => setState(() {}));
    _loadLocations();
  }

  @override
  void dispose() {
    _quantity.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _loadLocations() async {
    try {
      final wh = await _api.getJson('/api/settings/warehouses');
      if (mounted) setState(() => _warehousesEnabled = wh['warehouses_enabled'] == true);
    } catch (_) {}
    try {
      final loc = await _api.getJson('/api/locations');
      final list = loc['locations'];
      final locations = list is List ? list.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : <Map<String, dynamic>>[];
      if (!mounted) return;
      setState(() {
        _locations = locations;
        if (locations.length == 1) _locationId = locations.first['id'].toString();
      });
    } catch (_) {}
  }

  double? get _parsedQuantity {
    final q = double.tryParse(_quantity.text.trim());
    return q == null || !q.isFinite ? null : q;
  }

  num? get _quantityAfter {
    final q = _parsedQuantity;
    if (q == null || q <= 0) return null;
    return _currentStock + (_direction == 'INCREASE' ? q : -q);
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _submit() async {
    final q = _parsedQuantity;
    if (q == null || q <= 0) return _toast('Enter a quantity greater than zero');
    final after = _quantityAfter;
    if (after != null && after < 0) return _toast('Stock cannot go below zero');
    if (_reason == 'DAMAGE' && _notes.text.trim().isEmpty) return _toast('Say what was damaged');
    if (_warehousesEnabled && _locationId.isEmpty) return _toast('Select a warehouse');

    setState(() => _loading = true);
    final notes = _notes.text.trim();
    final payload = <String, dynamic>{
      'adjustment_type': 'QUANTITY',
      'adjustment_date': ymd(DateTime.now()),
      'item_id': widget.item['id'],
      'direction': _direction,
      'quantity': q == q.truncateToDouble() ? q.toInt() : q,
      'reason_code': _reason,
      if (notes.isNotEmpty) 'reason_notes': notes,
    };
    final branch = widget.session.defaultBranchId;
    if (_warehousesEnabled && _locationId.isNotEmpty) {
      payload['location_id'] = _locationId;
    } else if (branch != null) {
      payload['branch_id'] = branch;
    }
    try {
      await _api.postJson('/api/inventory-adjustments', payload);
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) _toast(e.message.isEmpty ? 'Failed to adjust stock' : e.message);
    } catch (_) {
      if (mounted) _toast('Failed to adjust stock');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final after = _quantityAfter;
    final damage = _reason == 'DAMAGE';
    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.9),
      child: Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 8),
                width: 36,
                height: 4,
                decoration: BoxDecoration(color: AppColors.hairline, borderRadius: BorderRadius.circular(4)),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 6, 8, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Adjust stock', style: AppText.heading),
                        Text(widget.item['name']?.toString() ?? '', maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.caption),
                      ],
                    ),
                  ),
                  KIconButton(icon: LucideIcons.x, tooltip: 'Close', onTap: () => Navigator.of(context).pop()),
                ],
              ),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      decoration: BoxDecoration(color: AppColors.sunken, borderRadius: BorderRadius.circular(AppRadius.md)),
                      child: Row(
                        children: [
                          const Icon(LucideIcons.package, size: 18, color: AppColors.ink2),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text.rich(
                              TextSpan(children: [
                                const TextSpan(text: 'Current stock: '),
                                TextSpan(
                                  text: '${jsNumberString(_currentStock)} $_unit',
                                  style: TextStyle(
                                    fontWeight: FontWeight.w700,
                                    color: _currentStock < 0 ? AppColors.negative : AppColors.ink,
                                    fontFeatures: AppText.tabular,
                                  ),
                                ),
                              ]),
                              style: AppText.label,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: _DirectionButton(
                            label: 'Add stock',
                            icon: LucideIcons.plus,
                            tone: KTone.positive,
                            selected: _direction == 'INCREASE',
                            onTap: () => setState(() => _direction = 'INCREASE'),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: _DirectionButton(
                            label: 'Reduce stock',
                            icon: LucideIcons.minus,
                            tone: KTone.negative,
                            selected: _direction == 'DECREASE',
                            onTap: () => setState(() => _direction = 'DECREASE'),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    WebInput(
                      label: 'Quantity ($_unit)',
                      controller: _quantity,
                      placeholder: '0',
                      autofocus: true,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    ),
                    if (after != null) ...[
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Icon(LucideIcons.arrowRight, size: 14, color: after < 0 ? AppColors.negative : AppColors.ink2),
                          const SizedBox(width: 6),
                          Text.rich(
                            TextSpan(children: [
                              const TextSpan(text: 'New stock: '),
                              TextSpan(
                                text: '${enIn(after)} $_unit',
                                style: TextStyle(
                                  fontWeight: FontWeight.w700,
                                  color: after < 0 ? AppColors.negative : AppColors.ink,
                                  fontFeatures: AppText.tabular,
                                ),
                              ),
                            ]),
                            style: AppText.label,
                          ),
                        ],
                      ),
                    ],
                    if (_warehousesEnabled && _locations.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      const _FieldLabel('Warehouse'),
                      WebFieldSelect<String>(
                        value: _locationId,
                        options: [
                          ('', 'Select warehouse'),
                          for (final l in _locations)
                            (
                              l['id'].toString(),
                              '${l['name'] ?? ''}${(l['location_code']?.toString() ?? '').isNotEmpty ? ' (${l['location_code']})' : ''}',
                            ),
                        ],
                        onChanged: (v) => setState(() => _locationId = v),
                      ),
                    ],
                    const SizedBox(height: 16),
                    const _FieldLabel('Reason'),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final (id, label) in stockAdjustReasons)
                          KChip(label: label, selected: _reason == id, onTap: () => setState(() => _reason = id)),
                      ],
                    ),
                    const SizedBox(height: 16),
                    WebInput(
                      label: damage ? 'What was damaged' : 'Notes (optional)',
                      controller: _notes,
                      placeholder: damage ? 'Crushed packets, broken seal' : 'Optional note',
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(20, 8, 20, 12 + MediaQuery.of(context).padding.bottom),
              child: KButton(
                label: damage ? 'Save damage' : 'Save adjustment',
                icon: LucideIcons.check,
                loading: _loading,
                onPressed: _submit,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(text, style: AppText.label));
  }
}

class _DirectionButton extends StatelessWidget {
  const _DirectionButton({required this.label, required this.icon, required this.tone, required this.selected, required this.onTap});

  final String label;
  final IconData icon;
  final KTone tone;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final fg = selected ? tone.fg : AppColors.ink2;
    return Semantics(
      container: true,
      button: true,
      selected: selected,
      child: Material(
        color: selected ? tone.bg : AppColors.sunken,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
          side: BorderSide(color: selected ? tone.fg.withValues(alpha: 0.5) : Colors.transparent, width: 1.5),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadius.md),
          onTap: onTap,
          child: SizedBox(
            height: 48,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, size: 18, color: fg),
                const SizedBox(width: 6),
                Text(label, style: AppText.bodyStrong.copyWith(color: fg, fontSize: 14)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
