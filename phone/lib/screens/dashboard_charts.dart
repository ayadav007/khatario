import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../api.dart';
import '../format.dart';
import '../shell/date_range.dart';
import '../theme.dart';
import '../ui/web_ui.dart';

/// `lib/chartTheme.ts` light palette.
class _Palette {
  static const grid = Color(0xFFE5E7EB);
  static const gridStrong = Color(0xFFD1D5DB);
  static const axis = Color(0xFF6B7280);
  static const labelStrong = Color(0xFF374151);
  static const zeroLine = Color(0xFF6B7280);
  static const pointStroke = Colors.white;
}

/// `useDashboardChartHeight(150, 240)` at the mobile breakpoint.
const _plotHeight = 150.0;

enum _Anchor { start, middle, end }

/// SVG `<text>`: (x, y) is the baseline point of the anchor.
void _svgText(
  Canvas canvas,
  String text,
  double x,
  double y, {
  required double size,
  required Color color,
  FontWeight weight = FontWeight.w400,
  _Anchor anchor = _Anchor.start,
  double rotateDeg = 0,
}) {
  final tp = TextPainter(
    text: TextSpan(text: text, style: TextStyle(fontFamily: KhatarioColors.fontFamily, fontSize: size, color: color, fontWeight: weight)),
    textDirection: TextDirection.ltr,
  )..layout();
  final baseline = tp.computeDistanceToActualBaseline(TextBaseline.alphabetic);
  final dx = switch (anchor) {
    _Anchor.start => 0.0,
    _Anchor.middle => -tp.width / 2,
    _Anchor.end => -tp.width,
  };
  canvas.save();
  canvas.translate(x, y);
  if (rotateDeg != 0) canvas.rotate(rotateDeg * math.pi / 180);
  tp.paint(canvas, Offset(dx, -baseline));
  canvas.restore();
}

void _dashedLine(Canvas canvas, Offset a, Offset b, Paint paint, double dash, double gap) {
  final total = (b - a).distance;
  final dir = (b - a) / total;
  var d = 0.0;
  while (d < total) {
    final end = math.min(d + dash, total);
    canvas.drawLine(a + dir * d, a + dir * end, paint);
    d += dash + gap;
  }
}

/// `Card padding="none" className="overflow-hidden border border-border !shadow-none"`.
class _ChartCard extends StatelessWidget {
  const _ChartCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        boxShadow: AppShadow.card,
      ),
      child: Padding(padding: const EdgeInsets.all(4), child: child),
    );
  }
}

class _ChartLoading extends StatelessWidget {
  const _ChartLoading();

  @override
  Widget build(BuildContext context) {
    return const _ChartCard(
      child: SizedBox(
        height: 144,
        child: Center(
          child: SizedBox(width: 28, height: 28, child: CircularProgressIndicator(strokeWidth: 2, color: KhatarioColors.ink)),
        ),
      ),
    );
  }
}

class _NoData extends StatelessWidget {
  const _NoData();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      height: 144,
      child: Center(
        child: Text('No data available', style: TextStyle(fontSize: 14, height: 20 / 14, color: KhatarioColors.muted)),
      ),
    );
  }
}

/// Copy of `components/dashboard/CashFlowChart.tsx`.
class CashFlowChart extends StatefulWidget {
  const CashFlowChart({super.key, required this.api});

  final KhatarioApi api;

  @override
  State<CashFlowChart> createState() => _CashFlowChartState();
}

