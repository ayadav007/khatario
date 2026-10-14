import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'settings_kit.dart';

const _languages = [
  ('en', 'English'), ('hi', 'Hindi'), ('hinglish', 'Hinglish'), ('mr', 'Marathi'), ('gu', 'Gujarati'),
  ('ta', 'Tamil'), ('te', 'Telugu'), ('kn', 'Kannada'), ('ml', 'Malayalam'), ('bn', 'Bengali'),
  ('pa', 'Punjabi'), ('or', 'Odia'), ('ur', 'Urdu'),
];

/// Number series the phone can edit; each has its own counter on the server.
const _series = [('tax_invoice', 'Tax invoice', 'INV-'), ('bill_of_supply', 'Bill of supply', 'BOS-'), ('proforma_invoice', 'Proforma invoice', 'PI-')];

/// Settings › Invoices & documents: defaults for new bills, bill screen, numbering, templates,
/// print language.
class InvoiceSettingsScreen extends StatefulWidget {
  const InvoiceSettingsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<InvoiceSettingsScreen> createState() => _InvoiceSettingsScreenState();
}

class _InvoiceSettingsScreenState extends State<InvoiceSettingsScreen> {
  final _f = DirtyFields();
  Map<String, dynamic> _d = const {};
  bool _variants = false;
  String _language = 'en';
  bool _canChangeLanguage = false;
  Map<String, dynamic>? _numbering;
  bool _loading = true;
  bool _saving = false;
  String? _error;

  KhatarioApi get _api => widget.session.api;

  @override
  void initState() {
    super.initState();
    for (final k in ['notes', 'terms']) {
      _f.field(k).addListener(() => setState(() {}));
    }
    _load();
  }

