import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import 'doc_logic.dart';

/// One extra action for a row, shown in the long-press sheet.
class DocAction {
  const DocAction(this.label, this.icon, this.run, {this.danger = false});

  final String label;
  final IconData icon;
  final bool danger;

  /// Return true to reload the list.
  final Future<bool?> Function(BuildContext context) run;
}

/// Describes one document list (quotations, credit notes, stock transfers...). [DocListScreen] draws it.
class DocListSpec {
  const DocListSpec({
    required this.title,
    required this.href,
    required this.path,
    required this.listKey,
    required this.titleOf,
    this.subtitleOf,
    this.amountOf,
    this.statusOf,
    this.searchKeys = const [],
    this.filters = const [],
    this.filterParam = 'status',
    this.filterRow,
    this.icon = LucideIcons.fileText,
    this.emptyTitle,
    this.emptyBody,
    this.createLabel,
    this.onCreate,
    this.onOpen,
    this.rowActions,
  });

  final String title, href, path, listKey;
  final String Function(Map<String, dynamic> row) titleOf;
  final String Function(Map<String, dynamic> row)? subtitleOf;
  final num? Function(Map<String, dynamic> row)? amountOf;
  final String? Function(Map<String, dynamic> row)? statusOf;
  final List<String> searchKeys;

  /// First entry is the default; '' means all.
  final List<(String value, String label)> filters;
  final String filterParam;

  /// For a route that does not filter by itself: when set, the chip is not sent to the server and the rows it
  /// returns are filtered here (a blank chip keeps every row).
  final bool Function(Map<String, dynamic> row, String filter)? filterRow;
  final IconData icon;
  final String? emptyTitle, emptyBody, createLabel;

  /// Return true when something was saved, so the list reloads.
  final Future<bool?> Function(BuildContext context)? onCreate;
  final Future<bool?> Function(BuildContext context, Map<String, dynamic> row)? onOpen;
  final List<DocAction> Function(Map<String, dynamic> row)? rowActions;
}

/// Shared list screen: search, filter chips, day groups, Show more, long-press actions.
class DocListScreen extends StatefulWidget {
  const DocListScreen({super.key, required this.session, required this.spec, this.embedded = false});

  final AppSession session;
  final DocListSpec spec;

  /// Inside another screen: no back bar and no Scaffold.
  final bool embedded;

  @override
  State<DocListScreen> createState() => _DocListScreenState();
}

class _DocListScreenState extends State<DocListScreen> {
  final _search = TextEditingController();
  List<Map<String, dynamic>> _rows = const [];
  late String _filter = widget.spec.filters.isEmpty ? '' : widget.spec.filters.first.$1;
  int _page = 1;
  int _totalPages = 1;
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  bool _notInPlan = false;
  bool _noAccess = false;
  int _seq = 0;

  DocListSpec get _spec => widget.spec;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  String _url(int page) {
    final uri = Uri.parse(_spec.path);
    final query = {
      ...uri.queryParameters,
      if (_filter.isNotEmpty && _spec.filterRow == null) _spec.filterParam: _filter,
      if (page > 1) 'page': '$page',
    };
    return uri.replace(queryParameters: query.isEmpty ? null : query).toString();
  }

  void _toast(String message) {
    showKToast(context, message, tone: KTone.negative);
  }

