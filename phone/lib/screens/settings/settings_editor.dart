import 'package:flutter/material.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';

const _hiddenKeys = {
  'id',
  'business_id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'user_id',
  'deleted_at',
};

/// Editable copy of a settings object the website loads and saves.
class SettingsDraft {
  SettingsDraft(this.wrapKey, this.values);

  /// When set, PATCH sends `{wrapKey: values}`. Otherwise the fields are the body.
  final String? wrapKey;
  final Map<String, dynamic> values;

  static SettingsDraft? fromBody(Map<String, dynamic> body) {
    const wrapped = ['policy', 'config', 'settings', 'template'];
    for (final key in wrapped) {
      final value = body[key];
      if (value is Map) {
        return SettingsDraft(key == 'policy' ? key : null, Map<String, dynamic>.from(value));
      }
    }
    final hasRows = body.values.any((value) => value is List && value.whereType<Map>().isNotEmpty);
    if (hasRows || body.isEmpty) return null;
    return SettingsDraft(null, Map<String, dynamic>.from(body)..remove('error'));
  }
}

class SettingsEditor extends StatefulWidget {
  const SettingsEditor({super.key, required this.session, required this.path, required this.draft});

  final AppSession session;
  final String path;
  final SettingsDraft draft;

  @override
  State<SettingsEditor> createState() => _SettingsEditorState();
}

class _SettingsEditorState extends State<SettingsEditor> {
  late Map<String, dynamic> _values;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _values = _clone(widget.draft.values);
  }

  Map<String, dynamic> _clone(Map<String, dynamic> source) => source.map((key, value) {
        if (value is Map) return MapEntry(key, _clone(Map<String, dynamic>.from(value)));
        if (value is List) return MapEntry(key, [...value]);
        return MapEntry(key, value);
      });

  Future<void> _save() async {
    final path = widget.path.split('?').first;
    final body = widget.draft.wrapKey == null ? _values : {widget.draft.wrapKey!: _values};
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final saved = path.endsWith('/email')
          ? await widget.session.api.putJson(path, Map<String, dynamic>.from(body))
          : await widget.session.api.patchJson(path, Map<String, dynamic>.from(body));
      final next = SettingsDraft.fromBody(saved);
      if (next != null && mounted) setState(() => _values = _clone(next.values));
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Saved')));
      }
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = e.message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
      children: [
        ..._fields(_values),
        if (_error != null) ...[
          const SizedBox(height: AppSpace.md),
          Text(_error!, style: AppText.body.copyWith(color: AppColors.negative)),
        ],
        const SizedBox(height: AppSpace.lg),
        KButton(label: _saving ? 'Saving…' : 'Save', onPressed: _saving ? null : _save),
      ],
    );
  }

  List<Widget> _fields(Map<String, dynamic> values, {String prefix = ''}) {
    final widgets = <Widget>[];
    for (final entry in values.entries) {
      if (_hiddenKeys.contains(entry.key)) continue;
      final label = _label(prefix.isEmpty ? entry.key : '$prefix.${entry.key}');
      final value = entry.value;
      if (value is Map) {
        widgets.add(Padding(
          padding: const EdgeInsets.only(top: 16, bottom: 8),
          child: Text(label, style: AppText.heading),
        ));
        widgets.addAll(_fields(Map<String, dynamic>.from(value), prefix: entry.key));
        continue;
      }
      widgets.add(Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: value is bool
            ? SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                activeTrackColor: AppColors.brand,
                title: Text(label, style: AppText.body),
                value: value,
                onChanged: _saving ? null : (next) => setState(() => values[entry.key] = next),
              )
            : TextFormField(
                initialValue: value is List ? value.join(', ') : value?.toString() ?? '',
                enabled: !_saving,
                keyboardType: value is num ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.text,
                style: AppText.body,
                decoration: InputDecoration(labelText: label),
                onChanged: (text) {
                  if (value is num) {
                    values[entry.key] = num.tryParse(text) ?? value;
                  } else if (value is List) {
                    values[entry.key] = text.split(',').map((part) => part.trim()).where((part) => part.isNotEmpty).toList();
                  } else {
                    values[entry.key] = text;
                  }
                },
              ),
      ));
    }
    return widgets;
  }

  String _label(String key) {
    final raw = key.split('.').last.replaceAll('_', ' ');
    if (raw.isEmpty) return key;
    return raw[0].toUpperCase() + raw.substring(1);
  }
}
