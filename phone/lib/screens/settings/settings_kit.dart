import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../pages/record_page.dart' show openWebsitePage;

/// Building blocks for the redesigned settings (docs/audits/SETTINGS_AUDIT.md §5):
/// section cards with a one-line "why", rows that show their current value, switches and pickers
/// that save at once with Undo, a save bar for text fields, lock pills and a danger zone.

/// A settings page: title, purpose line, sections, pull to refresh, and the save bar when
/// text fields have unsaved edits.
class SettingsPage extends StatelessWidget {
  const SettingsPage({
    super.key,
    required this.title,
    required this.blurb,
    required this.icon,
    required this.loading,
    required this.children,
    this.error,
    this.onRefresh,
    this.dirtyCount = 0,
    this.saving = false,
    this.onSave,
    this.onDiscard,
  });

  final String title;
  final String blurb;
  final IconData icon;
  final bool loading;
  final String? error;
  final List<Widget> children;
  final Future<void> Function()? onRefresh;
  final int dirtyCount;
  final bool saving;
  final VoidCallback? onSave;
  final VoidCallback? onDiscard;

  @override
  Widget build(BuildContext context) {
    final list = ListView(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, 120),
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(color: AppColors.brandSoft, borderRadius: BorderRadius.circular(12)),
              child: Icon(icon, color: AppColors.brand, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: AppText.title),
                  const SizedBox(height: 2),
                  Text(blurb, style: AppText.caption),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpace.lg),
        if (error != null)
          Container(
            padding: const EdgeInsets.all(12),
            margin: const EdgeInsets.only(bottom: AppSpace.md),
            decoration: BoxDecoration(color: AppColors.negativeSoft, borderRadius: BorderRadius.circular(AppRadius.md)),
            child: Text(error!, style: AppText.body.copyWith(color: AppColors.negative)),
          ),
        if (loading) const KSpinner() else ...children,
      ],
    );
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(),
      body: onRefresh == null ? list : RefreshIndicator(onRefresh: onRefresh!, child: list),
      bottomNavigationBar: dirtyCount == 0
          ? null
          : SafeArea(
              top: false,
              child: Container(
                margin: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.md),
                padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
                decoration: BoxDecoration(color: AppColors.ink, borderRadius: BorderRadius.circular(AppRadius.md)),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        '$dirtyCount unsaved change${dirtyCount == 1 ? '' : 's'}',
                        style: AppText.bodyStrong.copyWith(color: AppColors.surface),
                      ),
                    ),
                    TextButton(
                      onPressed: saving ? null : onDiscard,
                      child: Text('Discard', style: AppText.bodyStrong.copyWith(color: AppColors.surface)),
                    ),
                    const SizedBox(width: 4),
                    FilledButton(
                      style: FilledButton.styleFrom(backgroundColor: KhatarioColors.accent500, foregroundColor: AppColors.ink),
                      onPressed: saving ? null : onSave,
                      child: saving
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Text('Save'),
                    ),
                  ],
                ),
              ),
            ),
    );
  }
}

/// A titled card of rows. [why] says in one line why the section matters.
class SettingsSection extends StatelessWidget {
  const SettingsSection({super.key, required this.title, this.why, required this.children, this.danger = false});

  final String title;
  final String? why;
  final List<Widget> children;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpace.lg),
      child: Material(
        color: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.lg),
          side: BorderSide(color: danger ? AppColors.negative.withValues(alpha: 0.45) : AppColors.hairline),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 14, 14, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: AppText.bodyStrong.copyWith(color: danger ? AppColors.negative : AppColors.ink)),
                  if (why != null) ...[
                    const SizedBox(height: 2),
                    Text(why!, style: AppText.caption),
                  ],
                ],
              ),
            ),
            for (final c in children) ...[const Divider(height: 1, color: AppColors.hairline), c],
          ],
        ),
      ),
    );
  }
}

/// A collapsed section for options most owners never need.
class AdvancedSection extends StatelessWidget {
  const AdvancedSection({super.key, required this.title, this.why, required this.children});

