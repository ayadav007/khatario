import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'item_form_logic.dart';

bool _set(dynamic v) => v != null && v != false && v != 0 && v != '';

/// Create and edit form for the fields on `app/(app)/items/new/page.tsx` that the phone collects.
/// Variants, bundles, images and opening stock stay as they are when [itemId] is set.
class ItemFormScreen extends StatefulWidget {
  const ItemFormScreen({super.key, required this.session, this.itemId});

  final AppSession session;

  /// Null creates an item. Set to edit.
  final String? itemId;

  bool get editing => itemId != null;

  @override
  State<ItemFormScreen> createState() => _ItemFormScreenState();
}

class _ItemFormScreenState extends State<ItemFormScreen> {
  final _name = TextEditingController();
  final _code = TextEditingController();
  final _selling = TextEditingController();
  final _purchase = TextEditingController();
  final _tax = TextEditingController();
  final _hsn = TextEditingController();
  final _opening = TextEditingController();
  final _min = TextEditingController();
  final _description = TextEditingController();
  String _type = 'goods';
  String _unit = 'PCS';
  bool _store = false;
  bool _featured = false;
  bool _saving = false;
  bool _loading = false;
  bool _missing = false;
  bool _complex = false;
  Map<String, dynamic>? _existing;

  @override
  void initState() {
    super.initState();
    if (widget.editing) {
      _loading = true;
      _loadItem();
    } else {
      _loadDefaults();
    }
  }

