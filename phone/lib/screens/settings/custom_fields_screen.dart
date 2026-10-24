import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'settings_kit.dart';

const _fieldTypes = [('text', 'Text'), ('number', 'Number'), ('date', 'Date'), ('dropdown', 'Dropdown')];

/// Settings › Custom fields: extra details on items and invoices.
class CustomFieldsScreen extends StatefulWidget {
  const CustomFieldsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<CustomFieldsScreen> createState() => _CustomFieldsScreenState();
}

class _CustomFieldsScreenState extends State<CustomFieldsScreen> {
  List<Map<String, dynamic>> _fields = const [];
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
      final body = await _api.getJson('/api/custom-fields');
      if (!mounted) return;
      setState(() {
        _fields = jsonList(body['definitions']);
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  List<Map<String, dynamic>> _of(String entity) =>
      _fields.where((f) => f['entity_type'] == entity).toList();

  String _typeLabel(String type) => _fieldTypes.firstWhere((t) => t.$1 == type, orElse: () => (type, type)).$2;

  Future<void> _add(String entity, String title) async {
    final label = TextEditingController();
    final options = TextEditingController();
    var type = 'text';
    var required = false;
    final ok = await showKSheet<bool>(
      context,
      title: 'Add $title',
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(controller: label, textCapitalization: TextCapitalization.sentences, decoration: const InputDecoration(labelText: 'Name')),
              const SizedBox(height: 12),
              Text('Type', style: AppText.caption),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final t in _fieldTypes)
                    ChoiceChip(
                      label: Text(t.$2),
                      selected: type == t.$1,
                      onSelected: (_) => set(() => type = t.$1),
                    ),
                ],
              ),
              if (type == 'dropdown') ...[
                const SizedBox(height: 12),
                TextField(controller: options, decoration: const InputDecoration(labelText: 'Choices', hintText: 'Small, Medium, Large')),
              ],
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Required'),
                value: required,
                activeTrackColor: AppColors.brand,
                onChanged: (v) => set(() => required = v),
              ),
              const SizedBox(height: 8),
              KButton(label: 'Add field', onPressed: () => Navigator.pop(ctx, true)),
            ],
          ),
        ),
      ),
    );
    if (ok != true || !mounted) return;
    final name = label.text.trim();
    if (name.isEmpty) return;
    try {
      await _api.postJson('/api/custom-fields', {
        'entity_type': entity,
        'label': name,
        'field_type': type,
        'options': type == 'dropdown' ? options.text.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList() : <String>[],
        'is_required': required,
      });
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$name added')));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _remove(Map<String, dynamic> field) async {
    final name = field['label']?.toString() ?? 'this field';
    final ok = await showKSheet<bool>(
      context,
      title: 'Remove $name?',
      builder: (ctx) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Values already saved stay in your data. The field stops showing on new bills and items.', style: AppText.body),
            const SizedBox(height: 16),
            KButton(label: 'Remove field', onPressed: () => Navigator.pop(ctx, true)),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await _api.deleteJson('/api/custom-fields/${field['id']}');
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$name removed')));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Widget _section(String entity, String title, String why) {
    final rows = _of(entity);
    return SettingsSection(title: title, why: why, children: [
      for (final f in rows)
        ItemSetting(
          title: f['label']?.toString() ?? 'Field',
          subtitle: [
            _typeLabel(f['field_type']?.toString() ?? 'text'),
            if (f['is_required'] == true) 'Required',
            if (f['field_type'] == 'dropdown' && f['options'] is List) (f['options'] as List).join(', '),
          ].where((s) => s.isNotEmpty).join(' · '),
          trailing: Icon(LucideIcons.trash2, size: 18, color: AppColors.ink3),
          onTap: () => _remove(f),
        ),
      if (rows.isEmpty) const SettingRow(label: 'None yet', help: 'Add one when a bill or item needs a detail Khatario does not already ask for.'),
      AddSetting(label: 'Add ${title.toLowerCase()}', onTap: () => _add(entity, title.toLowerCase())),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Custom fields',
      blurb: 'Extra details on items and invoices. Turn them on for a template under Invoice templates.',
      icon: LucideIcons.slidersHorizontal,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        _section('item', 'Item fields', 'Filled when you add or edit an item. They can print on the line when the template shows them.'),
        _section('invoice', 'Invoice fields', 'Filled on the bill, under the invoice number and dates, when the template shows them.'),
      ],
    );
  }
}
