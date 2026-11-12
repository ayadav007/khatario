import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import 'report_period.dart';

/// One column shown when a row is opened. [money] cells get the rupee sign, [qty] cells plain grouped digits.
class ReportColumn {
  const ReportColumn(this.label, this.key, {this.money = false, this.qty = false});

  final String label, key;
  final bool money, qty;
}

/// A choice drawn under the period bar. The chosen value is sent as `queryName=value`, except when it is
/// [omitValue] (the "All" option), which sends nothing. [initial] defaults to the first option.
class ReportFilter {
  const ReportFilter(this.label, this.queryName, this.options, {this.initialValue, this.omitValue});

  final String label, queryName;
  final List<(String value, String label)> options;
  final String? omitValue;
  final String? initialValue;

  String get initial => initialValue ?? options.first.$1;
}

/// Describes one report. [TableReportScreen] draws it: headline tiles, a period bar and a table of rows.
class TableReportSpec {
  const TableReportSpec({
    required this.title,
    required this.path,
    this.period = ReportPeriodKind.range,
    this.tiles = const [],
    required this.rowsKey,
    required this.rowTitle,
    this.rowSubtitle,
    required this.rowAmountKey,
    this.columns = const [],
    this.extraQuery,
    this.onOpenRow,
    this.openRowIdKey,
    this.sections = const [],
    this.countTiles = const {},
    this.fromKey = 'from_date',
    this.toKey = 'to_date',
    this.asOnKey = 'as_on_date',
    this.longFinancialYear = false,
    this.rowAmountText,
    this.emptyTitle,
    this.emptyBody,
    this.emptyActionLabel,
    this.onEmptyAction,
    this.filters = const [],
    this.periodOptional = false,
    this.toSuffix = '',
    this.onOpenSectionRow,
    this.onLoaded,
    this.notice,
  });

  final String title, path, rowsKey, rowAmountKey;
  final ReportPeriodKind period;

  /// (label, dotted key into the reply), e.g. `('Total sales', 'summary.total_sales')`.
  final List<(String label, String key)> tiles;
  final String Function(Map<String, dynamic> row) rowTitle;
  final String Function(Map<String, dynamic> row)? rowSubtitle;

  /// Listed in a sheet when a row is tapped, unless [onOpenRow] is set.
  final List<ReportColumn> columns;

  /// Extra query text such as `party_id=3`. Blank adds nothing.
  final String Function()? extraQuery;
  final void Function(BuildContext context, Map<String, dynamic> row)? onOpenRow;

  /// The field [onOpenRow] opens a record by. A row without it (a cash sale has no customer) is not drawn as tappable.
  final String? openRowIdKey;

  /// Extra tables from the same reply, drawn below the main one: (header, rows key).
  final List<(String title, String rowsKey)> sections;

  /// Tile keys (from [tiles]) drawn as plain numbers, without the rupee sign.
  final Set<String> countTiles;

  /// Query names the route reads. The defaults suit most reports; some stock routes read `from`/`to`
  /// or `as_of` instead.
  final String fromKey, toKey, asOnKey;

  /// Sends the financial year as `2026-2027` (the code the server registers) instead of `2026-27`.
  final bool longFinancialYear;

  /// Text drawn at the end of each row instead of the rupee amount at [rowAmountKey]
  /// (quantity reports, or a table whose rows hold different measures).
  final String Function(Map<String, dynamic> row)? rowAmountText;

  /// Replaces "Nothing for this period" when the reply holds no rows, with an optional action.
  final String? emptyTitle, emptyBody, emptyActionLabel;
  final void Function(BuildContext context)? onEmptyAction;

  /// Choices drawn under the period bar; each adds its own query name. Empty changes nothing.
  final List<ReportFilter> filters;

  /// A [ReportPeriodKind.range] report that starts with no dates ("All time") and sends none until the
  /// user picks dates.
  final bool periodOptional;

  /// Text added to the end of the `to` date (`T23:59:59` for routes that compare it with a timestamp).
  final String toSuffix;

  /// Like [onOpenRow] for the rows of [sections]; [section] is the index in [sections]. Rows of a section
  /// fall back to [onOpenRow] when this is null.
  final void Function(BuildContext context, int section, Map<String, dynamic> row)? onOpenSectionRow;

  /// Called with the reply after every successful load.
  final void Function(dynamic body)? onLoaded;

