import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'plan_billing_screen.dart';
import 'settings_kit.dart';

const _docTypes = [
  ('tax_invoice', 'Tax invoice'),
  ('proforma_invoice', 'Proforma invoice'),
  ('bill_of_supply', 'Bill of supply'),
  ('credit_note', 'Credit note'),
  ('debit_note', 'Debit note'),
  ('delivery_challan', 'Delivery challan'),
  ('sales_order', 'Sales order'),
  ('purchase_order', 'Purchase order'),
  ('payment_receipt', 'Payment receipt'),
];

/// Visibility switches the phone can edit. Labels match the website customise drawer.
const _toggleGroups = <(String, List<(String, String)>)>[
  ('Your business', [
    ('show_logo', 'Logo'),
    ('show_business_name', 'Business name'),
    ('show_business_address', 'Address'),
    ('show_business_phone', 'Phone'),
    ('show_business_email', 'Email'),
    ('show_business_gstin', 'GSTIN'),
    ('show_business_pan', 'PAN'),
  ]),
  ('Customer', [
    ('show_bill_to', 'Bill to'),
    ('show_ship_to', 'Ship to'),
    ('show_customer_name', 'Name'),
    ('show_customer_address', 'Address'),
    ('show_customer_phone', 'Phone'),
    ('show_customer_gstin', 'GSTIN'),
  ]),
  ('Document', [
    ('show_invoice_number', 'Number'),
    ('show_invoice_date', 'Date'),
    ('show_due_date', 'Due date'),
    ('show_place_of_supply', 'Place of supply'),
    ('show_po_number', 'PO number'),
  ]),
  ('Line items', [
    ('show_item_name', 'Item name'),
    ('show_hsn', 'HSN'),
    ('show_quantity', 'Quantity'),
    ('show_unit', 'Unit'),
    ('show_rate', 'Rate'),
    ('show_tax_rate', 'Tax rate'),
    ('show_line_total', 'Line total'),
  ]),
  ('Totals', [
    ('show_subtotal', 'Subtotal'),
    ('show_tax_total', 'Tax total'),
    ('show_round_off', 'Round off'),
    ('show_grand_total', 'Grand total'),
    ('show_amount_in_words', 'Amount in words'),
    ('show_balance_amount', 'Balance'),
  ]),
  ('Footer', [
    ('show_bank_details', 'Bank details'),
    ('show_signature', 'Signature'),
    ('show_qr_code', 'UPI QR'),
    ('show_terms', 'Terms'),
    ('show_notes', 'Note to customer'),
  ]),
];

const _fonts = [
  ('Inter', 'Inter'),
  ('Arial', 'Arial'),
  ('Georgia', 'Georgia'),
  ('Times New Roman', 'Times New Roman'),
  ('Courier New', 'Courier New'),
];

class _Template {
  _Template(this.id, this.name, this.description, this.documentTypes, this.defaults);
  final String id;
  final String name;
  final String description;
  final List<String> documentTypes;
  final Map<String, dynamic> defaults;
}

/// Settings › Invoice templates: which layout each document uses, and what it prints.
class TemplateSettingsScreen extends StatefulWidget {
  const TemplateSettingsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<TemplateSettingsScreen> createState() => _TemplateSettingsScreenState();
}

class _TemplateSettingsScreenState extends State<TemplateSettingsScreen> {
  List<_Template> _templates = const [];
  Map<String, String> _active = const {};
  Map<String, Map<String, dynamic>> _settings = const {};
  bool _canCustomize = true;
  bool _loading = true;
  String? _error;

  KhatarioApi get _api => widget.session.api;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        _api.getJson('/api/template-catalog'),
        _api.getJson('/api/template-assignments'),
        _api.getJson('/api/features/enabled').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      final templates = <_Template>[
        for (final row in jsonList(results[0]['templates']))
          _Template(
            row['id']?.toString() ?? '',
            row['name']?.toString() ?? 'Template',
            row['description']?.toString() ?? '',
            (row['documentTypes'] as List?)?.map((e) => e.toString()).toList() ?? const [],
            jsonMap(row['defaults']),
          ),
      ];
      final active = <String, String>{};
      final settings = <String, Map<String, dynamic>>{};
      for (final row in jsonList(results[1]['assignments'])) {
        final type = row['document_type']?.toString() ?? '';
        active[type] = row['template_id']?.toString() ?? '';
        settings[type] = jsonMap(row['settings']);
      }
      final enabled = results[2]['enabledIds'];
      setState(() {
        _templates = templates;
        _active = active;
        _settings = settings;
        _canCustomize = enabled is! List || enabled.map((e) => e.toString()).contains('settings_template_customization');
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  String _activeName(String type) {
    final id = _active[type];
    if (id == null || id.isEmpty) return 'Not chosen';
    return _templates.where((t) => t.id == id).map((t) => t.name).firstOrNull ?? id;
  }

  Future<void> _openType(String type, String label) async {
    final list = _templates.where((t) => t.documentTypes.contains(type)).toList();
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => _TemplateListScreen(
        session: widget.session,
        documentType: type,
        title: label,
        templates: list,
        activeId: _active[type],
        savedSettings: _settings[type] ?? const {},
        canCustomize: _canCustomize,
      ),
    ));
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Invoice templates',
      blurb: 'The layout used when you print or share each document.',
      icon: LucideIcons.fileText,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: 'Documents', why: 'Each document can use a different layout.', children: [
          for (final (type, label) in _docTypes)
            NavSetting(label: label, value: _activeName(type), onTap: () => _openType(type, label)),
        ]),
      ],
    );
  }
}

