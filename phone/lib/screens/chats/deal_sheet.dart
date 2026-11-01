import 'package:flutter/material.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import 'pipeline_logic.dart';

const _waGreen = Color(0xFF008069);
const _waMeta = Color(0xFF667781);

/// Stage, deal value and "remind me" for one chat (the website contact panel's Lead section).
Future<void> showDealSheet(BuildContext context, {required AppSession session, required String conversationId}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    useSafeArea: true,
    builder: (_) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: _DealSheet(session: session, conversationId: conversationId),
    ),
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
    final picked = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => ListView(
        shrinkWrap: true,
        children: [
          const ListTile(title: Text('Pipeline stage', style: TextStyle(fontWeight: FontWeight.w600))),
          for (final s in _stages)
            ListTile(
              title: Text(s.name),
              trailing: s.id == _deal?.stageId ? const Icon(Icons.check, color: _waGreen) : null,
              onTap: () => Navigator.of(ctx).pop(s.id),
            ),
          ListTile(
            title: const Text('Take off the pipeline', style: TextStyle(color: _waMeta)),
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
      return const SizedBox(height: 160, child: Center(child: CircularProgressIndicator(color: _waGreen)));
    }
    final stage = _stages.where((s) => s.id == deal?.stageId).firstOrNull;
    final now = DateTime.now();
    return ListView(
      shrinkWrap: true,
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      children: [
        const Text('Deal & follow-ups', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
        const SizedBox(height: 4),
        Text('Lead source: ${describeSource(deal?.source, deal?.sourceDetail)}', style: const TextStyle(fontSize: 13, color: _waMeta)),
        const SizedBox(height: 12),
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Pipeline stage'),
          subtitle: Text(stage?.name ?? 'Not on the pipeline'),
          trailing: const Icon(Icons.chevron_right),
          onTap: _busy ? null : _pickStage,
        ),
        if (deal?.stageId != null)
          TextField(
            controller: _value,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'Deal value (₹)', isDense: true),
            onSubmitted: (_) => _saveValue(),
            onTapOutside: (_) => _saveValue(),
          ),
        if (stage?.kind == 'lost' && (deal?.lostReason ?? '').isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text('Lost: ${deal!.lostReason}', style: const TextStyle(color: Color(0xFFB91C1C))),
          ),
        const Divider(height: 28),
        const Text('Follow-ups', style: TextStyle(fontWeight: FontWeight.w600)),
        if (_followups.isEmpty)
          const Padding(padding: EdgeInsets.symmetric(vertical: 6), child: Text('No reminders on this chat.', style: TextStyle(color: _waMeta))),
        for (final f in _followups)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(Icons.alarm, color: f.dueAt.isBefore(now) ? const Color(0xFFB91C1C) : _waMeta),
            title: Text('${ddMMMyyyyHm(f.dueAt)}${f.assignedName == null ? '' : ' · ${f.assignedName}'}'),
            subtitle: f.note == null || f.note!.isEmpty ? null : Text(f.note!),
            trailing: Wrap(
              children: [
                IconButton(
                  tooltip: 'Done',
                  icon: const Icon(Icons.check_circle_outline, color: _waGreen),
                  onPressed: _busy ? null : () => _run(() => widget.session.api.patchJson('/api/whatsapp/followups/${f.id}', {'status': 'done'})),
                ),
                IconButton(
                  tooltip: 'Tomorrow',
                  icon: const Icon(Icons.snooze),
                  onPressed: _busy
                      ? null
                      : () => _run(() => widget.session.api.patchJson('/api/whatsapp/followups/${f.id}', {
                            'due_at': remindAt(RemindPreset.tomorrow, DateTime.now()).toUtc().toIso8601String(),
                          })),
                ),
              ],
            ),
          ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            for (final p in RemindPreset.values)
              ChoiceChip(
                label: Text(remindPresetLabels[p]!),
                selected: _preset == p,
                selectedColor: const Color(0xFFD9FDD3),
                onSelected: (_) => setState(() => _preset = p),
              ),
          ],
        ),
        TextField(
          controller: _note,
          maxLength: 500,
          decoration: const InputDecoration(hintText: 'Note (optional), e.g. send revised quote', isDense: true, counterText: ''),
        ),
        const SizedBox(height: 8),
        FilledButton.icon(
          style: FilledButton.styleFrom(backgroundColor: _waGreen),
          onPressed: _busy ? null : _remind,
          icon: const Icon(Icons.alarm_add),
          label: const Text('Remind me'),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_error!, style: const TextStyle(color: Color(0xFFB91C1C))),
          ),
      ],
    );
  }
}