  /// A line of caption text above the list, drawn from the reply. Null or empty draws nothing.
  final String? Function(dynamic body)? notice;
}

const _dash = '—';

/// A cell as text: money with the rupee sign, qty grouped, anything else as text. Missing or unparseable gives a dash.
String reportCellText(dynamic value, {bool money = false, bool qty = false}) {
  if (money || qty) {
    final n = docNum(value);
    if (n == null) return _dash;
    final digits = enIn(n.abs(), maxFraction: 2);
    return money ? '${n < 0 ? '-' : ''}$rupeeSign$digits' : '${n < 0 ? '-' : ''}$digits';
  }
  final text = docText(value);
  return text.isEmpty ? _dash : text;
}

/// Shared report screen: tiles, period bar, search and a table of rows.
class TableReportScreen extends StatefulWidget {
  const TableReportScreen({super.key, required this.session, required this.spec});

  final AppSession session;
  final TableReportSpec spec;

  @override
  State<TableReportScreen> createState() => _TableReportScreenState();
}

class _TableReportScreenState extends State<TableReportScreen> {
  final _search = TextEditingController();
  late final DateTime _today = dateOnly(DateTime.now());
  late ReportPeriod _range = ReportPeriod.of('this_month', _today);
  late MonthPeriod _month = MonthPeriod.of(_today);
  late FinancialYear _fy = FinancialYear.of(_today);
  late DateTime _asOn = _today;
  late bool _rangeOn = !_spec.periodOptional;
  late final Map<String, String> _filterValues = {for (final f in _spec.filters) f.queryName: f.initial};

  dynamic _body;
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  bool _noAccess = false;
  int _seq = 0;

  /// Rows of later pages (`pagination` in the reply), appended below the first page's rows.
  List<Map<String, dynamic>> _more = [];
  bool _loadingMore = false;

  TableReportSpec get _spec => widget.spec;

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

  String? get _periodQuery => switch (_spec.period) {
        ReportPeriodKind.none => null,
        ReportPeriodKind.range => _rangeOn ? '${_spec.fromKey}=${_range.fromIso}&${_spec.toKey}=${_range.toIso}${_spec.toSuffix}' : null,
        ReportPeriodKind.month => _month.query,
        ReportPeriodKind.financialYear => _spec.longFinancialYear ? 'financial_year=${_fy.longCode}' : _fy.query,
        ReportPeriodKind.asOn => '${_spec.asOnKey}=${ymd(_asOn)}',
      };

  String _url({int? page}) {
    final extra = _spec.extraQuery?.call().trim() ?? '';
    final query = [
      ?_periodQuery,
      for (final f in _spec.filters)
        if (_filterValues[f.queryName] != f.omitValue) '${f.queryName}=${Uri.encodeQueryComponent(_filterValues[f.queryName]!)}',
      if (extra.isNotEmpty) extra,
      if (page != null) 'page=$page',
    ].join('&');
    if (query.isEmpty) return _spec.path;
    return '${_spec.path}${_spec.path.contains('?') ? '&' : '?'}$query';
  }