  final String title;
  final String? why;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpace.lg),
      child: Material(
        color: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.lg),
          side: BorderSide(color: AppColors.hairline),
        ),
        clipBehavior: Clip.antiAlias,
        child: Theme(
          data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
          child: ExpansionTile(
            tilePadding: const EdgeInsets.symmetric(horizontal: 14),
            title: Text(title, style: AppText.bodyStrong),
            subtitle: Text('Advanced', style: AppText.caption),
            trailing: Icon(LucideIcons.chevronDown, size: 18, color: AppColors.ink3),
            childrenPadding: EdgeInsets.zero,
            children: [
              if (why != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(14, 0, 14, 10),
                  child: Align(alignment: Alignment.centerLeft, child: Text(why!, style: AppText.caption)),
                ),
              for (final c in children) ...[const Divider(height: 1, color: AppColors.hairline), c],
            ],
          ),
        ),
      ),
    );
  }
}

/// Label and help on the left, a control on the right. [below] puts the control under the label.
class SettingRow extends StatelessWidget {
  const SettingRow({
    super.key,
    required this.label,
    this.help,
    this.trailing,
    this.below,
    this.onTap,
    this.todo = false,
    this.tag,
  });

  final String label;
  final String? help;
  final Widget? trailing;
  final Widget? below;
  final VoidCallback? onTap;
  final bool todo;
  final Widget? tag;

  @override
  Widget build(BuildContext context) {
    final content = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(label, style: AppText.body.copyWith(fontWeight: FontWeight.w500)),
                        if (todo) const KPill(label: 'Needed on invoices', tone: KTone.due),
                        ?tag,
                      ],
                    ),
                    if (help != null && help!.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(help!, style: AppText.caption),
                    ],
                  ],
                ),
              ),
              if (trailing != null) ...[const SizedBox(width: 12), trailing!],
            ],
          ),
          if (below != null) ...[const SizedBox(height: 10), below!],
        ],
      ),
    );
    return onTap == null ? content : InkWell(onTap: onTap, child: content);
  }
}

/// On / off that saves at once.
class ToggleSetting extends StatelessWidget {
  const ToggleSetting({super.key, required this.label, this.help, required this.value, required this.onChanged, this.enabled = true});

  final String label;
  final String? help;
  final bool value;
  final ValueChanged<bool> onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      toggled: value,
      label: label,
      child: SettingRow(
        label: label,
        help: help,
        onTap: enabled ? () => onChanged(!value) : null,
        trailing: Switch(
          value: value,
          activeTrackColor: AppColors.brand,
          inactiveTrackColor: AppColors.hairline,
          inactiveThumbColor: AppColors.surface,
          trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
          onChanged: enabled ? onChanged : null,
        ),
      ),
    );
  }
}

/// One choice from a short list, picked in a sheet; saves at once.
class ChoiceSetting<T> extends StatelessWidget {
  const ChoiceSetting({super.key, required this.label, this.help, required this.value, required this.options, required this.onChanged});

  final String label;
  final String? help;
  final T value;
  final List<(T, String)> options;
  final ValueChanged<T> onChanged;

  String get _current => options.firstWhere((o) => o.$1 == value, orElse: () => (value, '$value')).$2;

  @override
  Widget build(BuildContext context) {
    return SettingRow(
      label: label,
      help: help,
      onTap: () => showKPicker<T>(context, title: label, value: value, options: options, onChanged: onChanged),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 150),
            child: Text(_current, textAlign: TextAlign.right, overflow: TextOverflow.ellipsis, style: AppText.body.copyWith(color: AppColors.brand, fontWeight: FontWeight.w600)),
          ),
          const SizedBox(width: 2),
          Icon(LucideIcons.chevronsUpDown, size: 16, color: AppColors.brand),
        ],
      ),
    );
  }
}

/// A link to a deeper screen: label, its current value underneath, chevron.
class NavSetting extends StatelessWidget {
  const NavSetting({super.key, required this.label, this.value, required this.onTap, this.web = false, this.tag});

  final String label;
  final String? value;
  final VoidCallback onTap;

  /// Opens the website (the screen is not on the phone yet).
  final bool web;
  final Widget? tag;

  @override
  Widget build(BuildContext context) {
    return SettingRow(
      label: label,
      help: value,
      tag: tag,
      onTap: onTap,
      trailing: Icon(web ? LucideIcons.externalLink : LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
    );
  }
}

/// Opens a website settings page in the browser.
class WebSetting extends StatelessWidget {
  const WebSetting({super.key, required this.label, this.value, required this.href});

