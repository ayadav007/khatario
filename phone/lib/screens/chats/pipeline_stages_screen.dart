import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../hr/hr_manage_widgets.dart';
import '../hr/pay_widgets.dart';
import '../sales/doc_action_sheets.dart';
import 'pipeline_logic.dart';

/// Website "Pipeline stages": add, rename, recolour, change the type of, reorder and delete stages.
/// Needs the WhatsApp setup permission. Changing a stage's type and deleting a stage ask first.
class PipelineStagesScreen extends StatefulWidget {
  const PipelineStagesScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<PipelineStagesScreen> createState() => _PipelineStagesScreenState();
}

class _PipelineStagesScreenState extends State<PipelineStagesScreen> with HrScreenState<PipelineStagesScreen> {
  List<StageDef> _stages = const [];
  final _newName = TextEditingController();
  String _newKind = 'open';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _newName.dispose();
    super.dispose();
  }

  Future<void> _fetch() async {
    final body = await widget.session.api.getJson(stagesPath);
    if (mounted) _stages = stageDefs(body);
  }

  Future<void> _load() => guardedLoad(_fetch);

  Future<void> _reload() async {
    try {
      await _fetch();
    } catch (_) {
      // Keep what is on screen; the action's own message is already shown.
    }
    if (mounted) setState(() {});
  }

  /// Any 403 is the missing setup permission (the server's code is PERMISSION_DENIED), worded as the website words it.
  Future<void> Function() _guard(Future<void> Function() send) => () async {
        try {
          await send();
        } on ApiException catch (e) {
          if (e.status == 403 && e.code != 'FEATURE_NOT_IN_PLAN') {
            throw ApiException('You need the WhatsApp setup permission to change stages', status: 403);
          }
          rethrow;
        }
      };

  Future<void> _patch(StageDef s, Map<String, dynamic> body, String done, {Future<bool> Function()? confirm}) => act(
        'stage-${s.id}',
        confirm: confirm ?? () async => true,
        send: _guard(() => widget.session.api.patchJson(stagePath(s.id), body)),
        done: done,
        reload: _reload,
      );

  Future<void> _rename(StageDef s) async {
    final name = await showReasonSheet(context, title: 'Rename ${s.name}', confirmLabel: 'Rename', hint: 'Stage name');
    if (name == null || name.trim().isEmpty || name.trim() == s.name || !mounted) return;
    await _patch(s, {'name': name.trim()}, 'Stage renamed');
  }

  Future<void> _setKind(StageDef s, String kind) {
    if (kind == s.kind) return Future.value();
    final label = stageKinds.firstWhere((k) => k.$1 == kind).$2;
    return _patch(
      s,
      {'kind': kind},
      '${s.name} is now a $label stage',
      confirm: () => askSheet(
        context,
        title: 'Make ${s.name} a $label stage?',
        text: kind == 'open'
            ? 'Leads already closed in ${s.name} come off the board; they stay in history.'
            : 'Leads still open in ${s.name} are closed as ${label.toLowerCase()}.',
        confirmLabel: 'Make it $label',
        cancelLabel: 'Not now',
        danger: false,
      ),
    );
  }

  Future<void> _shift(int index, int dir) {
    final ids = [for (final s in _stages) s.id];
    final moved = ids.removeAt(index);
    ids.insert(index + dir, moved);
    return act(
      'order',
      confirm: () async => true,
      send: _guard(() => widget.session.api.putJson(stagesPath, stageOrderBody(ids))),
      done: 'Order saved',
      reload: _reload,
    );
  }

  Future<void> _add() async {
    if (_newName.text.trim().isEmpty) {
      toast('Enter a stage name');
      return;
    }
    await act(
      'add',
      confirm: () async => true,
      send: _guard(() async {
        await widget.session.api.postJson(stagesPath, stageCreateBody(_newName.text, _newKind));
        _newName.clear();
        _newKind = 'open';
      }),
      done: 'Stage added',
      reload: _reload,
    );
  }

  Future<void> _delete(StageDef s) async {
    String? target;
    await showKPicker<String>(
      context,
      title: 'Move ${s.name}\'s chats to',
      value: '-',
      options: [for (final o in _stages) if (o.id != s.id) (o.id, o.name), ('', 'Take them off the board')],
      onChanged: (v) => target = v,
    );
    if (target == null || !mounted) return;
    final moveTo = target!;
    final where = moveTo.isEmpty ? 'come off the board' : 'move to ${_stages.firstWhere((o) => o.id == moveTo).name}';
    await act(
      'stage-${s.id}',
      confirm: () => askSheet(
        context,
        title: 'Delete ${s.name}?',
        text: 'Its chats $where. This cannot be undone.',
        confirmLabel: 'Delete stage',
        cancelLabel: 'Not now',
      ),
      send: _guard(() => widget.session.api.deleteJson(stageDeletePath(s.id, moveTo))),
      done: 'Stage deleted',
      reload: _reload,
    );
  }

  @override
  Widget build(BuildContext context) {
    return PayListPage(
      title: 'Pipeline stages',
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      emptyTitle: 'No stages',
      emptyBody: '',
      emptyIcon: LucideIcons.kanban,
      header: [
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpace.md),
          child: Text('Won and lost stages only show recent deals on the board. Renaming a stage keeps the chats in it.', style: AppText.caption),
        ),
      ],
      rows: [
        for (final (i, s) in _stages.indexed) _stageCard(i, s),
        _addCard(),
      ],
    );
  }

  Widget _stageCard(int i, StageDef s) {
    return KCard(
      child: Padding(
        padding: const EdgeInsets.all(AppSpace.lg),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text(s.name, style: AppText.bodyStrong)),
            KIconButton(icon: LucideIcons.pencil, tooltip: 'Rename ${s.name}', onTap: () => _rename(s)),
            if (i > 0) KIconButton(icon: LucideIcons.arrowUp, tooltip: 'Move ${s.name} up', onTap: () => _shift(i, -1)),
            if (i < _stages.length - 1) KIconButton(icon: LucideIcons.arrowDown, tooltip: 'Move ${s.name} down', onTap: () => _shift(i, 1)),
            if (_stages.length > 1) KIconButton(icon: LucideIcons.trash2, tooltip: 'Delete ${s.name}', onTap: () => _delete(s)),
          ]),
          const SizedBox(height: AppSpace.sm),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              child: KPickField<String>(
                label: 'Colour',
                value: s.color,
                options: [for (final c in stageColors) (c.$1, c.$2)],
                onChanged: (v) => _patch(s, {'color': v}, 'Colour set to ${stageColors.firstWhere((c) => c.$1 == v).$2}'),
              ),
            ),
            const SizedBox(width: AppSpace.sm),
            Expanded(child: KPickField<String>(label: 'Stage type', value: s.kind, options: stageKinds, onChanged: (v) => _setKind(s, v))),
          ]),
        ]),
      ),
    );
  }

  Widget _addCard() {
    return KCard(
      child: Padding(
        padding: const EdgeInsets.all(AppSpace.lg),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          KTextField(label: 'New stage name', controller: _newName, hint: 'e.g. Quoted', maxLength: 60),
          const SizedBox(height: AppSpace.md),
          KPickField<String>(label: 'New stage type', value: _newKind, options: stageKinds, onChanged: (v) => setState(() => _newKind = v)),
          const SizedBox(height: AppSpace.md),
          KButton.secondary(label: 'Add stage', icon: LucideIcons.plus, onPressed: busy.contains('add') ? null : _add),
        ]),
      ),
    );
  }
}
