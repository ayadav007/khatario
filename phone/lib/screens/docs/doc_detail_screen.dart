import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/detail_panel_shell.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import 'doc_list_screen.dart' show DocAction;
import 'doc_logic.dart';

/// One line of a document (item, description, amount).
class DocLine {
  const DocLine(this.title, {this.subtitle = '', this.amount});

  final String title, subtitle;
  final num? amount;
}

/// Describes one document page (quotation, credit note, stock transfer...). [DocDetailScreen] draws it.
class DocDetailSpec {
  const DocDetailSpec({
    required this.title,
    required this.load,
    required this.numberOf,
    this.statusOf,
    this.partyOf,
    this.amountOf,
    this.facts,
    this.lines,
    this.totals,
    this.primary,
    this.actions,
    this.historyPath,
  });

  final String title;

  /// Returns the document map.
  final Future<Map<String, dynamic>> Function(KhatarioApi api) load;
  final String Function(Map<String, dynamic> doc) numberOf;
  final String? Function(Map<String, dynamic> doc)? statusOf, partyOf;
  final num? Function(Map<String, dynamic> doc)? amountOf;

  /// Empty values are dropped.
  final List<(String label, String value)> Function(Map<String, dynamic> doc)? facts;
  final List<DocLine> Function(Map<String, dynamic> doc)? lines;
  final List<(String label, num? amount)> Function(Map<String, dynamic> doc)? totals;

  /// Shown in the bottom bar.
  final DocAction? Function(Map<String, dynamic> doc)? primary;

  /// Shown under "More".
  final List<DocAction> Function(Map<String, dynamic> doc)? actions;

  /// GET path whose rows are drawn as a history timeline.
  final String? Function(Map<String, dynamic> doc)? historyPath;
}

/// Shared detail screen: header, facts, lines, totals, history, a primary action and a More sheet.
/// Pops with `true` when an action changed the document, so the list reloads.
class DocDetailScreen extends StatefulWidget {
  const DocDetailScreen({super.key, required this.session, required this.spec, this.seed});

  final AppSession session;
  final DocDetailSpec spec;

  /// Drawn at once while [DocDetailSpec.load] runs.
  final Map<String, dynamic>? seed;

  @override
  State<DocDetailScreen> createState() => _DocDetailScreenState();
}

class _DocDetailScreenState extends State<DocDetailScreen> {
  Map<String, dynamic>? _doc;
  List<Map<String, dynamic>> _history = const [];
  bool _loading = true;
  bool _busy = false;
  bool _changed = false;

  /// An action changed the document but the reload after it failed: what is drawn may be old.
  bool _stale = false;
  bool _notInPlan = false;
  String? _error;
  int _seq = 0;

  DocDetailSpec get _spec => widget.spec;

  @override
  void initState() {
    super.initState();
    _doc = widget.seed;
    _load();
  }

  void _toast(String message) {
    showKToast(context, message, tone: KTone.negative);
  }