class _CashFlowChartState extends State<CashFlowChart> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  late int _year;

  static int _currentFiscalYear() {
    final now = DateTime.now();
    return now.month <= 3 ? now.year - 1 : now.year;
  }

  @override
  void initState() {
    super.initState();
    _year = _currentFiscalYear();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() => _loading = true);
    try {
      final body = await widget.api.getJson('/api/dashboard/cash-flow?fiscal_year=$_year');
      if (mounted) setState(() => _data = body);
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map> _list(String key) => ((_data?[key] as List?) ?? const []).whereType<Map>().toList();

  @override
  Widget build(BuildContext context) {
    if (_loading) return const _ChartLoading();
    final months = _list('months');
    final chartSeries = _list('chart_series');
    final series = chartSeries.isNotEmpty ? chartSeries : months;
    final summary = _data?['summary'] is Map ? _data!['summary'] as Map : const {};
    final closings = months.map((m) => toNum(m['closing']).toDouble()).toList();
    final flat = months.length > 1 && (closings.reduce(math.max) - closings.reduce(math.min)).abs() < 0.01;
    final current = _currentFiscalYear();

    String inr(String key) => '₹${enIn(toNum(summary[key]), maxFraction: 2)}';

    return _ChartCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
            child: Row(
              children: [
                Text('Cash flow', style: AppText.bodyStrong),
                const SizedBox(width: 6),
                const Icon(LucideIcons.info, size: 14, color: KhatarioColors.muted),
                const Spacer(),
                WebSelect<int>(
                  value: _year,
                  options: [for (final y in [current, current - 1, current - 2]) (y, 'FY $y-${y + 1}')],
                  onChanged: (y) {
                    _year = y;
                    _fetch();
                  },
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          if (_data == null || months.isEmpty) const _NoData() else _CashFlowPlot(series: series, rotateLabels: months.length > 6),
          if (_data != null && flat)
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 6, 4, 0),
              child: Text.rich(
                const TextSpan(children: [
                  TextSpan(text: 'The line shows '),
                  TextSpan(text: 'cash at each month-end', style: TextStyle(fontWeight: FontWeight.w700)),
                  TextSpan(
                      text: ' (opening + in − out, month by month). If it looks flat, your receipts and payments are mostly in '),
                  TextSpan(text: 'one', style: TextStyle(fontWeight: FontWeight.w700)),
                  TextSpan(
                      text:
                          ' month, so the balance does not change in other months. Hover a point to see the amount for that month.'),
                ]),
                style: const TextStyle(fontSize: 10, height: 14 / 10, color: KhatarioColors.muted),
              ),
            ),
          Container(
            margin: EdgeInsets.zero,
            padding: const EdgeInsets.all(12),
            decoration: const BoxDecoration(border: Border(top: BorderSide(color: KhatarioColors.line))),
            child: Column(
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: _CashStat(label: 'Cash as on ${ddMMyyyySlash(DateTime(_year, 4, 1))}', value: inr('opening_balance'))),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _CashStat(label: 'Incoming', value: '+ ${inr('total_incoming')}', color: Tw.green600),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: _CashStat(label: 'Outgoing', value: '- ${inr('total_outgoing')}', color: Tw.red600)),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _CashStat(
                        label: 'Cash as on ${ddMMyyyySlash(DateTime(_year + 1, 3, 31))}',
                        value: inr('closing_balance'),
                        prefix: '= ',
                        color: Tw.gray900,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CashStat extends StatelessWidget {
  const _CashStat({required this.label, required this.value, this.color = KhatarioColors.ink, this.prefix});

  final String label;
  final String value;
  final Color color;

  /// Rendered in `text-text-secondary` before the value.
  final String? prefix;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontSize: 10, height: 1.25, color: KhatarioColors.inkSecondary)),
        const SizedBox(height: 2),
        Text.rich(
          TextSpan(children: [
            if (prefix != null) TextSpan(text: prefix, style: const TextStyle(color: KhatarioColors.inkSecondary)),
            TextSpan(text: value),
          ]),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 14,
            height: 20 / 14,
            fontWeight: FontWeight.w700,
            color: color,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
      ],
    );
  }
}

class _CashFlowPlot extends StatelessWidget {
  const _CashFlowPlot({required this.series, required this.rotateLabels});

  final List<Map> series;
  final bool rotateLabels;

  @override
  Widget build(BuildContext context) {
    final painter = _CashFlowPainter(series: series, rotateLabels: rotateLabels);
    return AspectRatio(
      aspectRatio: painter.svgWidth / painter.svgHeight,
      child: CustomPaint(painter: painter),
    );
  }
}

class _CashFlowPainter extends CustomPainter {
  _CashFlowPainter({required this.series, required this.rotateLabels});

  final List<Map> series;
  final bool rotateLabels;

  static const _width = 800.0;
  static const _height = _plotHeight;
  static const _chartPadding = _plotHeight < 200 ? 44.0 : 52.0;
  static const _paddingTop = 4.0;