  final String label;
  final String? value;
  final String href;

  @override
  Widget build(BuildContext context) => NavSetting(label: label, value: value ?? 'Opens on the website', web: true, onTap: () => openWebsitePage(href));
}

/// A connection or state, with one action.
class StatusSetting extends StatelessWidget {
  const StatusSetting({super.key, required this.label, required this.status, required this.tone, this.action, this.onAction, this.help});

  final String label;
  final String status;
  final KTone tone;
  final String? action;
  final VoidCallback? onAction;
  final String? help;

  @override
  Widget build(BuildContext context) {
    return SettingRow(
      label: label,
      help: help,
      below: Row(
        children: [
          Expanded(child: Align(alignment: Alignment.centerLeft, child: KPill(label: status, tone: tone))),
          if (action != null) KTextButton(label: action!, onTap: onAction),
        ],
      ),
    );
  }
}

/// A text field that joins the page's save bar.
class TextSetting extends StatelessWidget {
  const TextSetting({
    super.key,
    required this.label,
    this.help,
    required this.controller,
    this.keyboardType,
    this.hint,
    this.short = false,
    this.multiline = false,
    this.mono = false,
    this.todo = false,
    this.onChanged,
    this.textCapitalization = TextCapitalization.none,
  });

  final String label;
  final String? help;
  final TextEditingController controller;
  final TextInputType? keyboardType;
  final String? hint;
  final bool short;
  final bool multiline;
  final bool mono;
  final bool todo;
  final ValueChanged<String>? onChanged;
  final TextCapitalization textCapitalization;

  @override
  Widget build(BuildContext context) {
    final field = TextField(
      controller: controller,
      keyboardType: keyboardType ?? (multiline ? TextInputType.multiline : null),
      maxLines: multiline ? 4 : 1,
      minLines: multiline ? 2 : 1,
      textAlign: short ? TextAlign.right : TextAlign.start,
      textCapitalization: textCapitalization,
      onChanged: onChanged,
      style: mono ? AppText.body.copyWith(fontFeatures: AppText.tabular, letterSpacing: 0.6) : AppText.body,
      decoration: InputDecoration(
        isDense: true,
        hintText: hint,
        labelText: short ? null : label,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      ),
    );
    if (short) {
      return SettingRow(label: label, help: help, todo: todo, trailing: SizedBox(width: 96, child: field));
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          field,
          if (help != null || todo) ...[
            const SizedBox(height: 4),
            Row(
              children: [
                if (help != null) Expanded(child: Text(help!, style: AppText.caption)),
                if (todo) const KPill(label: 'Needed on invoices', tone: KTone.due),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// A segmented choice inside a row (2–3 options); saves at once.
class SegmentSetting<T> extends StatelessWidget {
  const SegmentSetting({super.key, required this.label, this.help, required this.value, required this.options, required this.onChanged});

  final String label;
  final String? help;
  final T value;
  final List<(T, String)> options;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    return SettingRow(label: label, help: help, below: KSegmented<T>(value: value, options: options, onChanged: onChanged));
  }
}

/// Plan-locked option: stays visible, opens an upgrade note instead of a locked page.
class LockedSetting extends StatelessWidget {
  const LockedSetting({super.key, required this.label, required this.help, required this.plan, this.value});

  final String label;
  final String help;
  final String plan;
  final String? value;

  @override
  Widget build(BuildContext context) {
    return SettingRow(
      label: label,
      help: value == null ? help : '$value · $help',
      onTap: () => showKSheet<void>(
        context,
        title: label,
        builder: (ctx) => Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(help, style: AppText.body),
              const SizedBox(height: 8),
              Text('Included in the $plan.', style: AppText.caption),
              const SizedBox(height: 16),
              KButton(
                label: 'See plans',
                onPressed: () {
                  Navigator.pop(ctx);
                  openWebsitePage('/settings/subscription');
                },
              ),
            ],
          ),
        ),
      ),
      trailing: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(color: AppTints.orange.$1, borderRadius: BorderRadius.circular(20)),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(LucideIcons.lock, size: 12, color: AppTints.orange.$2),
            const SizedBox(width: 4),
            Text(plan, style: AppText.small.copyWith(color: AppTints.orange.$2)),
          ],
        ),
      ),
    );
  }
}