  Future<void> _load({bool spinner = true}) async {
    final seq = ++_seq;
    if (spinner) {
      setState(() {
        _loading = true;
        _error = null;
        _notInPlan = false;
      });
    }
    try {
      final doc = await _spec.load(widget.session.api);
      if (!mounted || seq != _seq) return;
      setState(() {
        _doc = doc;
        _stale = false;
        _loading = false;
        _error = null;
        _notInPlan = false;
      });
      _loadHistory(doc, seq);
    } on ApiException catch (e) {
      if (!mounted || seq != _seq) return;
      if (!spinner && _doc != null) return _reloadFailed(e.message);
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || seq != _seq) return;
      if (!spinner && _doc != null) return _reloadFailed('Could not reach the server.');
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  /// A background reload failed: keep what is drawn and say so.
  void _reloadFailed(String message) {
    setState(() => _loading = false);
    _toast(message);
  }

  /// A failing history request shows nothing.
  Future<void> _loadHistory(Map<String, dynamic> doc, int seq) async {
    final path = _spec.historyPath?.call(doc);
    if (path == null || path.isEmpty) return;
    try {
      final body = await widget.session.api.getData(path);
      if (!mounted || seq != _seq) return;
      setState(() => _history = docRows(body, 'history'));
    } catch (_) {
      if (mounted && seq == _seq) setState(() => _history = const []);
    }
  }

  Future<void> _run(DocAction action) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final changed = await action.run(context);
      if (changed == true) {
        _changed = true;
        _stale = true;
        if (mounted) await _load(spinner: false);
      }
    } on ApiException catch (e) {
      if (mounted) _toast(e.message);
    } catch (_) {
      if (mounted) _toast('Something went wrong. Try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _more(List<DocAction> actions) async {
    final picked = await showKSheet<DocAction>(
      context,
      title: _spec.title,
      builder: (ctx) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final a in actions) KSheetAction(icon: a.icon, label: a.label, danger: a.danger, onTap: () => Navigator.of(ctx).pop(a)),
        ],
      ),
    );
    if (picked == null || !mounted) return;
    await _run(picked);
  }

  static String _money(num v) => '${v < 0 ? '-' : ''}$rupeeSign${enIn(v.abs(), maxFraction: 2)}';

  @override
  Widget build(BuildContext context) {
    final doc = _doc;
    final usable = doc != null && !_stale;
    final actions = usable ? (_spec.actions?.call(doc) ?? const <DocAction>[]) : const <DocAction>[];
    final primary = usable ? _spec.primary?.call(doc) : null;
    return PopScope(
      canPop: !_changed,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(true);
      },
      child: Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              KBackBar(
                _spec.title,
                trailing: actions.isEmpty
                    ? null
                    : Tooltip(
                        message: 'More',
                        child: KIconButton(icon: LucideIcons.ellipsisVertical, tooltip: 'More', onTap: () => _more(actions)),
                      ),
              ),
              Expanded(child: _body(doc)),
              if (primary != null)
                KBottomBar(
                  children: [
                    Expanded(
                      child: KButton(
                        label: primary.label,
                        icon: primary.icon,
                        kind: primary.danger ? KButtonKind.danger : KButtonKind.primary,
                        loading: _busy,
                        onPressed: _busy ? null : () => _run(primary),
                      ),
                    ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _body(Map<String, dynamic>? doc) {
    if (doc == null) {
      if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
      if (_notInPlan) {
        return ListView(
          children: const [KEmptyState(icon: LucideIcons.lock, title: 'Not included in your current plan')],
        );
      }
      return ListView(
        children: [
          KEmptyState(
            icon: LucideIcons.cloudOff,
            title: 'Could not load ${_spec.title.toLowerCase()}',
            body: _error,
            action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
          ),
        ],
      );
    }
    if (_notInPlan) {
      return ListView(
        children: const [KEmptyState(icon: LucideIcons.lock, title: 'Not included in your current plan')],
      );
    }

    final facts = [
      for (final (label, value) in _spec.facts?.call(doc) ?? const <(String, String)>[])
        if (value.trim().isNotEmpty) (label, value),
    ];
    final lines = _spec.lines?.call(doc) ?? const <DocLine>[];
    final totals = [
      for (final (label, amount) in _spec.totals?.call(doc) ?? const <(String, num?)>[])
        if (amount != null) (label, amount),
    ];
    final timeline = [
      for (final h in _history) (description: docText(h['description']), meta: _historyMeta(h), action: docText(h['action_type'])),
    ];
    const pad = EdgeInsets.symmetric(horizontal: AppSpace.gutter);

    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: () => _load(spinner: false),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: AppSpace.xl),
        children: [
          if (_stale)
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.md),
              child: Text('This may be out of date. Pull down to refresh.', style: AppText.caption.copyWith(color: AppColors.negative)),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.md),
              child: Text(_error!, style: AppText.caption.copyWith(color: AppColors.negative)),
            ),
          Padding(padding: pad, child: _header(doc)),
          if (facts.isNotEmpty) ...[
            const SizedBox(height: AppSpace.lg),
            Padding(
              padding: pad,
              child: KInfoCard(title: 'Details', rows: facts),
            ),
          ],
          if (lines.isNotEmpty) ...[
            const SizedBox(height: AppSpace.lg),
            Padding(
              padding: pad,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const KSectionHeader('Items'),
                  KCard(child: KDivided(children: [for (final l in lines) _line(l)])),
                ],
              ),
            ),
          ],
          if (totals.isNotEmpty) ...[const SizedBox(height: AppSpace.lg), Padding(padding: pad, child: _totals(totals))],
          if (timeline.isNotEmpty) ...[
            const SizedBox(height: AppSpace.lg),
            const Padding(padding: pad, child: KSectionHeader('History')),
            DetailHistoryTimeline(entries: timeline),
          ],
        ],
      ),
    );
  }

  Widget _header(Map<String, dynamic> doc) {
    final status = _spec.statusOf?.call(doc) ?? '';
    final party = _spec.partyOf?.call(doc) ?? '';
    final amount = _spec.amountOf?.call(doc);
    return KCard(
      padding: const EdgeInsets.all(AppSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(_spec.numberOf(doc), style: AppText.heading)),
              if (status.isNotEmpty) KPill(label: statusTone(status).$2, tone: statusTone(status).$1),
            ],
          ),
          if (party.isNotEmpty) ...[const SizedBox(height: 2), Text(party, style: AppText.body.copyWith(color: AppColors.ink2))],
          if (amount != null) ...[const SizedBox(height: AppSpace.md), KAmount(amount, maxFraction: 2)],
        ],
      ),
    );
  }

  Widget _line(DocLine l) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpace.lg, vertical: AppSpace.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l.title, style: AppText.bodyStrong),
                if (l.subtitle.isNotEmpty) Text(l.subtitle, style: AppText.caption),
              ],
            ),
          ),
          if (l.amount != null) ...[
            const SizedBox(width: AppSpace.md),
            Text(
              _money(l.amount!),
              textAlign: TextAlign.right,
              style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular),
            ),
          ],
        ],
      ),
    );
  }

  Widget _totals(List<(String, num)> totals) {
    return KCard(
      padding: const EdgeInsets.symmetric(horizontal: AppSpace.lg, vertical: AppSpace.md),
      child: Column(
        children: [
          for (final (i, (label, amount)) in totals.indexed)
            Padding(
              padding: EdgeInsets.only(top: i == 0 ? 0 : AppSpace.sm),
              child: Row(
                children: [
                  Expanded(
                    child: Text(label, style: i == totals.length - 1 ? AppText.bodyStrong : AppText.body.copyWith(color: AppColors.ink2)),
                  ),
                  Text(
                    _money(amount),
                    textAlign: TextAlign.right,
                    style: (i == totals.length - 1 ? AppText.bodyStrong : AppText.body).copyWith(fontFeatures: AppText.tabular),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  static String _historyMeta(Map<String, dynamic> h) {
    final who = [docText(h['user_name']), docText(h['user_email'])].firstWhere((e) => e.isNotEmpty, orElse: () => 'System');
    final at = docDate(h['created_at']);
    return at == null ? who : '$who • ${ddMMMyyyy(at)}';
  }
}