  Future<void> _load({bool spinner = true}) async {
    final seq = ++_seq;
    if (spinner) {
      setState(() {
        _loading = true;
        _error = null;
        _notInPlan = false;
        _noAccess = false;
      });
    }
    try {
      final body = await widget.session.api.getData(_url());
      if (!mounted || seq != _seq) return;
      _spec.onLoaded?.call(body);
      setState(() {
        _body = body;
        _more = [];
        _loading = false;
        _error = null;
        _notInPlan = false;
        _noAccess = false;
      });
    } on ApiException catch (e) {
      if (!mounted || seq != _seq) return;
      if (_keepBody(spinner)) return showKToast(context, e.message, tone: KTone.negative);
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _noAccess = !_notInPlan && e.status == 403;
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || seq != _seq) return;
      if (_keepBody(spinner)) return showKToast(context, 'Could not reach the server.', tone: KTone.negative);
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  Future<void> _showMore(int nextPage) async {
    if (_loadingMore) return;
    final seq = _seq;
    setState(() => _loadingMore = true);
    try {
      final body = await widget.session.api.getData(_url(page: nextPage));
      if (!mounted || seq != _seq) return;
      setState(() {
        _more = [..._more, ...docRows(readPath(body, _spec.rowsKey), '')];
        final paging = docPaging(body);
        if (paging != null && _body is Map) {
          _body = {...(_body as Map), 'pagination': (_body as Map)['pagination'] is Map ? {...(_body as Map)['pagination'] as Map, 'page': paging.page, 'totalPages': paging.totalPages} : {'page': paging.page, 'totalPages': paging.totalPages}};
        }
      });
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not reach the server.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  /// A pull to refresh that fails while a report is on screen leaves it there and only toasts.
  bool _keepBody(bool spinner) => !spinner && _body != null && !_loading && _error == null;

  void _setPeriod(VoidCallback change) {
    setState(change);
    _load();
  }

  Widget _periodBar() {
    switch (_spec.period) {
      case ReportPeriodKind.none:
        return const SizedBox.shrink();
      case ReportPeriodKind.range:
        final bar = ReportPeriodBar(period: _range, onChanged: (p) => _setPeriod(() => _range = p));
        if (!_spec.periodOptional) return bar;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KChipBar<bool>(
              value: _rangeOn,
              options: const [(false, 'All time'), (true, 'Choose dates')],
              onChanged: (on) => _setPeriod(() => _rangeOn = on),
            ),
            if (_rangeOn) bar,
          ],
        );
      case ReportPeriodKind.month:
        return MonthPeriodBar(period: _month, onChanged: (p) => _setPeriod(() => _month = p));
      case ReportPeriodKind.financialYear:
        return FinancialYearBar(period: _fy, onChanged: (p) => _setPeriod(() => _fy = p));
      case ReportPeriodKind.asOn:
        return AsOnDateBar(date: _asOn, onChanged: (d) => _setPeriod(() => _asOn = d));
    }
  }

  Widget _filterBar() {
    if (_spec.filters.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final f in _spec.filters) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpace.gutter + 2, AppSpace.xs, AppSpace.gutter, AppSpace.xs),
            child: Text(f.label, style: AppText.caption),
          ),
          KChipBar<String>(
            value: _filterValues[f.queryName],
            options: f.options,
            onChanged: (v) => _setPeriod(() => _filterValues[f.queryName] = v),
          ),
        ],
        const SizedBox(height: AppSpace.sm),
      ],
    );
  }

  List<Map<String, dynamic>> _filtered(List<Map<String, dynamic>> rows) {
    final q = _search.text.trim().toLowerCase();
    if (q.isEmpty) return rows;
    return [
      for (final r in rows)
        if (_spec.rowTitle(r).toLowerCase().contains(q) || (_spec.rowSubtitle?.call(r) ?? '').toLowerCase().contains(q)) r,
    ];
  }

  Future<void> _open(Map<String, dynamic> row, {int? section}) async {
    if (section != null && _spec.onOpenSectionRow != null) {
      _spec.onOpenSectionRow!(context, section, row);
      return;
    }
    if (_spec.onOpenRow != null && _hasRecord(row)) {
      _spec.onOpenRow!(context, row);
      return;
    }
    if (_spec.columns.isEmpty) return;
    final title = _spec.rowTitle(row);
    await showKSheet<void>(
      context,
      title: title.isEmpty ? _dash : title,
      scrollable: true,
      builder: (_) => Padding(
        padding: const EdgeInsets.fromLTRB(AppSpace.xl, AppSpace.sm, AppSpace.xl, AppSpace.lg),
        child: KDivided(children: [
          for (final c in _spec.columns)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpace.md),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: Text(c.label, style: AppText.caption)),
                  const SizedBox(width: AppSpace.md),
                  Flexible(
                    child: Text(
                      reportCellText(readPath(row, c.key), money: c.money, qty: c.qty),
                      textAlign: TextAlign.end,
                      style: AppText.bodyStrong.copyWith(fontFeatures: c.money || c.qty ? AppText.tabular : null),
                    ),
                  ),
                ],
              ),
            ),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(_spec.title),
            _periodBar(),
            _filterBar(),
            Expanded(child: _content()),
          ],
        ),
      ),
    );
  }

  Widget _content() {
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

    final rows = [...docRows(readPath(_body, _spec.rowsKey), ''), ..._more];
    final paging = docPaging(_body);
    final shown = _filtered(rows);
    final searching = _search.text.trim().isNotEmpty;
    final rawSections = [for (final (_, key) in _spec.sections) docRows(readPath(_body, key), '')];
    final sections = [
      for (final (i, (title, _)) in _spec.sections.indexed) (title, _filtered(rawSections[i])),
    ];
    final nothingAtAll = rows.isEmpty && rawSections.every((r) => r.isEmpty);
    final nothingMatches = !nothingAtAll && shown.isEmpty && sections.every((s) => s.$2.isEmpty);
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: () => _load(spinner: false),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.xxl),
        children: [
          if (_spec.tiles.isNotEmpty) ...[_tiles(), const SizedBox(height: AppSpace.lg)],
          if (_spec.notice?.call(_body) case final note? when note.isNotEmpty) ...[
            Text(note, style: AppText.caption),
            const SizedBox(height: AppSpace.md),
          ],
          if (!nothingAtAll || searching) ...[
            KSearchField(controller: _search, hint: 'Search ${_spec.title.toLowerCase()}', onChanged: (_) => setState(() {})),
            const SizedBox(height: AppSpace.md),
          ],
          if (nothingAtAll)
            KEmptyState(
              icon: LucideIcons.fileText,
              title: _spec.emptyTitle ?? 'Nothing for this period',
              body: _spec.emptyBody,
              action: _spec.emptyActionLabel == null || _spec.onEmptyAction == null
                  ? null
                  : KButton.secondary(label: _spec.emptyActionLabel!, expand: false, onPressed: () => _spec.onEmptyAction!(context)),
            )
          else if (nothingMatches)
            const KEmptyState(icon: LucideIcons.search, title: 'Nothing matches your search', body: 'Try another word.')
          else if (shown.isNotEmpty)
            _table(shown),
          for (final (i, (title, secRows)) in sections.indexed)
            if (secRows.isNotEmpty) ...[
              const SizedBox(height: AppSpace.xl),
              KSectionHeader(title),
              _table(secRows, section: i),
            ],
          if (paging != null && paging.page < paging.totalPages && !searching) ...[
            const SizedBox(height: AppSpace.lg),
            KButton.secondary(label: 'Show more', loading: _loadingMore, onPressed: () => _showMore(paging.page + 1)),
          ],
        ],
      ),
    );
  }

  Widget _tiles() {
    final tiles = _spec.tiles;
    return Column(
      children: [
        for (var i = 0; i < tiles.length; i += 2) ...[
          if (i > 0) const SizedBox(height: AppSpace.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _tile(tiles[i])),
              const SizedBox(width: AppSpace.md),
              Expanded(child: i + 1 < tiles.length ? _tile(tiles[i + 1]) : const SizedBox.shrink()),
            ],
          ),
        ],
      ],
    );
  }

  Widget _tile((String, String) tile) {
    final n = docNum(readPath(_body, tile.$2));
    return KCard(
      padding: const EdgeInsets.all(AppSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(tile.$1, style: AppText.caption, maxLines: 1, overflow: TextOverflow.ellipsis),
          const SizedBox(height: AppSpace.xs),
          if (n == null)
            Text(_dash, style: AppText.amount)
          else if (_spec.countTiles.contains(tile.$2))
            Text(enIn(n, maxFraction: 2), style: AppText.amount, maxLines: 1, overflow: TextOverflow.ellipsis)
          else
            KAmount(n, style: AppText.amount, maxFraction: 2),
        ],
      ),
    );
  }

  Widget _table(List<Map<String, dynamic>> rows, {int? section}) {
    return KCard(child: KDivided(children: [for (final r in rows) _row(r, section: section)]));
  }

  bool _hasRecord(Map<String, dynamic> row) {
    final key = _spec.openRowIdKey;
    return key == null || docText(row[key]).isNotEmpty;
  }

  Widget _row(Map<String, dynamic> row, {int? section}) {
    final title = _spec.rowTitle(row);
    final subtitle = _spec.rowSubtitle?.call(row);
    final tappable = (_spec.onOpenRow != null && _hasRecord(row)) || (section != null && _spec.onOpenSectionRow != null) || _spec.columns.isNotEmpty;
    return KListRow(
      title: title.isEmpty ? _dash : title,
      subtitle: subtitle,
      trailing: Text(
        _spec.rowAmountText?.call(row) ?? reportCellText(readPath(row, _spec.rowAmountKey), money: true),
        style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular),
      ),
      onTap: tappable ? () => _open(row, section: section) : null,
    );
  }
}