class _TemplateListScreen extends StatelessWidget {
  const _TemplateListScreen({
    required this.session,
    required this.documentType,
    required this.title,
    required this.templates,
    required this.activeId,
    required this.savedSettings,
    required this.canCustomize,
  });

  final AppSession session;
  final String documentType;
  final String title;
  final List<_Template> templates;
  final String? activeId;
  final Map<String, dynamic> savedSettings;
  final bool canCustomize;

  Future<void> _locked(BuildContext context) async {
    await showKSheet<void>(
      context,
      title: 'Invoice templates',
      builder: (ctx) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Choosing and customising templates is on the Growth plan.', style: AppText.body),
            const SizedBox(height: 16),
            KButton(
              label: 'See plans',
              onPressed: () {
                Navigator.pop(ctx);
                Navigator.of(context).push(MaterialPageRoute(builder: (_) => PlanBillingScreen(session: session)));
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _activate(BuildContext context, _Template template) async {
    if (!canCustomize) {
      await _locked(context);
      return;
    }
    try {
      await session.api.postJson('/api/template-assignments', {
        'template_id': template.id,
        'document_type': documentType,
      });
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${template.name} is now used for $title')));
        Navigator.pop(context);
      }
    } on ApiException catch (e) {
      if (!context.mounted) return;
      if (e.code == 'FEATURE_NOT_IN_PLAN' || e.status == 403) {
        await _locked(context);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: title,
      blurb: 'Tap a layout to use it. Customise changes what that layout prints.',
      icon: LucideIcons.layoutTemplate,
      loading: false,
      children: [
        if (templates.isEmpty)
          const SettingsSection(title: 'Layouts', children: [
            SettingRow(label: 'No layouts for this document', help: 'This document prints with the standard layout.'),
          ])
        else
          SettingsSection(title: 'Layouts', why: activeId == null ? 'None selected yet.' : 'The one in use is marked.', children: [
            for (final t in templates)
              ItemSetting(
                title: t.name,
                subtitle: t.description,
                trailing: t.id == activeId
                    ? const KPill(label: 'In use', tone: KTone.positive)
                    : Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
                onTap: () => _activate(context, t),
              ),
          ]),
        if (templates.isNotEmpty)
          SettingsSection(title: 'Customise', why: 'Logo, columns, bank details and the colours on the printed page.', children: [
            NavSetting(
              label: 'What this document prints',
              value: canCustomize ? 'Fields, colours and font' : 'Growth plan',
              onTap: () {
                if (!canCustomize) {
                  _locked(context);
                  return;
                }
                final current = templates.where((t) => t.id == activeId).firstOrNull ?? templates.first;
                Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => _CustomizeScreen(
                    session: session,
                    documentType: documentType,
                    title: title,
                    template: current,
                    saved: savedSettings,
                  ),
                ));
              },
            ),
          ]),
      ],
    );
  }
}

class _CustomizeScreen extends StatefulWidget {
  const _CustomizeScreen({
    required this.session,
    required this.documentType,
    required this.title,
    required this.template,
    required this.saved,
  });

  final AppSession session;
  final String documentType;
  final String title;
  final _Template template;
  final Map<String, dynamic> saved;

  @override
  State<_CustomizeScreen> createState() => _CustomizeScreenState();
}

class _CustomizeScreenState extends State<_CustomizeScreen> {
  late Map<String, dynamic> _s;
  late final TextEditingController _color;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _s = {...widget.template.defaults, ...widget.saved};
    _color = TextEditingController(text: _s['primary_color']?.toString() ?? '#1e3a8a');
  }

  @override
  void dispose() {
    _color.dispose();
    super.dispose();
  }

  bool _on(String key) => _s[key] != false;

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await widget.session.api.putJson('/api/template-assignments', {
        'document_type': widget.documentType,
        'template_id': widget.template.id,
        'settings': {..._s, 'primary_color': _color.text.trim()},
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Template saved')));
        Navigator.pop(context);
      }
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: widget.template.name,
      blurb: 'Printed on every ${widget.title.toLowerCase()}.',
      icon: LucideIcons.paintbrush,
      loading: false,
      children: [
        for (final group in _toggleGroups)
          SettingsSection(title: group.$1, children: [
            for (final (key, label) in group.$2)
              ToggleSetting(
                label: label,
                value: _on(key),
                onChanged: (v) => setState(() => _s = {..._s, key: v}),
              ),
          ]),
        SettingsSection(title: 'Look', why: 'Colour and typeface on the printed page.', children: [
          TextSetting(label: 'Colour', controller: _color, hint: '#1e3a8a', mono: true),
          ChoiceSetting<String>(
            label: 'Font',
            value: _fonts.any((f) => f.$1 == _s['font_family']) ? _s['font_family'].toString() : 'Inter',
            options: _fonts,
            onChanged: (v) => setState(() => _s = {..._s, 'font_family': v}),
          ),
        ]),
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: KButton(label: _saving ? 'Saving…' : 'Save template', onPressed: _saving ? null : _save),
        ),
      ],
    );
  }
}