  double get _bottomPadding => series.length > 7 ? 28 : 16;
  double get svgHeight => _height + (series.length > 7 ? 40 : 0);
  double get svgWidth => math.max(_width, series.length * 70.0);

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / svgWidth);
    final values = <double>[
      for (final m in series) ...[
        toNum(m['opening']).toDouble(),
        toNum(m['closing']).toDouble(),
        toNum(m['incoming']).toDouble(),
        toNum(m['outgoing']).toDouble(),
      ],
    ];
    final minValue = math.min(values.fold<double>(double.infinity, math.min), 0.0);
    final maxValue = math.max(values.fold<double>(-double.infinity, math.max), 1000.0);
    final pad = (maxValue - minValue) * 0.1;
    final adjMin = minValue - pad;
    final adjMax = maxValue + pad;
    final adjRange = adjMax - adjMin;
    final chartWidth = _width - _chartPadding * 2;
    final chartHeight = _height - _paddingTop - _bottomPadding;

    final points = <(double, double, String)>[];
    for (var i = 0; i < series.length; i++) {
      final m = series[i];
      final x = _chartPadding + (i / (series.length - 1 == 0 ? 1 : series.length - 1)) * chartWidth;
      final y = _paddingTop + chartHeight - ((toNum(m['closing']) - adjMin) / adjRange) * chartHeight;
      final key = m['month']?.toString() ?? '';
      String label;
      if (key == 'opening') {
        label = 'Open';
      } else {
        final parts = key.split('-');
        label = parts.length == 2 ? mmmYY(DateTime(int.parse(parts[0]), int.parse(parts[1]))) : key;
      }
      points.add((x, y, label));
    }

    String axisLabel(double v) {
      if (v.abs() >= 100000) return '₹${(v / 100000).toStringAsFixed(1)}L';
      if (v.abs() >= 1000) return '₹${(v / 1000).toStringAsFixed(1)}K';
      return '₹${v.round()}';
    }

    const numLabels = 6;
    final labels = <(double, String, double)>[
      for (var i = 0; i < numLabels; i++)
        (
          _paddingTop + (i / (numLabels - 1)) * chartHeight,
          axisLabel(adjMin + (adjRange * (numLabels - 1 - i)) / (numLabels - 1)),
          adjMin + (adjRange * (numLabels - 1 - i)) / (numLabels - 1),
        ),
    ];
    final spansZero = adjMin <= 0 && adjMax >= 0;
    final zeroY = spansZero ? _paddingTop + chartHeight - ((0 - adjMin) / adjRange) * chartHeight : null;
    if (spansZero && !labels.any((l) => l.$3.abs() < 0.01)) {
      labels.add((zeroY!, '₹0', 0));
      labels.sort((a, b) => b.$1.compareTo(a.$1));
    }

    if (zeroY != null) {
      final p = Paint()
        ..color = _Palette.zeroLine.withValues(alpha: 0.8)
        ..strokeWidth = 2;
      _dashedLine(canvas, Offset(_chartPadding, zeroY), Offset(_width - _chartPadding, zeroY), p, 5, 5);
    }
    for (final l in labels) {
      final isZero = l.$3 == 0;
      final p = Paint()
        ..color = isZero ? _Palette.gridStrong : _Palette.grid
        ..strokeWidth = isZero ? 1.5 : 1;
      final a = Offset(_chartPadding, l.$1);
      final b = Offset(_width - _chartPadding, l.$1);
      if (isZero) {
        _dashedLine(canvas, a, b, p, 4, 4);
      } else {
        canvas.drawLine(a, b, p);
      }
    }
    for (final l in labels) {
      final isZero = l.$3 == 0;
      _svgText(canvas, l.$2, _chartPadding - 10, l.$1 + 4,
          size: 10,
          color: isZero ? _Palette.labelStrong : _Palette.axis,
          weight: isZero ? FontWeight.w700 : FontWeight.w400,
          anchor: _Anchor.end);
    }

    if (points.isNotEmpty) {
      final path = Path()..moveTo(points.first.$1, points.first.$2);
      for (final p in points.skip(1)) {
        path.lineTo(p.$1, p.$2);
      }
      canvas.drawPath(
        path,
        Paint()
          ..style = PaintingStyle.stroke
          ..color = KhatarioColors.ink
          ..strokeWidth = 2.5
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round,
      );
    }
    final fill = Paint()..color = KhatarioColors.ink;
    final ring = Paint()
      ..style = PaintingStyle.stroke
      ..color = _Palette.pointStroke
      ..strokeWidth = 2;
    for (final p in points) {
      canvas.drawCircle(Offset(p.$1, p.$2), 5, fill);
      canvas.drawCircle(Offset(p.$1, p.$2), 5, ring);
    }
    for (final p in points) {
      _svgText(canvas, p.$3, p.$1, rotateLabels ? _height + 30 : _height - 5,
          size: 11, color: _Palette.labelStrong, weight: FontWeight.w500, anchor: _Anchor.middle, rotateDeg: rotateLabels ? -45 : 0);
    }
  }

  @override
  bool shouldRepaint(covariant _CashFlowPainter old) => old.series != series;
}