  Future<void> _loadItem() async {
    try {
      final data = await widget.session.api.getJson('/api/items/${widget.itemId}');
      final item = data['item'];
      if (item is! Map) {
        _missing = true;
        return;
      }
      final row = Map<String, dynamic>.from(item);
      _existing = row;
      _name.text = row['name']?.toString() ?? '';
      _code.text = row['code']?.toString() ?? '';
      _selling.text = itemFieldText(row['selling_price']);
      _purchase.text = itemFieldText(row['purchase_price']);
      _tax.text = itemFieldText(row['tax_rate']);
      _hsn.text = row['hsn_sac']?.toString() ?? '';
      _min.text = itemFieldText(row['min_stock']);
      _description.text = row['description']?.toString() ?? '';
      _type = row['item_type'] == 'service' ? 'service' : 'goods';
      final unit = row['unit']?.toString() ?? '';
      _unit = unit.isEmpty ? 'PCS' : unit;
      _store = row['show_in_store'] == true;
      _featured = row['featured_in_store'] == true;
      _complex = _set(row['has_variants']) || _set(row['is_bundle']);
      _more = _code.text.isNotEmpty || _purchase.text.isNotEmpty || _hsn.text.isNotEmpty || _description.text.isNotEmpty || _store || _featured;
    } catch (_) {
      _missing = true;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Settings › Items & stock › Low-stock alert at: filled in until the user types their own.
  Future<void> _loadDefaults() async {
    try {
      final body = await widget.session.api.getJson('/api/settings/invoice-defaults');
      final d = body['defaults'];
      final low = d is Map ? d['lowStockAlert'] : null;
      if (mounted && low is num && _min.text.isEmpty) setState(() => _min.text = low == low.roundToDouble() ? '${low.toInt()}' : '$low');
    } catch (_) {}
  }

  @override
  void dispose() {
    for (final c in [_name, _code, _selling, _purchase, _tax, _hsn, _opening, _min, _description]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Name is required')));
      return;
    }
    setState(() => _saving = true);
    try {
      final fields = (
        name: _name.text,
        code: _code.text,
        itemType: _type,
        unit: _unit,
        sellingPrice: _selling.text,
        purchasePrice: _purchase.text,
        taxRate: _tax.text,
        hsn: _hsn.text,
        minStock: _min.text,
        description: _description.text,
        showInStore: _store,
        featuredInStore: _featured,
      );
      if (widget.editing) {
        final existing = _existing;
        if (existing == null) return;
        await widget.session.api.patchJson('/api/items/${widget.itemId}', itemUpdateBody(
          existing: existing,
          name: fields.name,
          code: fields.code,
          itemType: fields.itemType,
          unit: fields.unit,
          sellingPrice: fields.sellingPrice,
          purchasePrice: fields.purchasePrice,
          taxRate: fields.taxRate,
          hsn: fields.hsn,
          minStock: fields.minStock,
          description: fields.description,
          showInStore: fields.showInStore,
          featuredInStore: fields.featuredInStore,
        ));
      } else {
        await widget.session.api.postJson('/api/items', itemCreateBody(
          name: fields.name,
          code: fields.code,
          itemType: fields.itemType,
          unit: fields.unit,
          sellingPrice: fields.sellingPrice,
          purchasePrice: fields.purchasePrice,
          taxRate: fields.taxRate,
          hsn: fields.hsn,
          openingStock: _opening.text,
          minStock: fields.minStock,
          description: fields.description,
          showInStore: fields.showInStore,
          featuredInStore: fields.featuredInStore,
        ));
      }
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  bool _more = false;

  Widget _f(TextEditingController c, String label, {bool number = false, int lines = 1}) => TextField(
        controller: c,
        maxLines: lines,
        keyboardType: number ? const TextInputType.numberWithOptions(decimal: true) : null,
        style: AppText.body,
        cursorColor: AppColors.brand,
        decoration: InputDecoration(
          labelText: label,
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
    const units = [('PCS', 'PCS'), ('KG', 'KG'), ('LTR', 'LTR'), ('MTR', 'MTR'), ('BOX', 'BOX')];
    const rates = [('0', '0%'), ('5', '5%'), ('12', '12%'), ('18', '18%'), ('28', '28%')];
    final unitOptions = units.any((u) => u.$1 == _unit) ? units : [(_unit, _unit), ...units];
    final taxValue = _tax.text.isEmpty ? '0' : _tax.text;
    final rateOptions = rates.any((r) => r.$1 == taxValue) ? rates : [(taxValue, '$taxValue%'), ...rates];
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
                Expanded(child: Text(widget.editing ? 'Edit item' : 'New item', style: AppText.heading.copyWith(fontSize: 18))),
              ]),
            ),
            Expanded(
              child: _loading
                  ? const KSpinner()
                  : _missing
                      ? KEmptyState(icon: LucideIcons.package, title: 'Item not found', action: KButton.secondary(label: 'Close', expand: false, onPressed: () => Navigator.pop(context)))
                      : ListView(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
                children: [
                  if (_complex)
                    Padding(
                      padding: const EdgeInsets.only(bottom: AppSpace.md),
                      child: Text('Variants and the bundle list stay as they are. Change quantity on hand with Adjust stock.', style: AppText.body.copyWith(color: AppColors.ink3)),
                    ),
                  KSegmented<String>(
                    value: _type,
                    options: const [('goods', 'Goods'), ('service', 'Service')],
                    onChanged: (v) => setState(() => _type = v),
                  ),
                  const SizedBox(height: AppSpace.md),
                  KCard(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _f(_name, 'Name *'),
                        const SizedBox(height: AppSpace.md),
                        _f(_selling, 'Selling price', number: true),
                        const SizedBox(height: AppSpace.md),
                        Text('GST rate', style: AppText.label),
                        const SizedBox(height: AppSpace.sm),
                        KChipBar<String>(
                          value: taxValue,
                          padding: EdgeInsets.zero,
                          options: rateOptions,
                          onChanged: (v) => setState(() => _tax.text = v),
                        ),
                        const SizedBox(height: AppSpace.md),
                        Text('Unit', style: AppText.label),
                        const SizedBox(height: AppSpace.sm),
                        KChipBar<String>(value: _unit, padding: EdgeInsets.zero, options: unitOptions, onChanged: (v) => setState(() => _unit = v)),
                        if (_type == 'goods' && !widget.editing) ...[
                          const SizedBox(height: AppSpace.md),
                          Row(children: [
                            Expanded(child: _f(_opening, 'Opening stock', number: true)),
                            const SizedBox(width: AppSpace.md),
                            Expanded(child: _f(_min, 'Low stock alert', number: true)),
                          ]),
                        ],
                        if (_type == 'goods' && widget.editing) ...[
                          const SizedBox(height: AppSpace.md),
                          _f(_min, 'Low stock alert', number: true),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpace.md),
                  KCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        KListRow(
                          onTap: () => setState(() => _more = !_more),
                          title: 'More details',
                          subtitle: 'Code, purchase price, HSN, description, online store',
                          trailing: Icon(_more ? LucideIcons.chevronUp : LucideIcons.chevronDown, size: 18, color: AppColors.ink3),
                        ),
                        if (_more)
                          Padding(
                            padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                _f(_code, 'Code'),
                                const SizedBox(height: AppSpace.md),
                                _f(_purchase, 'Purchase price', number: true),
                                const SizedBox(height: AppSpace.md),
                                _f(_hsn, 'HSN/SAC'),
                                const SizedBox(height: AppSpace.md),
                                _f(_description, 'Description', lines: 3),
                                SwitchListTile.adaptive(
                                  contentPadding: EdgeInsets.zero,
                                  activeTrackColor: AppColors.brand,
                                  title: Text('Show in online store', style: AppText.body),
                                  value: _store,
                                  onChanged: (v) => setState(() => _store = v),
                                ),
                                SwitchListTile.adaptive(
                                  contentPadding: EdgeInsets.zero,
                                  activeTrackColor: AppColors.brand,
                                  title: Text('Featured in store', style: AppText.body),
                                  value: _featured,
                                  onChanged: (v) => setState(() => _featured = v),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            KBottomBar(children: [
              Expanded(child: KButton(label: widget.editing ? 'Save changes' : 'Save item', icon: LucideIcons.check, loading: _saving, onPressed: _loading || _missing ? null : _save)),
            ]),
          ],
        ),
      ),
    );
  }
}
