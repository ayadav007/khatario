import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import 'lead_profile_screen.dart';
import 'leads_logic.dart';
import 'pipeline_logic.dart';
import 'pipeline_stages_screen.dart';

const _windowOptions = <(int, String)>[
  (30, 'Won/lost: last 30 days'),
  (90, 'Won/lost: last 90 days'),
  (365, 'Won/lost: last year'),
];

/// The website pipeline board as a phone list: pick a stage, see its leads, move one with a long press.
/// Search, handled-by (supervisors), label, source and won/lost window filter it as on the website;
/// "Stages" manages the stages; a card opens the lead.
class PipelineScreen extends StatefulWidget {
  const PipelineScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<PipelineScreen> createState() => _PipelineScreenState();
}

class _PipelineScreenState extends State<PipelineScreen> {
  final _searchController = TextEditingController();
  Timer? _debounce;
  int _seq = 0;

  List<PipelineStage> _stages = const [];
  String? _stageId;
  PipelineFilters _filters = const PipelineFilters();
  bool _isSupervisor = false;
  List<PickOption> _labels = const [];
  List<PickOption> _people = const [];
  bool _peopleLoaded = false;
  bool _loading = true;
  bool _notInPlan = false;
  final Set<String> _loadingMore = {};
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
    _optional(whatsappLabelsPath).then((b) {
      if (b != null && mounted) setState(() => _labels = labelOptions(b));
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>?> _optional(String path) async {
    try {
      return await widget.session.api.getJson(path);
    } catch (_) {
      return null;
    }
  }

  /// [quiet] reloads without the spinner (after a move or coming back from another screen), so the
  /// counts are right again.
  Future<void> _load({bool quiet = false}) async {
    final seq = ++_seq;
    if (!quiet) {
      setState(() {
        _loading = true;
        _error = null;
        _notInPlan = false;
      });
    }
    try {
      final body = await widget.session.api.getJson(pipelinePath(_filters));
      if (!mounted || seq != _seq) return;
      final stages = parseBoard(body);
      setState(() {
        _stages = stages;
        _isSupervisor = body['is_supervisor'] == true;
        if (!stages.any((s) => s.id == _stageId)) {
          _stageId = stages.where((s) => s.count > 0).firstOrNull?.id ?? stages.firstOrNull?.id;
        }
        _loadingMore.clear();
        _loading = false;
        _error = null;
      });
      if (_isSupervisor && !_peopleLoaded) {
        _peopleLoaded = true;
        _optional(whatsappUsersPath).then((b) {
          if (b != null && mounted) setState(() => _people = personOptions(b));
        });
      }
    } on ApiException catch (e) {
      if (!mounted || seq != _seq) return;
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _loading = false;
        _error = e.message;
      });
    } catch (_) {
      if (!mounted || seq != _seq) return;
      setState(() {
        _loading = false;
        _error = 'Could not reach the server.';
      });
    }
  }

  void _filter(PipelineFilters next) {
    setState(() => _filters = next);
    _load();
  }