enum _Period { d7, d30, d90, custom }

/// Copy of `components/dashboard/SalesVsPurchasesChart.tsx`.
class SalesVsPurchasesChart extends StatefulWidget {
  const SalesVsPurchasesChart({super.key, required this.api, required this.range, required this.onOpen});

  final KhatarioApi api;
  final DashboardRange range;
  final ValueChanged<String> onOpen;

  @override
  State<SalesVsPurchasesChart> createState() => _SalesVsPurchasesChartState();
}

class _SalesVsPurchasesChartState extends State<SalesVsPurchasesChart> {
  List<Map> _rows = const [];
  bool _loading = true;
  _Period _period = _Period.d30;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  @override
  void didUpdateWidget(SalesVsPurchasesChart old) {
    super.didUpdateWidget(old);
    if (old.range.start != widget.range.start || old.range.end != widget.range.end) _fetch();
  }

  Future<void> _fetch() async {
    setState(() => _loading = true);
    final today = dateOnly(DateTime.now());
    var start = ymd(today.subtract(const Duration(days: 30)));
    var end = ymd(today);
    switch (_period) {
      case _Period.d7:
        start = ymd(today.subtract(const Duration(days: 7)));
      case _Period.d30:
        break;
      case _Period.d90:
        start = ymd(today.subtract(const Duration(days: 90)));
      case _Period.custom:
        start = widget.range.start;
        end = widget.range.end;
    }
    try {
      final body = await widget.api.getJson('/api/dashboard/charts?start_date=$start&end_date=$end');
      if (mounted) setState(() => _rows = ((body['chartData'] as List?) ?? const []).whereType<Map>().toList());
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const _ChartLoading();
    return _ChartCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
            child: Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 8,
              runSpacing: 6,
              children: [
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 8,
                  runSpacing: 4,
                  children: const [
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(LucideIcons.chartColumn, size: 14, color: KhatarioColors.muted),
                        SizedBox(width: 6),
                        Text('Sales vs Purchases',
                            style: TextStyle(fontSize: 14, height: 20 / 14, fontWeight: FontWeight.w600, color: KhatarioColors.ink)),
                      ],
                    ),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _Legend(color: KhatarioColors.ink, label: 'Sales'),
                        SizedBox(width: 10),
                        _Legend(color: Color(0xFFF58220), label: 'Purchases'),
                      ],
                    ),
                  ],
                ),
                WebSelect<_Period>(
                  value: _period,
                  options: const [
                    (_Period.d7, 'Last 7 days'),
                    (_Period.d30, 'Last 30 days'),
                    (_Period.d90, 'Last 90 days'),
                    (_Period.custom, 'Custom'),
                  ],
                  onChanged: (p) {
                    _period = p;
                    _fetch();
                  },
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          if (_rows.isEmpty)
            const _NoData()
          else
            _SalesPurchasesPlot(
              rows: _rows,
              onBar: (kind) => widget.onOpen(kind == 'sales' ? 'Invoices for this day' : 'Purchases for this day'),
            ),
        ],
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 8, height: 8, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2))),
        const SizedBox(width: 4),
        Text(label, style: const TextStyle(fontSize: 10, height: 14 / 10, color: KhatarioColors.inkSecondary)),
      ],
    );
  }
}

class _SalesPurchasesPlot extends StatelessWidget {
  const _SalesPurchasesPlot({required this.rows, required this.onBar});

  final List<Map> rows;
  final ValueChanged<String> onBar;

