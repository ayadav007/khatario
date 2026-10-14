import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'item_form_logic.dart';

/// Plain create form for `app/(app)/items/new/page.tsx` (goods and services, no variants).
class ItemFormScreen extends StatefulWidget {
  const ItemFormScreen({super.key, required this.session});

  final AppSession session;

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

  @override
  void initState() {
    super.initState();
    _loadDefaults();
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
      await widget.session.api.postJson('/api/items', itemCreateBody(
        name: _name.text,
        code: _code.text,
        itemType: _type,
        unit: _unit,
        sellingPrice: _selling.text,
        purchasePrice: _purchase.text,
        taxRate: _tax.text,
        hsn: _hsn.text,
        openingStock: _opening.text,
        minStock: _min.text,
        description: _description.text,
        showInStore: _store,
        featuredInStore: _featured,
      ));
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
                Expanded(child: Text('New item', style: AppText.heading.copyWith(fontSize: 18))),
              ]),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
                children: [
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
                          value: _tax.text.isEmpty ? '0' : _tax.text,
                          padding: EdgeInsets.zero,
                          options: rates,
                          onChanged: (v) => setState(() => _tax.text = v),
                        ),
                        const SizedBox(height: AppSpace.md),
                        Text('Unit', style: AppText.label),
                        const SizedBox(height: AppSpace.sm),
                        KChipBar<String>(value: _unit, padding: EdgeInsets.zero, options: units, onChanged: (v) => setState(() => _unit = v)),
                        if (_type == 'goods') ...[
                          const SizedBox(height: AppSpace.md),
                          Row(children: [
                            Expanded(child: _f(_opening, 'Opening stock', number: true)),
                            const SizedBox(width: AppSpace.md),
                            Expanded(child: _f(_min, 'Low stock alert', number: true)),
                          ]),
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
              Expanded(child: KButton(label: 'Save item', icon: LucideIcons.check, loading: _saving, onPressed: _save)),
            ]),
          ],
        ),
      ),
    );
  }
}
