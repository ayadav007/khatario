import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../ui/kit.dart';
import 'settings_kit.dart';

enum FormKind { text, number, toggle, choice }

enum SaveVerb { patch, put, post }

class FormFieldSpec {
  const FormFieldSpec(this.key, this.label, {this.kind = FormKind.text, this.options = const [], this.help, this.hint});

  final String key;
  final String label;
  final FormKind kind;
  final List<(String, String)> options;
  final String? help;
  final String? hint;
}

/// A settings form backed by one GET and one save call.
class MapFormScreen extends StatefulWidget {
  const MapFormScreen({
    super.key,
    required this.session,
    required this.title,
    required this.blurb,
    required this.loadPath,
    required this.savePath,
    required this.fields,
    this.icon = LucideIcons.settings,
    this.readKey,
    this.verb = SaveVerb.patch,
    this.wrapKey,
    this.merge = false,
  });

  final AppSession session;
  final String title;
  final String blurb;
  final IconData icon;
  final String loadPath;
  final String savePath;
  final String? readKey;
  final SaveVerb verb;
  /// When set, the body is `{wrapKey: map}` instead of the fields themselves.
  final String? wrapKey;
  /// Keep keys from the loaded object that this form does not edit.
  final bool merge;
  final List<FormFieldSpec> fields;

  @override
  State<MapFormScreen> createState() => _MapFormScreenState();
}

class _MapFormScreenState extends State<MapFormScreen> {
  final _texts = <String, TextEditingController>{};
  final _flags = <String, bool>{};
  final _choices = <String, String>{};
  Map<String, dynamic> _loaded = const {};
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    for (final f in widget.fields) {
      if (f.kind == FormKind.text || f.kind == FormKind.number) {
        _texts[f.key] = TextEditingController();
      }
    }
    _load();
  }

  @override
  void dispose() {
    for (final c in _texts.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson(widget.loadPath);
      final raw = widget.readKey == null ? body : body[widget.readKey];
      final map = jsonMap(raw);
      if (!mounted) return;
      setState(() {
        _loaded = map;
        for (final f in widget.fields) {
          final v = map[f.key];
          switch (f.kind) {
            case FormKind.toggle:
              _flags[f.key] = v == true;
            case FormKind.choice:
              _choices[f.key] = v?.toString() ?? (f.options.isEmpty ? '' : f.options.first.$1);
            case FormKind.text:
            case FormKind.number:
              _texts[f.key]!.text = v == null ? '' : v.toString();
          }
        }
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Map<String, dynamic> _payload() {
    final fields = <String, dynamic>{};
    for (final f in widget.fields) {
      switch (f.kind) {
        case FormKind.toggle:
          fields[f.key] = _flags[f.key] == true;
        case FormKind.choice:
          fields[f.key] = _choices[f.key];
        case FormKind.number:
          final raw = _texts[f.key]!.text.trim();
          fields[f.key] = raw.isEmpty ? null : num.tryParse(raw);
        case FormKind.text:
          final text = _texts[f.key]!.text.trim();
          if (f.key == 'smtp_password' && text.isEmpty) continue;
          fields[f.key] = text;
      }
    }
    final map = widget.merge ? {..._loaded, ...fields} : fields;
    return widget.wrapKey == null ? map : {widget.wrapKey!: map};
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final body = _payload();
      final api = widget.session.api;
      switch (widget.verb) {
        case SaveVerb.patch:
          await api.patchJson(widget.savePath, body);
        case SaveVerb.put:
          await api.putJson(widget.savePath, body);
        case SaveVerb.post:
          await api.postJson(widget.savePath, body);
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Saved')));
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
      title: widget.title,
      blurb: widget.blurb,
      icon: widget.icon,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: widget.title, children: [
          for (final f in widget.fields)
            switch (f.kind) {
              FormKind.toggle => ToggleSetting(
                  label: f.label,
                  help: f.help,
                  value: _flags[f.key] == true,
                  onChanged: (v) => setState(() => _flags[f.key] = v),
                ),
              FormKind.choice => ChoiceSetting<String>(
                  label: f.label,
                  help: f.help,
                  value: _choices[f.key] ?? '',
                  options: f.options,
                  onChanged: (v) => setState(() => _choices[f.key] = v),
                ),
              _ => TextSetting(
                  label: f.label,
                  help: f.help,
                  hint: f.hint,
                  controller: _texts[f.key]!,
                  keyboardType: f.kind == FormKind.number ? TextInputType.number : null,
                ),
            },
        ]),
        const SizedBox(height: 8),
        KButton(label: _saving ? 'Saving…' : 'Save', onPressed: _saving ? null : _save),
      ],
    );
  }
}

/// A list from `{listKey: [...]}` with an optional add action.
class JsonListScreen extends StatefulWidget {
  const JsonListScreen({
    super.key,
    required this.session,
    required this.title,
    required this.blurb,
    required this.path,
    required this.listKey,
    required this.titleOf,
    this.subtitleOf,
    this.onAdd,
    this.icon = LucideIcons.list,
  });

  final AppSession session;
  final String title;
  final String blurb;
  final IconData icon;
  final String path;
  final String listKey;
  final String Function(Map<String, dynamic> row) titleOf;
  final String Function(Map<String, dynamic> row)? subtitleOf;
  final Future<void> Function(BuildContext context, AppSession session, VoidCallback reload)? onAdd;

  @override
  State<JsonListScreen> createState() => _JsonListScreenState();
}

class _JsonListScreenState extends State<JsonListScreen> {
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson(widget.path);
      if (!mounted) return;
      setState(() {
        _rows = jsonList(body[widget.listKey]);
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: widget.title,
      blurb: widget.blurb,
      icon: widget.icon,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      children: [
        SettingsSection(title: widget.title, children: [
          for (final row in _rows)
            ItemSetting(title: widget.titleOf(row), subtitle: widget.subtitleOf?.call(row)),
          if (_rows.isEmpty) const SettingRow(label: 'Nothing here yet'),
          if (widget.onAdd != null) AddSetting(label: 'Add', onTap: () => widget.onAdd!(context, widget.session, _load)),
        ]),
      ],
    );
  }
}

Future<bool> askTextSheet(
  BuildContext context, {
  required String title,
  required List<(String, TextEditingController, String?)> fields,
  String saveLabel = 'Save',
}) async {
  final ok = await showKSheet<bool>(
    context,
    title: title,
    builder: (ctx) => Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (label, controller, hint) in fields) ...[
            TextField(controller: controller, decoration: InputDecoration(labelText: label, hintText: hint)),
            const SizedBox(height: 12),
          ],
          KButton(label: saveLabel, onPressed: () => Navigator.pop(ctx, true)),
        ],
      ),
    ),
  );
  return ok == true;
}
