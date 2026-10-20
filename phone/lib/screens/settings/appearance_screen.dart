import 'package:flutter/material.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';

/// Organization portal appearance. Same fields as the website settings page:
/// primary, accent, and font, saved with PATCH /api/settings/portal-theme.
class AppearanceEditor extends StatefulWidget {
  const AppearanceEditor({super.key, required this.session});

  final AppSession session;

  @override
  State<AppearanceEditor> createState() => _AppearanceEditorState();
}

class _AppearanceEditorState extends State<AppearanceEditor> {
  static const _primaryPresets = [
    ('Khatario green', '#032B23'),
    ('Blue', '#2563eb'),
    ('Indigo', '#4f46e5'),
    ('Violet', '#7c3aed'),
    ('Rose', '#e11d48'),
    ('Amber', '#d97706'),
  ];
  static const _accentPresets = [
    ('Khatario orange', '#F58220'),
    ('Blue', '#0369a1'),
    ('Slate', '#475569'),
    ('Emerald', '#047857'),
    ('Orange', '#c2410c'),
    ('Violet', '#6d28d9'),
  ];
  static const _fonts = [
    ('inter', 'Inter'),
    ('system', 'System UI'),
    ('dm_sans', 'DM Sans'),
    ('source_sans', 'Source Sans 3'),
  ];

  final _primary = TextEditingController();
  final _accent = TextEditingController();
  String _font = 'inter';
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _primary.dispose();
    _accent.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final body = await widget.session.api.getJson('/api/settings/portal-theme');
      _apply(body['portalTheme']);
      if (mounted) setState(() => _loading = false);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e.message;
        });
      }
    }
  }

  void _apply(Object? raw) {
    final theme = PortalTheme.fromJson(raw);
    _primary.text = theme.primaryHex;
    _accent.text = theme.accentHex;
    _font = theme.fontPreset;
    KhatarioColors.applyPortalTheme(raw is Map ? raw : {'primary_hex': theme.primaryHex, 'accent_hex': theme.accentHex, 'font_preset': theme.fontPreset});
  }

  Map<String, String>? _payload() {
    final primary = PortalTheme.parseHex(_primary.text);
    final accent = PortalTheme.parseHex(_accent.text);
    if (primary == null || accent == null) return null;
    return {'primary_hex': primary, 'accent_hex': accent, 'font_preset': _font};
  }

  Future<void> _save({bool reset = false}) async {
    if (!reset && _payload() == null) {
      setState(() => _error = 'Use a hex colour like #032B23 or #RGB.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final body = reset
          ? await widget.session.api.patchJson('/api/settings/portal-theme', {'reset': true})
          : await widget.session.api.patchJson('/api/settings/portal-theme', {'portal_theme': _payload()});
      _apply(body['portalTheme']);
      if (mounted) setState(() => _saving = false);
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
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    final primary = PortalTheme.parseHex(_primary.text);
    final accent = PortalTheme.parseHex(_accent.text);
    return ListView(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
      children: [
        Text('Primary drives navigation and main actions. Accent is used for secondary highlights.', style: AppText.body.copyWith(color: AppColors.ink2)),
        const SizedBox(height: AppSpace.md),
        _colorBlock('Primary color', 'Main brand: navigation and primary buttons.', _primary, primary, _primaryPresets),
        const SizedBox(height: AppSpace.md),
        _colorBlock('Accent color', 'Secondary brand: highlights and alternate buttons.', _accent, accent, _accentPresets),
        const SizedBox(height: AppSpace.md),
        Text('Font', style: AppText.label),
        const SizedBox(height: AppSpace.sm),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(AppRadius.md), border: Border.all(color: AppColors.hairline)),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              value: _font,
              isExpanded: true,
              items: [for (final font in _fonts) DropdownMenuItem(value: font.$1, child: Text(font.$2, style: AppText.body))],
              onChanged: _saving ? null : (value) { if (value != null) setState(() => _font = value); },
            ),
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: AppSpace.md),
          Text(_error!, style: AppText.body.copyWith(color: AppColors.negative)),
        ],
        const SizedBox(height: AppSpace.lg),
        KButton(label: _saving ? 'Saving…' : 'Save for organization', onPressed: _saving ? null : () => _save()),
        const SizedBox(height: AppSpace.sm),
        KButton.secondary(label: 'Reset to defaults', onPressed: _saving ? null : () => _save(reset: true)),
      ],
    );
  }

  Widget _colorBlock(String title, String description, TextEditingController controller, String? parsed, List<(String, String)> presets) {
    final color = parsed == null ? AppColors.hairline : Color(int.parse(parsed.substring(1), radix: 16) + 0xFF000000);
    return KCard(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(width: 28, height: 28, decoration: BoxDecoration(color: color, shape: BoxShape.circle, border: Border.all(color: AppColors.hairline))),
                const SizedBox(width: 10),
                Expanded(child: Text(title, style: AppText.body.copyWith(fontWeight: FontWeight.w600))),
              ],
            ),
            const SizedBox(height: 4),
            Text(description, style: AppText.caption),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final preset in presets)
                  Tooltip(
                    message: preset.$1,
                    child: GestureDetector(
                      onTap: _saving
                          ? null
                          : () => setState(() {
                                controller.text = preset.$2;
                                _error = null;
                              }),
                      child: Container(
                        width: 28,
                        height: 28,
                        decoration: BoxDecoration(
                          color: Color(int.parse(preset.$2.substring(1), radix: 16) + 0xFF000000),
                          shape: BoxShape.circle,
                          border: Border.all(color: controller.text.toLowerCase() == preset.$2.toLowerCase() ? AppColors.ink : AppColors.hairline, width: controller.text.toLowerCase() == preset.$2.toLowerCase() ? 2 : 1),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              enabled: !_saving,
              onChanged: (_) => setState(() => _error = null),
              style: AppText.body,
              cursorColor: AppColors.brand,
              decoration: InputDecoration(
                labelText: 'Hex',
                labelStyle: AppText.body.copyWith(color: AppColors.ink3),
                filled: true,
                fillColor: AppColors.bg,
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.md), borderSide: BorderSide(color: AppColors.hairline)),
                focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.md), borderSide: BorderSide(color: AppColors.brand, width: 2)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