/// A destructive action behind a typed confirmation.
class DangerSetting extends StatefulWidget {
  const DangerSetting({super.key, required this.label, required this.help, required this.word, required this.onConfirm});

  final String label;
  final String help;
  final String word;
  final Future<void> Function() onConfirm;

  @override
  State<DangerSetting> createState() => _DangerSettingState();
}

class _DangerSettingState extends State<DangerSetting> {
  final _c = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ok = _c.text.trim().toUpperCase() == widget.word;
    return SettingRow(
      label: widget.label,
      help: widget.help,
      below: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _c,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(isDense: true, hintText: 'Type ${widget.word}'),
            ),
          ),
          const SizedBox(width: 10),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.negative),
            onPressed: ok && !_busy
                ? () async {
                    setState(() => _busy = true);
                    try {
                      await widget.onConfirm();
                      _c.clear();
                    } finally {
                      if (mounted) setState(() => _busy = false);
                    }
                  }
                : null,
            child: Text(widget.label),
          ),
        ],
      ),
    );
  }
}

/// A list row inside a section (bank account, user, gateway…).
class ItemSetting extends StatelessWidget {
  const ItemSetting({super.key, required this.title, this.subtitle, this.leading, this.trailing, this.onTap});

  final String title;
  final String? subtitle;
  final Widget? leading;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => KListRow(title: title, subtitle: subtitle, leading: leading, trailing: trailing, onTap: onTap);
}

/// An "Add …" button at the foot of a section.
class AddSetting extends StatelessWidget {
  const AddSetting({super.key, required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(6, 2, 6, 2),
        child: Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(onPressed: onTap, icon: const Icon(LucideIcons.plus, size: 16), label: Text(label)),
        ),
      );
}

/// Saves a switch or choice straight away and offers Undo. Rolls back and explains on failure.
Future<void> saveInstantly(
  BuildContext context, {
  required String message,
  required Future<void> Function() save,
  required VoidCallback revert,
  Future<void> Function()? undo,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    await save();
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(SnackBar(
      content: Text(message),
      duration: const Duration(seconds: 4),
      action: undo == null
          ? null
          : SnackBarAction(
              label: 'Undo',
              onPressed: () async {
                revert();
                try {
                  await undo();
                } catch (_) {}
              },
            ),
    ));
  } on ApiException catch (e) {
    revert();
    messenger.showSnackBar(SnackBar(content: Text(e.message)));
  } catch (_) {
    revert();
    messenger.showSnackBar(const SnackBar(content: Text('Could not save. Check your connection and try again.')));
  }
}

/// Tracks text fields against their saved values for the save bar.
class DirtyFields {
  final Map<String, TextEditingController> _c = {};
  final Map<String, String> _saved = {};

  /// The controller for [key]; its saved value comes from [reset].
  TextEditingController field(String key) => _c.putIfAbsent(key, () => TextEditingController(text: _saved[key] ?? ''));

  bool _isDirty(String key) => (_c[key]?.text ?? '') != (_saved[key] ?? '');

  /// Resets every field to [values] (after load or save).
  void reset(Map<String, String> values) {
    values.forEach((k, v) {
      _saved[k] = v;
      _c.putIfAbsent(k, () => TextEditingController()).text = v;
    });
  }

  Map<String, String> get changed => {
        for (final k in _c.keys)
          if (_isDirty(k)) k: _c[k]!.text.trim(),
      };

  int get count => changed.length;

  String text(String key) => _c[key]?.text.trim() ?? '';

  void discard() {
    _saved.forEach((k, v) => _c[k]?.text = v);
  }

  void dispose() {
    for (final c in _c.values) {
      c.dispose();
    }
  }
}

/// `{key: value}` from a JSON object, or empty.
Map<String, dynamic> jsonMap(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

/// List of JSON objects, or empty.
List<Map<String, dynamic>> jsonList(dynamic v) =>
    v is List ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [];

/// Small grey badge on a row.
class SettingTag extends StatelessWidget {
  const SettingTag(this.label, {super.key});

  final String label;

  @override
  Widget build(BuildContext context) => KPill(label: label, tone: KTone.neutral);
}