  @override
  Widget build(BuildContext context) {
    final painter = _SalesPurchasesPainter(rows);
    return AspectRatio(
      aspectRatio: 800 / _plotHeight,
      child: LayoutBuilder(
        builder: (context, c) => GestureDetector(
          onTapUp: (d) {
            final scale = 800 / c.maxWidth;
            final kind = painter.hit(d.localPosition.dx * scale, d.localPosition.dy * scale);
            if (kind != null) onBar(kind);
          },
          child: CustomPaint(size: Size(c.maxWidth, c.maxHeight), painter: painter),
        ),
      ),
    );
  }
}

class _SalesPurchasesPainter extends CustomPainter {
  _SalesPurchasesPainter(this.rows);

  final List<Map> rows;

  static const _width = 800.0;
  static const _height = _plotHeight;
  static const _padding = _plotHeight < 200 ? 40.0 : 48.0;
  static const _paddingTop = 4.0;
  static const _paddingBottom = 22.0;
  static const _gap = 4.0;

  double get _chartWidth => _width - _padding * 2;
  double get _chartHeight => _height - _paddingTop - _paddingBottom;
  double get _barWidth => math.max(30, math.min(60, (_chartWidth / rows.length) * 0.6));
  double get _barSpacing => _chartWidth / rows.length;
  double get _half => (_barWidth - _gap) / 2;
  double get _max => rows.fold<double>(1000, (m, r) => math.max(m, math.max(toNum(r['sales']).toDouble(), toNum(r['purchases']).toDouble())));

  double _barHeight(double v) {
    final h = _max > 0 ? v / _max * _chartHeight : 0.0;
    return v > 0 && h < 2 ? 2 : h;
  }

  String? hit(double x, double y) {
    for (var i = 0; i < rows.length; i++) {
      final bx = _padding + i * _barSpacing + (_barSpacing - _barWidth) / 2;
      final s = toNum(rows[i]['sales']).toDouble();
      final p = toNum(rows[i]['purchases']).toDouble();
      final bottom = _paddingTop + _chartHeight;
      if (s > 0 && x >= bx && x <= bx + _half && y >= bottom - _barHeight(s) && y <= bottom) return 'sales';
      final px = bx + _half + _gap;
      if (p > 0 && x >= px && x <= px + _half && y >= bottom - _barHeight(p) && y <= bottom) return 'purchases';
    }
    return null;
  }

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / _width);
    final grid = Paint()
      ..color = _Palette.grid
      ..strokeWidth = 1;
    for (final ratio in const [0.0, 0.25, 0.5, 0.75, 1.0]) {
      final y = _paddingTop + _chartHeight * (1 - ratio);
      canvas.drawLine(Offset(_padding, y), Offset(_width - _padding, y), grid);
    }
    for (final ratio in const [0.0, 0.25, 0.5, 0.75, 1.0]) {
      final y = _paddingTop + _chartHeight * (1 - ratio);
      final value = (_max * ratio).round();
      _svgText(canvas, '₹${value > 1000 ? '${(value / 1000).toStringAsFixed(1)}k' : enIn(value)}', _padding - 10, y + 4,
          size: 11, color: _Palette.axis, anchor: _Anchor.end);
    }
    final every = (rows.length / 8).ceil();
    final bottom = _paddingTop + _chartHeight;
    for (var i = 0; i < rows.length; i++) {
      final r = rows[i];
      final s = toNum(r['sales']).toDouble();
      final p = toNum(r['purchases']).toDouble();
      final x = _padding + i * _barSpacing + (_barSpacing - _barWidth) / 2;
      if (s > 0) {
        final h = _barHeight(s);
        canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(x, bottom - h, _half, h), const Radius.circular(2)),
            Paint()..color = KhatarioColors.ink);
      }
      if (p > 0) {
        final h = _barHeight(p);
        canvas.drawRRect(
            RRect.fromRectAndRadius(Rect.fromLTWH(x + _half + _gap, bottom - h, _half, h), const Radius.circular(2)),
            Paint()..color = const Color(0xFFF58220));
      }
      if (i % every == 0 || i == rows.length - 1) {
        final d = DateTime.tryParse(r['date']?.toString() ?? '');
        if (d != null) {
          _svgText(canvas, mmmDD(d), x + _barWidth / 2, _height - 15, size: 10, color: _Palette.axis, anchor: _Anchor.middle);
        }
      }
    }
  }

  @override
  bool shouldRepaint(covariant _SalesPurchasesPainter old) => old.rows != rows;
}