  /// Loads page 1. [spinner] false keeps the rows on screen (pull to refresh).
  Future<void> _load({bool spinner = true}) async {
    final seq = ++_seq;
    setState(() {
      _loadingMore = false;
      if (spinner) {
        _loading = true;
        _error = null;
        _notInPlan = false;
        _noAccess = false;
      }
    });
    try {
      final body = await widget.session.api.getData(_url(1));
      if (!mounted || seq != _seq) return;
      final paging = docPaging(body);
      setState(() {
        _rows = docRows(body, _spec.listKey);
        _page = 1;
        _totalPages = paging?.totalPages ?? 1;
        _loading = false;
        _error = null;
        _notInPlan = false;
        _noAccess = false;
      });
    } on ApiException catch (e) {
      if (!mounted || seq != _seq) return;
      if (_keepRows(spinner)) return _toast(e.message);
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _noAccess = !_notInPlan && e.status == 403;
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || seq != _seq) return;
      if (_keepRows(spinner)) return _toast('Could not reach the server.');
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  /// A refresh that fails while rows are on screen leaves them there and only toasts.
  bool _keepRows(bool spinner) => !spinner && _rows.isNotEmpty && !_loading && _error == null;

  Future<void> _more() async {
    if (_loadingMore) return;
    final seq = _seq;
    setState(() => _loadingMore = true);
    try {
      final body = await widget.session.api.getData(_url(_page + 1));
      if (!mounted || seq != _seq) return;
      final paging = docPaging(body);
      setState(() {
        _rows = [..._rows, ...docRows(body, _spec.listKey)];
        _page = paging?.page ?? _page + 1;
        _totalPages = paging?.totalPages ?? _page;
      });
    } on ApiException catch (e) {
      if (mounted && seq == _seq) _toast(e.message);
    } catch (_) {
      if (mounted && seq == _seq) _toast('Could not load more. Try again.');
    } finally {
      if (mounted && seq == _seq) setState(() => _loadingMore = false);
    }
  }

  void _setFilter(String value) {
    if (value == _filter) return;
    setState(() => _filter = value);
    if (_spec.filterRow == null) _load();
  }

  Future<void> _create() async {
    final saved = await _spec.onCreate!(context);
    if (saved == true && mounted) _load(spinner: false);
  }

  Future<void> _open(Map<String, dynamic> row) async {
    final saved = await _spec.onOpen!(context, row);
    if (saved == true && mounted) _load(spinner: false);
  }

  Future<void> _actions(Map<String, dynamic> row) async {
    final actions = _spec.rowActions?.call(row) ?? const <DocAction>[];
    if (actions.isEmpty) return;
    final picked = await showKSheet<DocAction>(
      context,
      title: _spec.titleOf(row),
      scrollable: true,
      builder: (ctx) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final a in actions)
            KSheetAction(icon: a.icon, label: a.label, danger: a.danger, onTap: () => Navigator.of(ctx).pop(a)),
        ],
      ),
    );
    if (picked == null || !mounted) return;
    final reload = await picked.run(context);
    if (reload == true && mounted) _load(spinner: false);
  }

  static String _dayLabel(DateTime d) {
    final today = dateOnly(DateTime.now());
    final day = dateOnly(d);
    if (day == today) return 'Today';
    if (day == today.subtract(const Duration(days: 1))) return 'Yesterday';
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return day.year == today.year ? '${weekdays[day.weekday - 1]}, ${dMMM(day)}' : ddMMMyyyy(day);
  }

  @override
  Widget build(BuildContext context) {
    final content = Stack(
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (!widget.embedded) KBackBar(_spec.title),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, 0),
              child: KSearchField(
                controller: _search,
                hint: 'Search ${_spec.title.toLowerCase()}',
                onChanged: (_) => setState(() {}),
              ),
            ),
            if (_spec.filters.isNotEmpty) ...[
              const SizedBox(height: AppSpace.md),
              KChipBar<String>(value: _filter, options: _spec.filters, onChanged: _setFilter),
            ],
            const SizedBox(height: AppSpace.sm),
            Expanded(child: _body()),
          ],
        ),
        if (_spec.onCreate != null && _spec.createLabel != null && !_loading && _error == null)
          Positioned(
            right: AppSpace.gutter,
            bottom: AppSpace.lg,
            child: KFab(label: _spec.createLabel!, onTap: _create),
          ),
      ],
    );
    if (widget.embedded) return content;
    return Scaffold(backgroundColor: AppColors.bg, body: SafeArea(child: content));
  }

  Widget _body() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (_error != null) {
      return ListView(children: [
        if (_notInPlan)
          const KEmptyState(icon: LucideIcons.lock, title: 'Not included in your current plan')
        else if (_noAccess)
          const KEmptyState(icon: LucideIcons.lock, title: 'You do not have access to this')
        else
          KEmptyState(
            icon: LucideIcons.cloudOff,
            title: 'Could not load ${_spec.title.toLowerCase()}',
            body: _error,
            action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
          ),
      ]);
    }

    final byChip = _spec.filterRow;
    final rows = byChip == null || _filter.isEmpty ? _rows : [for (final r in _rows) if (byChip(r, _filter)) r];
    final shown = filterDocs(rows, _search.text, _spec.searchKeys);
    final dated = <(DateTime, Map<String, dynamic>)>[];
    final undated = <Map<String, dynamic>>[];
    for (final r in shown) {
      final d = docRowDate(r);
      if (d == null) {
        undated.add(r);
      } else {
        dated.add((d, r));
      }
    }
    final groups = <(String, List<Map<String, dynamic>>)>[];
    for (final (d, r) in dated) {
      final label = _dayLabel(d);
      if (groups.isNotEmpty && groups.last.$1 == label) {
        groups.last.$2.add(r);
      } else {
        groups.add((label, [r]));
      }
    }

    final searching = _search.text.trim().isNotEmpty;
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: () => _load(spinner: false),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: 112),
        children: [
          if (shown.isEmpty && _page >= _totalPages)
            KEmptyState(
              icon: _spec.icon,
              title: searching ? 'Nothing matches your search' : (_spec.emptyTitle ?? 'No ${_spec.title.toLowerCase()} yet'),
              body: searching ? 'Try another word.' : _spec.emptyBody,
            )
          else ...[
            for (final (label, rows) in groups) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter + 2, AppSpace.lg, AppSpace.gutter + 2, AppSpace.sm),
                child: Text(label.toUpperCase(), style: AppText.overline),
              ),
              _card(rows),
            ],
            if (undated.isNotEmpty)
              Padding(
                padding: EdgeInsets.only(top: groups.isEmpty ? AppSpace.xs : AppSpace.lg),
                child: _card(undated),
              ),
            if (_page < _totalPages)
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.lg, AppSpace.gutter, 0),
                child: KButton.secondary(label: 'Show more', loading: _loadingMore, onPressed: _more),
              ),
          ],
        ],
      ),
    );
  }

  Widget _card(List<Map<String, dynamic>> rows) {
    return KCard(
      margin: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
      child: KDivided(indent: 66, children: [for (final r in rows) _row(r)]),
    );
  }

  Widget _row(Map<String, dynamic> row) {
    final amount = _spec.amountOf?.call(row);
    final status = _spec.statusOf?.call(row);
    final hasStatus = status != null && status.isNotEmpty;
    final hasActions = _spec.rowActions != null;
    return KListRow(
      title: _spec.titleOf(row),
      subtitle: _spec.subtitleOf?.call(row),
      leading: KAvatar(name: '', icon: _spec.icon, muted: true),
      trailing: amount == null && !hasStatus
          ? null
          : Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (amount != null)
                  Text(
                    '${amount < 0 ? '-' : ''}$rupeeSign${enIn(amount.abs(), maxFraction: 2)}',
                    style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular),
                  ),
                if (hasStatus) ...[
                  if (amount != null) const SizedBox(height: 2),
                  KStatusDot.status(status),
                ],
              ],
            ),
      onTap: _spec.onOpen == null ? null : () => _open(row),
      onLongPress: hasActions ? () => _actions(row) : null,
    );
  }
}
