import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import 'hr_manage_widgets.dart';
import 'hr_more_logic.dart';
import 'pay_widgets.dart';

/// Website `/employees/performance`: each employee's sales for a period, against their target. The
/// four totals are the server's `summary`; nothing is added up on the phone. Needs advanced HR; the
/// server says `FEATURE_NOT_IN_PLAN` otherwise and this shows it.
class PerformanceScreen extends StatefulWidget {
  const PerformanceScreen({super.key, required this.session, this.now});

  final AppSession session;

  /// Today, for the default range (tests fix it).
  final DateTime? now;

  @override
  State<PerformanceScreen> createState() => _PerformanceScreenState();
}

class _PerformanceScreenState extends State<PerformanceScreen> with HrScreenState<PerformanceScreen> {
  late final DateTime _today = dateOnly(widget.now ?? DateTime.now());
  late DateTime _from = DateTime(_today.year, _today.month, 1);
  late DateTime _to = _today;
  String _period = 'monthly';
  List<PerformanceRow> _rows = const [];
  PerformanceSummary _summary = const PerformanceSummary();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() => guardedLoad(() async {
        final body = await widget.session.api.getJson(performancePath(period: _period, from: _from, to: _to));
        if (!mounted) return;
        _rows = performanceRows(body['performance']);
        _summary = PerformanceSummary.fromJson(body['summary']);
      });

  Widget _stat(String label, String value) => Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text(label, style: AppText.caption),
        Text(value, style: AppText.bodyStrong),
      ]);

  Widget _tile(String title, String value) => KCard(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text(title, style: AppText.caption),
          const SizedBox(height: 4),
          Text(value, style: AppText.title),
        ]),
      );

  Widget _row(PerformanceRow r) {
    final a = r.achievement;
    return KCard(
      padding: const EdgeInsets.all(14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(r.name, style: AppText.bodyStrong),
        Text([r.code, if (r.designation != null) r.designation!, if (r.date != null) ddMMMyyyy(r.date!)].join(' · '), style: AppText.caption),
        const SizedBox(height: AppSpace.sm),
        Wrap(spacing: 20, runSpacing: 10, children: [
          _stat('Sales', inr(r.sales)),
          _stat('Invoices', '${r.invoices}'),
          _stat('Avg invoice', inr(r.average)),
          _stat('Target', r.target == null ? '—' : inr(r.target!)),
          _stat('Achievement', a == null ? '—' : '${a.toStringAsFixed(1)}%'),
          _stat('Commission', inr(r.commission)),
        ]),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    return PayListPage(
      title: 'Performance',
      loading: loading,
      error: error,
      notInPlan: notInPlan,
      onRetry: _load,
      emptyTitle: 'No performance data found',
      emptyBody: 'Sales per employee for the chosen dates show up here.',
      emptyIcon: LucideIcons.chartColumn,
      header: [
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpace.sm),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            KSegmented<String>(
              value: _period,
              options: performancePeriods,
              onChanged: (v) {
                _period = v;
                _load();
              },
            ),
            const SizedBox(height: AppSpace.sm),
            Row(children: [
              Expanded(
                child: KDateField(label: 'Start date', value: _from, onChanged: (d) {
                  _from = d;
                  _load();
                }),
              ),
              const SizedBox(width: AppSpace.sm),
              Expanded(
                child: KDateField(label: 'End date', value: _to, onChanged: (d) {
                  _to = d;
                  _load();
                }),
              ),
            ]),
            const SizedBox(height: AppSpace.sm),
            HrTileGrid(tiles: [
              _tile('Total sales', inr(_summary.sales)),
              _tile('Total invoices', '${_summary.invoices}'),
              _tile('Total commission', inr(_summary.commission)),
              _tile('Active employees', '${_summary.employees}'),
            ]),
          ]),
        ),
      ],
      rows: [for (final r in _rows) _row(r)],
    );
  }
}