  @override
  void dispose() {
    _f.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        _api.getJson('/api/settings/invoice-defaults'),
        _api.getJson('/api/settings/product-variants').catchError((_) => <String, dynamic>{}),
        _api.getJson('/api/settings/document-language').catchError((_) => <String, dynamic>{}),
        _api.getJson('/api/settings/number-series').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      final d = jsonMap(results[0]['defaults']);
      _f.reset({'notes': d['notes']?.toString() ?? '', 'terms': d['terms']?.toString() ?? ''});
      setState(() {
        _d = d;
        _variants = results[1]['product_variants_enabled'] == true;
        _language = results[2]['document_language']?.toString() ?? 'en';
        _canChangeLanguage = results[2]['can_change'] == true;
        _numbering = results[3];
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    }
  }

  Future<void> _putDefaults(Map<String, dynamic> body) => _api.putJson('/api/settings/invoice-defaults', {'defaults': body});

  void _setDefault(String key, dynamic value, String message) {
    final before = _d[key];
    setState(() => _d = {..._d, key: value});
    saveInstantly(
      context,
      message: message,
      save: () => _putDefaults({key: value}),
      revert: () => setState(() => _d = {..._d, key: before}),
      undo: () => _putDefaults({key: before}),
    );
  }

  Future<void> _saveText() async {
    final changed = _f.changed;
    setState(() => _saving = true);
    try {
      await _putDefaults(changed);
      _f.reset({'notes': _f.text('notes'), 'terms': _f.text('terms')});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Saved')));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Map<String, dynamic>? get _branch {
    final branches = jsonList(_numbering?['branches']);
    if (branches.isEmpty) return null;
    return branches.firstWhere((b) => b['is_default'] == true, orElse: () => branches.first);
  }

  String _prefix(String type, String fallback) {
    final b = _branch;
    final map = jsonMap(jsonMap(_numbering?['branchPrefixes'])[b?['id']]);
    final p = map[type]?.toString();
    if (p != null && p.isNotEmpty) return p;
    if (type == 'tax_invoice' && (b?['invoice_prefix']?.toString() ?? '').isNotEmpty) return b!['invoice_prefix'].toString();
    return fallback;
  }

  int _next(String type) => toNum(jsonMap(_branch?['next_numbers'])[type]).toInt().clamp(1, 1 << 31);

  Future<void> _editSeries(String type, String label, String fallback) async {
    final prefix = TextEditingController(text: _prefix(type, fallback));
    final start = TextEditingController(text: '${_next(type)}');
    final ok = await showKSheet<bool>(
      context,
      title: label,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(controller: prefix, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'Prefix')),
            const SizedBox(height: 12),
            TextField(controller: start, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Next number')),
            const SizedBox(height: 8),
            Text('Applies to every branch. Numbers already used are never given out again.', style: AppText.caption),
            const SizedBox(height: 16),
            KButton(label: 'Save', onPressed: () => Navigator.pop(ctx, true)),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await _api.putJson('/api/settings/number-series', {
        'document_type': type,
        'prefix': prefix.text.trim(),
        'starting_number': int.tryParse(start.text.trim()) ?? _next(type),
      });
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$label numbering saved')));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final due = _d['dueDays'] == null ? -1 : toNum(_d['dueDays']).toInt();
    return SettingsPage(
      title: 'Invoices & documents',
      blurb: 'Defaults for every new bill, numbering, templates and print language.',
      icon: LucideIcons.fileText,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      dirtyCount: _f.count,
      saving: _saving,
      onSave: _saveText,
      onDiscard: () => setState(_f.discard),
      children: [
        SettingsSection(title: 'Invoice defaults', why: 'Filled in on every new bill. You can still change them on the bill.', children: [
          ChoiceSetting<int>(
            label: 'Due date',
            value: due,
            options: const [(-1, 'No due date'), (0, 'On receipt'), (7, '7 days'), (15, '15 days'), (30, '30 days'), (45, '45 days'), (60, '60 days')],
            onChanged: (v) => _setDefault('dueDays', v < 0 ? null : v, v < 0 ? 'No due date by default' : 'Due date: ${v == 0 ? 'on receipt' : '$v days'}'),
          ),
          ToggleSetting(
            label: 'Prices include GST',
            help: 'Rates you type already contain tax.',
            value: _d['pricesIncludeGst'] == true,
            onChanged: (v) => _setDefault('pricesIncludeGst', v, v ? 'Prices include GST' : 'Prices exclude GST'),
          ),
          ToggleSetting(
            label: 'Round off the total',
            help: 'To the nearest rupee.',
            value: _d['roundOff'] == true,
            onChanged: (v) => _setDefault('roundOff', v, v ? 'Round off on' : 'Round off off'),
          ),
          ChoiceSetting<int>(
            label: 'Decimals in quantity',
            help: 'Items sold by weight or length need 2 or 3.',
            value: _d['quantityDecimals'] == null ? 2 : toNum(_d['quantityDecimals']).toInt(),
            options: const [(0, 'None (1, 2, 3)'), (1, '1 (1.5)'), (2, '2 (1.25)'), (3, '3 (1.125)')],
            onChanged: (v) => _setDefault('quantityDecimals', v, 'Quantity decimals: $v'),
          ),
          TextSetting(label: 'Note to customer', controller: _f.field('notes'), multiline: true, hint: 'Thank you for your business!'),
          TextSetting(label: 'Terms & conditions', controller: _f.field('terms'), multiline: true, hint: 'Goods once sold…'),
        ]),
        SettingsSection(title: 'Bill screen', why: 'What the bill and item screens offer your staff.', children: [
          ToggleSetting(
            label: 'Product variants',
            help: 'Sizes, colours and other options on one item.',
            value: _variants,
            onChanged: (v) {
              setState(() => _variants = v);
              saveInstantly(
                context,
                message: v ? 'Variants on' : 'Variants off',
                save: () => _api.patchJson('/api/settings/product-variants', {'product_variants_enabled': v}),
                revert: () => setState(() => _variants = !v),
                undo: () => _api.patchJson('/api/settings/product-variants', {'product_variants_enabled': !v}),
              );
            },
          ),
        ]),
        SettingsSection(title: 'Number series', why: 'Prefix and next number for each document.', children: [
          for (final (type, label, fallback) in _series)
            NavSetting(
              label: label,
              value: '${_prefix(type, fallback)}${_next(type).toString().padLeft(5, '0')} next',
              onTap: () => _editSeries(type, label, fallback),
            ),
          const WebSetting(label: 'Credit notes, challans, orders', value: 'Other documents and per-branch series', href: '/settings/number-series'),
        ]),
        SettingsSection(title: 'Templates & printing', why: 'How each document looks on paper and as PDF.', children: [
          const WebSetting(label: 'Invoice templates', value: 'Choose and customise per document', href: '/settings/templates'),
          _canChangeLanguage
              ? ChoiceSetting<String>(
                  label: 'Print language',
                  help: 'Headings and words on printed documents. Item names stay as typed.',
                  value: _language,
                  options: _languages,
                  onChanged: (v) {
                    final before = _language;
                    setState(() => _language = v);
                    saveInstantly(
                      context,
                      message: 'Print language updated',
                      save: () => _api.patchJson('/api/settings/document-language', {'document_language': v}),
                      revert: () => setState(() => _language = before),
                      undo: () => _api.patchJson('/api/settings/document-language', {'document_language': before}),
                    );
                  },
                )
              : const LockedSetting(
                  label: 'Print language',
                  value: 'English',
                  help: 'Print bills in Hindi, Marathi, Gujarati and 10 more languages.',
                  plan: 'Business plan',
                ),
        ]),
        const SettingsSection(title: 'Custom fields', why: 'Extra details you want on items, bills and parties.', children: [
          WebSetting(label: 'Item and invoice fields', href: '/settings/custom-fields'),
        ]),
      ],
    );
  }
}