  void _onSearch(String text) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (mounted && text.trim() != _filters.search.trim()) _filter(_filters.copyWith(search: text.trim()));
    });
  }

  /// "Show more": the next page of this stage, added under the cards already shown. Busy per stage.
  Future<void> _showMore(PipelineStage stage) async {
    if (_loadingMore.contains(stage.id)) return;
    final seq = _seq;
    setState(() => _loadingMore.add(stage.id));
    try {
      final body = await widget.session.api.getJson(pipelineMorePath(stage.id, stage.cards.length, _filters));
      final more = parseBoard(body).where((s) => s.id == stage.id).firstOrNull?.cards ?? const <DealCard>[];
      if (!mounted || seq != _seq) return;
      setState(() => _stages = [for (final s in _stages) s.id == stage.id ? s.withMoreCards(more) : s]);
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not load more. Try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _loadingMore.remove(stage.id));
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
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    }
    // Counts and totals change on both stages, whether or not the move went through.
    if (mounted) await _load(quiet: true);
  }

  Future<void> _push(Widget screen) =>
      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen)).then((_) {
        if (mounted) _load(quiet: true);
      });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(
              'Pipeline',
              trailing: _notInPlan ? null : KIconButton(icon: LucideIcons.settings, tooltip: 'Stages', onTap: () => _push(PipelineStagesScreen(session: widget.session))),
            ),
            if (!_notInPlan) _filterBar(),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _filterBar() {
    final openValue = _stages.where((s) => s.kind == 'open').fold<num>(0, (n, s) => n + s.totalValue);
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.sm),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        KSearchField(controller: _searchController, hint: 'Search name or number', onChanged: _onSearch),
        const SizedBox(height: AppSpace.sm),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: KPickField<String>(
              label: 'Lead source',
              value: _filters.source,
              options: [('', 'All sources'), ...leadSourceFilters],
              onChanged: (v) => _filter(_filters.copyWith(source: v)),
            ),
          ),
          const SizedBox(width: AppSpace.sm),
          Expanded(
            child: KPickField<String>(
              label: 'Label',
              value: _filters.labelId,
              options: [('', 'All labels'), for (final l in _labels) (l.id, l.name)],
              onChanged: (v) => _filter(_filters.copyWith(labelId: v)),
            ),
          ),
        ]),
        const SizedBox(height: AppSpace.sm),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: KPickField<int>(
              label: 'Won and lost shown',
              value: _filters.closedDays,
              options: _windowOptions,
              onChanged: (v) => _filter(_filters.copyWith(closedDays: v)),
            ),
          ),
          if (_isSupervisor) ...[
            const SizedBox(width: AppSpace.sm),
            Expanded(
              child: KPickField<String>(
                label: 'Handled by',
                value: _filters.owner,
                options: [('', 'Everyone'), for (final p in _people) (p.id, p.name)],
                onChanged: (v) => _filter(_filters.copyWith(owner: v)),
              ),
            ),
          ],
        ]),
        if (!_loading && _stages.isNotEmpty) ...[
          const SizedBox(height: AppSpace.sm),
          Text('${inr(openValue.round())} in open deals', style: AppText.caption),
          const SizedBox(height: AppSpace.sm),
          KChipBar<String>(
            value: _stageId,
            padding: EdgeInsets.zero,
            options: [for (final s in _stages) (s.id, '${s.name} ${s.count}')],
            onChanged: (id) => setState(() => _stageId = id),
          ),
        ],
      ]),
    );
  }

  Widget _body() {
    if (_loading) return const KSpinner();
    if (_error != null) {
      return ListView(children: [
        KEmptyState(
          icon: _notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
          title: _notInPlan ? 'Not included in your current plan' : 'Could not load the pipeline',
          body: _error,
          action: _notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
        ),
      ]);
    }
    final stage = _stages.where((s) => s.id == _stageId).firstOrNull;
    final now = DateTime.now();
    return RefreshIndicator(
      onRefresh: () => _load(quiet: true),
      child: stage == null || stage.cards.isEmpty
          ? ListView(children: [
              KEmptyState(
                icon: LucideIcons.kanban,
                title: _filters.any ? 'No leads match these filters' : 'No leads in this stage',
                body: _filters.any ? null : 'Set a stage from a chat: tap the deal icon at the top of the chat.',
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
                            card.contactLine,
                            card.meta(now),
                            card.conversationId == null ? 'No chat yet' : (card.lastMessage ?? ''),
                          ].where((s) => s.isNotEmpty).join('\n'),
                          leading: KAvatar(name: card.name),
                          trailing: KTextButton(label: 'Move', onTap: () => _move(card)),
                          // The lead opens with its chat one tap away; a lead with no chat yet opens too.
                          onTap: () => _push(LeadProfileScreen(session: widget.session, leadId: card.id, isSupervisor: _isSupervisor)),
                          onLongPress: () => _move(card),
                        ),
                    ],
                  ),
                ),
                if (stage.remaining > 0)
                  Padding(
                    padding: const EdgeInsets.only(top: AppSpace.sm),
                    child: KButton.secondary(
                      label: _loadingMore.contains(stage.id) ? 'Loading…' : 'Show more (${stage.remaining})',
                      expand: false,
                      onPressed: _loadingMore.contains(stage.id) ? null : () => _showMore(stage),
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.only(top: AppSpace.md),
                  child: Text('Tap a lead to open it. Tap Move (or long-press) to change its stage.', textAlign: TextAlign.center, style: AppText.caption),
                ),
              ],
            ),
    );
  }
}
