import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import 'pipeline_logic.dart';

/// Stage, deal value and "remind me" for one chat (the website contact panel's Lead section).
Future<void> showDealSheet(BuildContext context, {required AppSession session, required String conversationId}) {
  return showKSheet<void>(
    context,
    title: 'Deal & follow-ups',
    builder: (_) => _DealSheet(session: session, conversationId: conversationId),
  );
}

class _DealSheet extends StatefulWidget {
  const _DealSheet({required this.session, required this.conversationId});

  final AppSession session;
  final String conversationId;

  @override
  State<_DealSheet> createState() => _DealSheetState();
}

class _DealSheetState extends State<_DealSheet> {
  final _value = TextEditingController();
  final _note = TextEditingController();
  Deal? _deal;
  List<PipelineStage> _stages = const [];
  List<Followup> _followups = const [];
  RemindPreset _preset = RemindPreset.tomorrow;
  bool _busy = false;
  String? _error;

  String get _dealPath => '/api/whatsapp/conversations/${Uri.encodeComponent(widget.conversationId)}/deal';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _value.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson(_dealPath);
      final list = await widget.session.api.getJson('/api/whatsapp/followups?conversation_id=${Uri.encodeComponent(widget.conversationId)}');
      if (!mounted) return;
      setState(() {
        _deal = Deal.fromJson(body['deal'] is Map ? Map<String, dynamic>.from(body['deal'] as Map) : null);
        _stages = (body['stages'] is List ? body['stages'] as List : const [])
            .whereType<Map>()
            .map((s) => PipelineStage.fromJson(Map<String, dynamic>.from(s)))
            .toList();
        _followups = parseFollowups(list);
        _value.text = _deal?.dealValue == null ? '' : jsNumberString(_deal!.dealValue!);
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
      await _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickStage() async {
    final picked = await showKSheet<String>(
      context,
      title: 'Pipeline stage',
      builder: (ctx) => ListView(
        shrinkWrap: true,
        children: [
          for (final s in _stages)
            KListRow(
              title: s.name,
              trailing: s.id == _deal?.stageId ? Icon(LucideIcons.check, color: AppColors.brand) : null,
              onTap: () => Navigator.of(ctx).pop(s.id),
            ),
          KListRow(
            title: 'Take off the pipeline',
            onTap: () => Navigator.of(ctx).pop(''),
          ),
        ],
      ),
    );
    if (picked == null || picked == (_deal?.stageId ?? '')) return;
    await _run(() => widget.session.api.patchJson(_dealPath, {'stage_id': picked.isEmpty ? null : picked}));
  }

  Future<void> _saveValue() async {
    final text = _value.text.trim().replaceAll(',', '');
    final value = text.isEmpty ? null : num.tryParse(text);
    if (text.isNotEmpty && value == null) {
      setState(() => _error = 'Enter the deal value as a number');
      return;
    }
    if (value == _deal?.dealValue) return;
    await _run(() => widget.session.api.patchJson(_dealPath, {'deal_value': value}));
  }

  Future<void> _remind() async {
    final due = remindAt(_preset, DateTime.now());
    await _run(() async {
      await widget.session.api.postJson('/api/whatsapp/followups', {
        'conversation_id': widget.conversationId,
        'due_at': due.toUtc().toIso8601String(),
        'note': _note.text.trim(),
      });
      _note.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final deal = _deal;
    if (deal == null && _error == null) {
      return const SizedBox(height: 160, child: KSpinner());
    }
    final stage = _stages.where((s) => s.id == deal?.stageId).firstOrNull;
    final now = DateTime.now();
    return ListView(
      shrinkWrap: true,
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      children: [
        Text('Lead source: ${describeSource(deal?.source, deal?.sourceDetail)}', style: AppText.caption),
        const SizedBox(height: 12),
        KListRow(
          padding: const EdgeInsets.symmetric(vertical: 12),
          title: 'Pipeline stage',
          subtitle: stage?.name ?? 'Not on the pipeline',
          trailing: Icon(LucideIcons.chevronRight, color: AppColors.ink3),
          onTap: _busy ? null : _pickStage,
        ),
        if (deal?.stageId != null)
          KTextField(
            label: 'Deal value (₹)',
            controller: _value,
            keyboard: const TextInputType.numberWithOptions(decimal: true),
            onSubmitted: (_) => _saveValue(),
            onTapOutside: (_) => _saveValue(),
          ),
        if (stage?.kind == 'lost' && (deal?.lostReason ?? '').isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text('Lost: ${deal!.lostReason}', style: AppText.body.copyWith(color: AppColors.negative)),
          ),
        const Divider(height: 28, color: AppColors.hairline),
        Text('Follow-ups', style: AppText.bodyStrong),
        if (_followups.isEmpty)
          Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Text('No reminders on this chat.', style: AppText.caption)),
        for (final f in _followups)
          KListRow(
            padding: const EdgeInsets.symmetric(vertical: 8),
            leading: Icon(LucideIcons.alarmClock, color: f.dueAt.isBefore(now) ? AppColors.negative : AppColors.ink3),
            title: '${ddMMMyyyyHm(f.dueAt)}${f.assignedName == null ? '' : ' · ${f.assignedName}'}',
            subtitle: f.note == null || f.note!.isEmpty ? null : f.note!,
            trailing: IgnorePointer(
              ignoring: _busy,
              child: Opacity(
                opacity: _busy ? 0.4 : 1,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    KIconButton(
                      tooltip: 'Done',
                      icon: LucideIcons.circleCheck,
                      color: AppColors.brand,
                      onTap: () => _run(() => widget.session.api.patchJson('/api/whatsapp/followups/${f.id}', {'status': 'done'})),
                    ),
                    KIconButton(
                      tooltip: 'Tomorrow',
                      icon: LucideIcons.alarmClockPlus,
                      onTap: () => _run(() => widget.session.api.patchJson('/api/whatsapp/followups/${f.id}', {
                            'due_at': remindAt(RemindPreset.tomorrow, DateTime.now()).toUtc().toIso8601String(),
                          })),
                    ),
                  ],
                ),
              ),
            ),
          ),
        const SizedBox(height: 8),
        KChipBar<RemindPreset>(
          padding: EdgeInsets.zero,
          value: _preset,
          options: [for (final p in RemindPreset.values) (p, remindPresetLabels[p]!)],
          onChanged: (p) => setState(() => _preset = p),
        ),
        const SizedBox(height: 8),
        KTextField(
          label: 'Note',
          controller: _note,
          maxLength: 500,
          hint: 'Note (optional), e.g. send revised quote',
        ),
        const SizedBox(height: 8),
        KButton(label: 'Remind me', icon: LucideIcons.alarmClockPlus, onPressed: _busy ? null : _remind),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_error!, style: AppText.body.copyWith(color: AppColors.negative)),
          ),
      ],
    );
  }
}
