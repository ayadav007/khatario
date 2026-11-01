import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'chat_thread_screen.dart';
import 'pipeline_logic.dart';

/// The website pipeline board as a phone list: pick a stage, see its leads, move one with a long press.
class PipelineScreen extends StatefulWidget {
  const PipelineScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<PipelineScreen> createState() => _PipelineScreenState();
}

class _PipelineScreenState extends State<PipelineScreen> {
  List<PipelineStage> _stages = const [];
  String? _stageId;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/whatsapp/pipeline?closed_days=90');
      if (!mounted) return;
      setState(() {
        _stages = parseBoard(body);
        _stageId ??= _stages.where((s) => s.count > 0).firstOrNull?.id ?? _stages.firstOrNull?.id;
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.message;
      });
    }
  }

  Future<void> _move(DealCard card) async {
    String? picked;
    await showKPicker<String>(
      context,
      title: 'Move ${card.name}',
      value: card.stageId,
      options: [for (final s in _stages) (s.id, s.name)],
      onChanged: (v) => picked = v,
    );
    if (picked == null || !mounted) return;
    final target = _stages.firstWhere((s) => s.id == picked);
    String? reason;
    if (target.kind == 'lost') {
      reason = await showReasonSheet(context, title: 'Why was it lost?', confirmLabel: 'Mark lost', hint: 'e.g. Price too high');
      if (reason == null) return;
    }
    try {
      // Cards are leads (some have no chat yet), so the move goes to the lead.
      await widget.session.api.patchJson('/api/whatsapp/leads/${Uri.encodeComponent(card.id)}', {
        'stage_id': picked,
        'lost_reason': ?reason,
      });
      await _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final stage = _stages.where((s) => s.id == _stageId).firstOrNull;
    final openValue = _stages.where((s) => s.kind == 'open').fold<num>(0, (n, s) => n + s.totalValue);
    final now = DateTime.now();
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Pipeline'),
            if (!_loading && _stages.isNotEmpty) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.sm),
                child: Text('${inr(openValue.round())} in open deals', style: AppText.caption),
              ),
              KChipBar<String>(
                value: _stageId,
                options: [for (final s in _stages) (s.id, '${s.name} ${s.count}')],
                onChanged: (id) => setState(() => _stageId = id),
              ),
              const SizedBox(height: AppSpace.sm),
            ],
            if (_error != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
                child: Text(_error!, style: AppText.caption.copyWith(color: AppColors.negative)),
              ),
            Expanded(
              child: _loading
                  ? const KSpinner()
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: stage == null || stage.cards.isEmpty
                          ? ListView(children: const [
                              KEmptyState(
                                icon: LucideIcons.kanban,
                                title: 'No leads in this stage',
                                body: 'Set a stage from a chat: tap the deal icon at the top of the chat.',
                              ),
                            ])
                          : ListView(
                              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.lg),
                              children: [
                                KCard(
                                  child: KDivided(
                                    children: [
                                      for (final card in stage.cards)
                                        KListRow(
                                          title: card.name,
                                          subtitle: [
                                            if (card.conversationId == null) 'No chat yet',
                                            card.meta(now),
                                            if ((card.lastMessage ?? '').isNotEmpty) card.lastMessage!,
                                          ].where((s) => s.isNotEmpty).join(card.conversationId == null ? ' · ' : '\n'),
                                          leading: KAvatar(name: card.name),
                                          trailing: card.conversationId == null
                                              ? null
                                              : Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
                                          // A lead with no chat yet has nothing to open; it can still be moved.
                                          onTap: card.conversationId == null
                                              ? null
                                              : () => Navigator.of(context)
                                                  .push(MaterialPageRoute(
                                                    builder: (_) =>
                                                        ChatThreadScreen(session: widget.session, conversationId: card.conversationId!, title: card.name),
                                                  ))
                                                  .then((_) => _load()),
                                          onLongPress: () => _move(card),
                                        ),
                                    ],
                                  ),
                                ),
                                if (stage.cards.length < stage.count)
                                  Padding(
                                    padding: const EdgeInsets.only(top: AppSpace.sm),
                                    child: Text('Showing the newest ${stage.cards.length} of ${stage.count}. See all on the website.',
                                        textAlign: TextAlign.center, style: AppText.caption),
                                  ),
                                Padding(
                                  padding: const EdgeInsets.only(top: AppSpace.md),
                                  child: Text('Long-press a lead to move it to another stage.', textAlign: TextAlign.center, style: AppText.caption),
                                ),
                              ],
                            ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
