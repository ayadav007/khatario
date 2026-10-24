import 'dart:math' as math;

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../api.dart';
import '../format.dart';
import '../session.dart';
import '../theme.dart';
import '../whatsapp_compose.dart';

/// `AVAILABLE_WIDGETS` from `components/dashboard/CustomizableDashboard.tsx`.
const _availableWidgets = <(String type, String title, String icon, String? featureId)>[
  ('sales_summary', 'Sales Summary', '📊', null),
  ('recent_invoices', 'Recent Invoices', '🧾', null),
  ('top_customers', 'Top Customers', '👥', null),
  ('cash_flow', 'Cash Flow', '💰', null),
  ('pending_payments', 'Pending Payments', '⏰', null),
  ('inventory_alerts', 'Inventory Alerts', '📦', null),
  ('sales_chart', 'Sales Chart', '📈', null),
  ('top_products', 'Top Products', '🏆', null),
  ('dead_stock', 'Dead Stock', '🧊', 'dead_stock_widget'),
];

/// JS `value.toLocaleString('en-IN')`: numbers are grouped, strings are printed as-is.
String _jsLocale(dynamic v) => v is String ? v : enIn(toNum(v));

/// JS template interpolation of a JSON value (`${n}`).
String _jsStr(dynamic v) {
  if (v is double && v == v.roundToDouble()) return v.toInt().toString();
  return v?.toString() ?? '';
}

/// Website: `body?.error || \`Request failed (${status})\``, or the fetch error message.
String _requestError(Object e, String fallback) {
  if (e is ApiException) return e.message;
  if (e is DioException && e.response != null) {
    final data = e.response!.data;
    final error = data is Map ? data['error']?.toString() : null;
    return error ?? 'Request failed (${e.response!.statusCode})';
  }
  return fallback;
}

const _textSm = TextStyle(fontSize: 14, height: 20 / 14);
const _loadingStyle = TextStyle(fontSize: 14, height: 20 / 14, color: Tw.gray500);

/// Copy of `components/dashboard/CustomizableDashboard.tsx` + `Widget.tsx` at the mobile breakpoint.
class CustomizableDashboard extends StatefulWidget {
  const CustomizableDashboard({super.key, required this.session, required this.enabledFeatures, required this.onOpen});

  final AppSession session;

  /// `useFeatureRegistry().enabledIds`; null while loading.
  final List<String>? enabledFeatures;
  final ValueChanged<String> onOpen;

  @override
  State<CustomizableDashboard> createState() => _CustomizableDashboardState();
}

class _CustomizableDashboardState extends State<CustomizableDashboard> {
  List<Map<String, dynamic>> _widgets = [];
  bool _loaded = false;
  bool _editMode = false;
  bool _saving = false;

  KhatarioApi get _api => widget.session.api;

  bool _hasFeature(String id) => widget.enabledFeatures?.contains(id) ?? false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await _api.getJson('/api/dashboard/widgets');
      final list = (body['widgets'] as List?) ?? const [];
      if (mounted) setState(() => _widgets = [for (final w in list.whereType<Map>()) Map<String, dynamic>.from(w)]);
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loaded = true);
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await _api.postJson('/api/dashboard/widgets', {'business_id': widget.session.businessId, 'widgets': _widgets});
      if (mounted) setState(() => _editMode = false);
    } on ApiException {
      // Website: a non-2xx response leaves edit mode open without a message.
    } on DioException catch (e) {
      if (e.response == null && mounted) _toastError('Failed to save dashboard layout');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _toastError(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message), backgroundColor: Tw.red600));
  }

  void _add(String type, String title) {
    setState(() {
      _widgets = [
        ..._widgets,
        {
          'id': 'widget-${DateTime.now().millisecondsSinceEpoch}',
          'type': type,
          'title': title,
          'position': {'x': 0, 'y': _widgets.length * 2},
          'size': {'width': 1, 'height': 1},
        },
      ];
    });
  }

  void _updateConfig(String id, Map<String, dynamic> config) {
    setState(() {
      _widgets = [
        for (final w in _widgets)
          if (w['id'] == id) {...w, 'config': {...((w['config'] as Map?) ?? const {}), ...config}} else w,
      ];
    });
  }

  Future<void> _openAddWidget() async {
    final available = _availableWidgets.where((w) => w.$4 == null || _hasFeature(w.$4!)).toList();
    final picked = await showDialog<(String, String)>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: 0.5),
      builder: (context) => _AddWidgetDialog(options: available),
    );
    if (picked != null) _add(picked.$1, picked.$2);
  }

  @override
  Widget build(BuildContext context) {
    if (_widgets.isEmpty && !_editMode) {
      return _EmptyStrip(onCustomize: _loaded ? () => setState(() => _editMode = true) : null);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text('My dashboard', maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.heading),
            ),
            const SizedBox(width: 8),
            if (!_editMode)
              _SmallButton(icon: LucideIcons.squarePen, label: 'Edit', onTap: () => setState(() => _editMode = true))
            else ...[
              _SmallButton(icon: LucideIcons.plus, label: 'Add', onTap: _openAddWidget),
              const SizedBox(width: 6),
              _SmallButton(icon: LucideIcons.save, label: _saving ? '…' : 'Save', primary: true, onTap: _saving ? null : _save),
              const SizedBox(width: 6),
              GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () => setState(() => _editMode = false),
                child: const Padding(
                  padding: EdgeInsets.all(6),
                  child: Icon(LucideIcons.x, size: 16, color: KhatarioColors.inkSecondary, semanticLabel: 'Cancel edit'),
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: 8),
        for (var i = 0; i < _widgets.length; i++) ...[
          if (i > 0) const SizedBox(height: 16),
          _WidgetFrame(
            key: ValueKey(_widgets[i]['id']),
            widget: _widgets[i],
            editMode: _editMode,
            onRemove: () => setState(() => _widgets = _widgets.where((w) => w['id'] != _widgets[i]['id']).toList()),
            onResize: (size) => setState(() {
              _widgets = [
                for (final w in _widgets)
                  if (w['id'] == _widgets[i]['id']) {...w, 'size': size} else w,
              ];
            }),
            child: _content(_widgets[i]),
          ),
        ],
      ],
    );
  }

  Widget _content(Map<String, dynamic> w) {
    final type = w['type']?.toString() ?? '';
    final gate = _availableWidgets.where((a) => a.$1 == type).firstOrNull;
    if (gate?.$4 != null && widget.enabledFeatures != null && !_hasFeature(gate!.$4!)) {
      return const Text(
        "This widget isn't available on your current plan. Contact your administrator to enable it, or remove the widget in edit mode.",
        style: TextStyle(fontSize: 14, height: 20 / 14, color: Tw.gray500),
      );
    }
    return switch (type) {
      'sales_summary' => _SalesSummaryWidget(api: _api),
      'recent_invoices' => _RecentInvoicesWidget(api: _api, onOpen: widget.onOpen),
      'top_customers' => _TopCustomersWidget(api: _api),
      'cash_flow' => _CashFlowWidget(api: _api),
      'pending_payments' => _PendingPaymentsWidget(api: _api, onOpen: widget.onOpen),
      'inventory_alerts' => _InventoryAlertsWidget(api: _api, onOpen: widget.onOpen),
      'sales_chart' => _SalesChartWidget(api: _api),
      'top_products' => _TopProductsWidget(api: _api),
      'dead_stock' => _DeadStockWidget(
          api: _api,
          config: (w['config'] as Map?) ?? const {},
          onConfigChange: (c) => _updateConfig(w['id'].toString(), c),
          onOpen: widget.onOpen,
        ),
      _ => const Text('Widget content', style: TextStyle(color: Tw.gray500)),
    };
  }
}

/// No saved widgets and not editing.
class _EmptyStrip extends StatelessWidget {
  const _EmptyStrip({required this.onCustomize});

  final VoidCallback? onCustomize;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      foregroundPainter: const _DashedRRectPainter(color: KhatarioColors.line, radius: 8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: KhatarioColors.background.withValues(alpha: 0.8),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          children: [
            const Icon(LucideIcons.panelsTopLeft, size: 16, color: KhatarioColors.muted),
            const SizedBox(width: 6),
            const Expanded(
              child: Text(
                'Add a widget to this dashboard',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12, height: 16 / 12, color: KhatarioColors.inkSecondary),
              ),
            ),
            const SizedBox(width: 8),
            _SmallButton(label: 'Customize', onTap: onCustomize),
          ],
        ),
      ),
    );
  }
}

/// `<Button size="sm" className="h-8 gap-1 px-2.5 text-xs">` (min-h-10 wins on mobile).
class _SmallButton extends StatelessWidget {
  const _SmallButton({required this.label, required this.onTap, this.icon, this.primary = false});

  final String label;
  final IconData? icon;
  final bool primary;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final fg = primary ? Colors.white : KhatarioColors.ink;
    return Opacity(
      opacity: onTap == null ? 0.5 : 1,
      child: Material(
        color: primary ? KhatarioColors.primary500 : KhatarioColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: primary ? BorderSide.none : const BorderSide(color: KhatarioColors.line),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: onTap,
          child: SizedBox(
            height: 40,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (icon != null) ...[Icon(icon, size: 14, color: fg), const SizedBox(width: 4)],
                  Text(label, style: TextStyle(fontSize: 12, height: 16 / 12, fontWeight: FontWeight.w500, color: fg)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// CSS `border border-dashed` (1px, dash ≈ 3, gap ≈ 3 in Chrome).
class _DashedRRectPainter extends CustomPainter {
  const _DashedRRectPainter({required this.color, required this.radius});

  final Color color;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    final path = Path()
      ..addRRect(RRect.fromRectAndRadius(Rect.fromLTWH(0.5, 0.5, size.width - 1, size.height - 1), Radius.circular(radius)));
    for (final metric in path.computeMetrics()) {
      var d = 0.0;
      while (d < metric.length) {
        canvas.drawPath(metric.extractPath(d, d + 3), paint);
        d += 6;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _DashedRRectPainter old) => old.color != color;
}

/// `components/dashboard/Widget.tsx` inside a 300px grid row (`auto-rows-[300px]`, `gap-4`).
class _WidgetFrame extends StatelessWidget {
  const _WidgetFrame({
    super.key,
    required this.widget,
    required this.editMode,
    required this.onRemove,
    required this.onResize,
    required this.child,
  });

  final Map<String, dynamic> widget;
  final bool editMode;
  final VoidCallback onRemove;
  final ValueChanged<Map<String, int>> onResize;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final size = (widget['size'] as Map?) ?? const {};
    final rows = math.max(1, toNum(size['height']).toInt());
    final expanded = rows > 1;
    final slot = rows * 300.0 + (rows - 1) * 16;
    final card = Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        boxShadow: AppShadow.card,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(16, 14, 12, 12),
            decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.hairline))),
            child: Row(
              children: [
                if (editMode) ...[
                  const Icon(LucideIcons.gripVertical, size: 16, color: KhatarioColors.muted),
                  const SizedBox(width: 8),
                ],
                Expanded(
                  child: Text(
                    widget['title']?.toString() ?? '',
                    style: AppText.bodyStrong,
                  ),
                ),
                if (editMode) ...[
                  _IconTap(
                    icon: expanded ? LucideIcons.minimize2 : LucideIcons.maximize2,
                    color: KhatarioColors.inkSecondary,
                    onTap: () => onResize(expanded ? {'width': 1, 'height': 1} : {'width': 2, 'height': 2}),
                  ),
                  const SizedBox(width: 4),
                  _IconTap(icon: LucideIcons.x, color: Tw.red600, onTap: onRemove),
                ],
              ],
            ),
          ),
          Padding(padding: const EdgeInsets.all(16), child: child),
        ],
      ),
    );
    // Grid rows are 300px (`auto-rows-[300px]`) but the card keeps its content height.
    final framed = Stack(
      clipBehavior: Clip.none,
      children: [
        card,
        if (editMode)
          Positioned(
            left: -2,
            top: -2,
            right: -2,
            bottom: -2,
            child: IgnorePointer(
              child: DecoratedBox(decoration: BoxDecoration(border: Border.all(color: KhatarioColors.primary300, width: 2))),
            ),
          ),
      ],
    );
    // The website grid reserves 300px rows; on the phone the card keeps its content height.
    return SizedBox(height: expanded ? slot : null, child: framed);
  }
}

class _IconTap extends StatelessWidget {
  const _IconTap({required this.icon, required this.color, required this.onTap});

  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Padding(padding: const EdgeInsets.all(6), child: Icon(icon, size: 16, color: color)),
    );
  }
}

/// "Add Widget" modal: `fixed inset-0 bg-black/50`, `rounded-lg p-6 max-w-2xl w-full max-h-[80vh]`.
class _AddWidgetDialog extends StatelessWidget {
  const _AddWidgetDialog({required this.options});

  final List<(String, String, String, String?)> options;

  @override
  Widget build(BuildContext context) {
    final maxHeight = MediaQuery.sizeOf(context).height * 0.8;
    return Dialog(
      insetPadding: EdgeInsets.zero,
      backgroundColor: KhatarioColors.surface,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: const BorderSide(color: KhatarioColors.line),
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 672, maxHeight: maxHeight),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  const Expanded(
                    child: Text('Add Widget',
                        style: TextStyle(fontSize: 16, height: 22 / 16, fontWeight: FontWeight.w600, color: KhatarioColors.ink)),
                  ),
                  GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () => Navigator.of(context).pop(),
                    child: const Padding(padding: EdgeInsets.all(8), child: Icon(LucideIcons.x, size: 20, color: KhatarioColors.muted)),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              LayoutBuilder(
                builder: (context, c) {
                  final tileWidth = (c.maxWidth - 12) / 2;
                  return Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    children: [
                      for (final o in options)
                        SizedBox(
                          width: tileWidth,
                          child: Material(
                            color: Colors.transparent,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(8),
                              side: const BorderSide(color: KhatarioColors.line),
                            ),
                            child: InkWell(
                              borderRadius: BorderRadius.circular(8),
                              onTap: () => Navigator.of(context).pop((o.$1, o.$2)),
                              child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(o.$3, style: const TextStyle(fontSize: 20, height: 28 / 20)),
                                    const SizedBox(height: 8),
                                    Text(o.$2,
                                        style: const TextStyle(
                                            fontSize: 14, height: 20 / 14, fontWeight: FontWeight.w500, color: KhatarioColors.ink)),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                    ],
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Fetches once and renders "Loading..." / empty / rows like every website widget.
abstract class _FetchWidget<T> extends StatefulWidget {
  const _FetchWidget({required this.api});

  final KhatarioApi api;

  Future<T> fetch();
  Widget buildData(BuildContext context, T data);

  /// Shown when the request fails or the data is empty.
  Widget? buildEmpty(T? data);

  @override
  State<_FetchWidget<T>> createState() => _FetchWidgetState<T>();
}

class _FetchWidgetState<T> extends State<_FetchWidget<T>> {
  T? _data;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    widget.fetch().then((d) {
      if (mounted) setState(() => _data = d);
    }).catchError((_) {}).whenComplete(() {
      if (mounted) setState(() => _loading = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const _Pulse(child: Text('Loading...', style: _loadingStyle));
    final empty = widget.buildEmpty(_data);
    if (empty != null) return empty;
    return widget.buildData(context, _data as T);
  }
}

/// Tailwind `animate-pulse`.
class _Pulse extends StatefulWidget {
  const _Pulse({required this.child});

  final Widget child;

  @override
  State<_Pulse> createState() => _PulseState();
}

class _PulseState extends State<_Pulse> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(seconds: 2))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, child) => Opacity(
        opacity: _c.value < 0.5 ? 1 - _c.value : _c.value,
        child: child,
      ),
      child: widget.child,
    );
  }
}

Widget _gray(String text) => Text(text, style: _loadingStyle);

class _Row extends StatelessWidget {
  const _Row({required this.left, required this.right});

  final Widget left;
  final Widget right;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: left),
        const SizedBox(width: 8),
        right,
      ],
    );
  }
}

Widget _list(List<Widget> rows) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < rows.length; i++) ...[if (i > 0) const SizedBox(height: 8), rows[i]],
      ],
    );

Widget _link(String text, VoidCallback onTap, {Color? color}) => GestureDetector(
      onTap: onTap,
      child: Text(text,
          maxLines: 1, overflow: TextOverflow.ellipsis, style: _textSm.copyWith(color: color ?? KhatarioColors.primary600)),
    );

Widget _truncated(String text, Color color) =>
    Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, style: _textSm.copyWith(color: color));

class _SalesSummaryWidget extends _FetchWidget<Map> {
  const _SalesSummaryWidget({required super.api});

  @override
  Future<Map> fetch() => api.getJson('/api/dashboard/sales-summary');

  @override
  Widget? buildEmpty(Map? data) => data == null ? _gray('Unable to load') : null;

  @override
  Widget buildData(BuildContext context, Map data) {
    Widget line(String label, dynamic v) => Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: _textSm.copyWith(color: Tw.gray600)),
            Text('₹ ${_jsLocale(v)}', style: _textSm.copyWith(fontWeight: FontWeight.w600, color: KhatarioColors.ink)),
          ],
        );
    return _list([line("Today's Sales:", data['today_sales']), line('This Month:', data['month_sales'])]);
  }
}

class _RecentInvoicesWidget extends _FetchWidget<List<Map>> {
  const _RecentInvoicesWidget({required super.api, required this.onOpen});

  final ValueChanged<String> onOpen;

  @override
  Future<List<Map>> fetch() async =>
      (((await api.getJson('/api/dashboard/recent-invoices?limit=5'))['invoices'] as List?) ?? const []).whereType<Map>().toList();

  @override
  Widget? buildEmpty(List<Map>? data) => (data ?? const []).isEmpty ? _gray('No invoices yet.') : null;

  @override
  Widget buildData(BuildContext context, List<Map> data) => _list([
        for (final inv in data)
          _Row(
            left: _link(inv['invoice_number']?.toString() ?? '', () => onOpen('Invoice ${inv['invoice_number']}')),
            right: Text('₹ ${enIn(toNum(inv['grand_total']))}', style: _textSm.copyWith(fontWeight: FontWeight.w500)),
          ),
      ]);
}

class _TopCustomersWidget extends _FetchWidget<List<Map>> {
  const _TopCustomersWidget({required super.api});

  @override
  Future<List<Map>> fetch() async =>
      (((await api.getJson('/api/dashboard/top-customers?limit=10'))['topCustomers'] as List?) ?? const []).whereType<Map>().toList();

  @override
  Widget? buildEmpty(List<Map>? data) => (data ?? const []).isEmpty ? _gray('No customer sales data yet.') : null;

  @override
  Widget buildData(BuildContext context, List<Map> data) => _list([
        for (var i = 0; i < data.length; i++)
          _Row(
            left: _truncated('${i + 1}. ${data[i]['name'] ?? ''}', Tw.gray700),
            right: Text('₹ ${_jsLocale(data[i]['total_sales'])}',
                style: _textSm.copyWith(fontWeight: FontWeight.w500, color: Tw.gray900)),
          ),
      ]);
}

class _CashFlowWidget extends _FetchWidget<Map> {
  const _CashFlowWidget({required super.api});

  @override
  Future<Map> fetch() {
    final now = DateTime.now();
    final year = now.month <= 3 ? now.year - 1 : now.year;
    return api.getJson('/api/dashboard/cash-flow?fiscal_year=$year');
  }

  @override
  Widget? buildEmpty(Map? data) => data?['summary'] is! Map ? _gray('No cash flow data.') : null;

  @override
  Widget buildData(BuildContext context, Map data) {
    final s = data['summary'] as Map;
    Widget line(String label, dynamic v, TextStyle valueStyle) => Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: _textSm.copyWith(color: Tw.gray600)),
            Text('₹ ${enIn(toNum(v))}', style: _textSm.merge(valueStyle)),
          ],
        );
    return _list([
      line('Incoming:', s['total_incoming'], const TextStyle(fontWeight: FontWeight.w500, color: Tw.green600)),
      line('Outgoing:', s['total_outgoing'], const TextStyle(fontWeight: FontWeight.w500, color: Tw.red600)),
      Container(
        padding: const EdgeInsets.only(top: 4),
        decoration: const BoxDecoration(border: Border(top: BorderSide(color: Tw.gray200))),
        child: line('Closing:', s['closing_balance'], const TextStyle(fontWeight: FontWeight.w600, color: KhatarioColors.ink)),
      ),
    ]);
  }
}

class _PendingPaymentsWidget extends _FetchWidget<List<Map>> {
  const _PendingPaymentsWidget({required super.api, required this.onOpen});

  final ValueChanged<String> onOpen;

  @override
  Future<List<Map>> fetch() async =>
      (((await api.getJson('/api/dashboard/receivables'))['invoices'] as List?) ?? const []).whereType<Map>().take(5).toList();

  @override
  Widget? buildEmpty(List<Map>? data) => (data ?? const []).isEmpty ? _gray('No pending payments.') : null;

  @override
  Widget buildData(BuildContext context, List<Map> data) => _list([
        for (final inv in data)
          _Row(
            left: _link(inv['invoice_number']?.toString() ?? '', () => onOpen('Invoice ${inv['invoice_number']}')),
            right: Text('₹ ${enIn(toNum(inv['grand_total']) - toNum(inv['paid_amount']))}',
                style: _textSm.copyWith(fontWeight: FontWeight.w500)),
          ),
      ]);
}

class _InventoryAlertsWidget extends _FetchWidget<List<Map>> {
  const _InventoryAlertsWidget({required super.api, required this.onOpen});

  final ValueChanged<String> onOpen;

  @override
  Future<List<Map>> fetch() async =>
      (((await api.getJson('/api/dashboard/low-stock?limit=5'))['items'] as List?) ?? const []).whereType<Map>().toList();

  @override
  Widget? buildEmpty(List<Map>? data) => (data ?? const []).isEmpty ? _gray('All items well stocked.') : null;

  @override
  Widget buildData(BuildContext context, List<Map> data) => _list([
        for (final item in data)
          _Row(
            left: _link(item['name']?.toString() ?? '', () => onOpen('Item ${item['name']}'), color: Tw.gray700),
            right: Text(
              '${_jsStr(item['current_stock'])} / ${_jsStr(item['min_stock'])} ${_jsStr(item['unit'])}',
              style: _textSm.copyWith(
                fontWeight: FontWeight.w500,
                color: toNum(item['current_stock']) <= 0 ? Tw.red600 : Tw.amber600,
              ),
            ),
          ),
      ]);
}

class _SalesChartWidget extends _FetchWidget<List<Map>> {
  const _SalesChartWidget({required super.api});

  @override
  Future<List<Map>> fetch() async {
    final end = DateTime.now().toUtc();
    final start = end.subtract(const Duration(days: 30));
    final body = await api.getJson('/api/dashboard/charts?start_date=${ymd(start)}&end_date=${ymd(end)}');
    return ((body['chartData'] as List?) ?? const []).whereType<Map>().toList();
  }

  @override
  Widget? buildEmpty(List<Map>? data) => (data ?? const []).isEmpty ? _gray('No chart data for last 30 days.') : null;

  @override
  Widget buildData(BuildContext context, List<Map> data) {
    final totalSales = data.fold<num>(0, (s, d) => s + toNum(d['sales']));
    final totalPurchases = data.fold<num>(0, (s, d) => s + toNum(d['purchases']));
    final maxVal = data.fold<num>(1, (m, d) => math.max(m, toNum(d['sales'])));
    final last = data.length > 14 ? data.sublist(data.length - 14) : data;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Sales: ₹ ${enIn(totalSales)}', style: const TextStyle(fontSize: 12, height: 16 / 12, color: Tw.green600)),
            Text('Purchases: ₹ ${enIn(totalPurchases)}', style: const TextStyle(fontSize: 12, height: 16 / 12, color: Tw.orange600)),
          ],
        ),
        const SizedBox(height: 8),
        SizedBox(
          height: 64,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              for (var i = 0; i < last.length; i++) ...[
                if (i > 0) const SizedBox(width: 2),
                Expanded(
                  child: Container(
                    height: math.max(64 * math.max(toNum(last[i]['sales']) / maxVal * 100, 2) / 100, 2),
                    decoration: BoxDecoration(
                      color: Tw.green500.withValues(alpha: 0.6),
                      borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _TopProductsWidget extends _FetchWidget<List<Map>> {
  const _TopProductsWidget({required super.api});

  @override
  Future<List<Map>> fetch() async =>
      (((await api.getJson('/api/dashboard/top-products?limit=10'))['topProducts'] as List?) ?? const []).whereType<Map>().toList();

  @override
  Widget? buildEmpty(List<Map>? data) => (data ?? const []).isEmpty ? _gray('No product sales yet.') : null;

  @override
  Widget buildData(BuildContext context, List<Map> data) => _list([
        for (var i = 0; i < data.length; i++)
          _Row(
            left: _truncated('${i + 1}. ${data[i]['name'] ?? ''}', Tw.gray700),
            right: Text('₹ ${_jsLocale(data[i]['total_revenue'])}',
                style: _textSm.copyWith(fontWeight: FontWeight.w500, color: Tw.gray900)),
          ),
      ]);
}

const _staleDaysPresets = [30, 60, 90, 180];

class _DeadStockWidget extends StatefulWidget {
  const _DeadStockWidget({required this.api, required this.config, required this.onConfigChange, required this.onOpen});

  final KhatarioApi api;
  final Map config;
  final ValueChanged<Map<String, dynamic>> onConfigChange;
  final ValueChanged<String> onOpen;

  @override
  State<_DeadStockWidget> createState() => _DeadStockWidgetState();
}

class _DeadStockWidgetState extends State<_DeadStockWidget> {
  late int _staleDays;
  late num _minQty;
  late bool _includeNeverSold;
  String? _branchId;
  String? _warehouseId;
  Map? _data;
  String? _error;
  bool _loading = true;
  int _request = 0;
  late final _daysCtrl = TextEditingController(text: '$_staleDays');

  @override
  void initState() {
    super.initState();
    final c = widget.config;
    final sd = c['stale_days'];
    _staleDays = sd is num && sd.isFinite ? sd.toInt().clamp(1, 730) : 90;
    final mq = c['min_qty'];
    _minQty = mq is num && mq.isFinite ? math.max(0, mq) : 0;
    _includeNeverSold = c['include_never_sold'] != false;
    _branchId = c['branch_id']?.toString();
    _warehouseId = c['warehouse_id']?.toString();
    _fetch();
  }

  @override
  void dispose() {
    _daysCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetch() async {
    final id = ++_request;
    setState(() {
      _loading = true;
      _error = null;
    });
    final params = <String, String>{
      'stale_days': '$_staleDays',
      'min_qty': _jsStr(_minQty),
      'never_sold': _includeNeverSold ? 'true' : 'false',
      'limit': '10',
      'branch_id': ?_branchId,
      'warehouse_id': ?_warehouseId,
    };
    try {
      final body = await widget.api.getJson('/api/dashboard/dead-stock?${Uri(queryParameters: params).query}');
      if (id != _request || !mounted) return;
      setState(() {
        _data = body;
        final warehouses = ((body['warehouses'] as List?) ?? const []).whereType<Map>();
        if (body['stock_mode'] != 'warehouse' && _warehouseId != null) {
          _warehouseId = null;
        } else if (_warehouseId != null && !warehouses.any((w) => w['id']?.toString() == _warehouseId)) {
          _warehouseId = null;
        }
      });
    } catch (e) {
      if (id == _request && mounted) setState(() => _error = _requestError(e, 'Failed to load'));
    } finally {
      if (id == _request && mounted) setState(() => _loading = false);
    }
  }

  void _persist(Map<String, dynamic> next) => widget.onConfigChange({
        'stale_days': _staleDays,
        'min_qty': _minQty,
        'include_never_sold': _includeNeverSold,
        'branch_id': _branchId,
        'warehouse_id': _warehouseId,
        ...next,
      });

  Future<void> _pick(String title, String? current, List<(String?, String)> options, ValueChanged<String?> onPicked) async {
    final picked = await showDialog<(String?,)>(
      context: context,
      builder: (context) => SimpleDialog(
        children: [
          for (final o in options)
            SimpleDialogOption(
              onPressed: () => Navigator.of(context).pop((o.$1,)),
              child: Text(o.$2, style: TextStyle(fontWeight: o.$1 == current ? FontWeight.w600 : FontWeight.w400)),
            ),
        ],
      ),
    );
    if (picked != null) onPicked(picked.$1);
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final rows = ((data?['rows'] as List?) ?? const []).whereType<Map>().toList();
    final branches = ((data?['branches'] as List?) ?? const []).whereType<Map>().toList();
    final warehouses = ((data?['warehouses'] as List?) ?? const []).whereType<Map>().toList();
    final totals = (data?['totals'] as Map?) ?? const {};
    const xs = TextStyle(fontSize: 12, height: 16 / 12);

    Widget selectBox(String label, VoidCallback onTap) => GestureDetector(
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(border: Border.all(color: Tw.gray200), borderRadius: BorderRadius.circular(4)),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Text(label, style: xs.copyWith(color: Tw.gray700)),
              const SizedBox(width: 4),
              const Icon(LucideIcons.chevronDown, size: 12, color: Tw.gray700),
            ]),
          ),
        );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final d in _staleDaysPresets) ...[
                  GestureDetector(
                    onTap: () {
                      setState(() => _staleDays = d);
                      _daysCtrl.text = '$d';
                      _persist({'stale_days': d});
                      _fetch();
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: _staleDays == d ? KhatarioColors.primary600 : null,
                        border: Border.all(color: _staleDays == d ? KhatarioColors.primary600 : Tw.gray200),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text('${d}d', style: xs.copyWith(color: _staleDays == d ? Colors.white : Tw.gray700)),
                    ),
                  ),
                  const SizedBox(width: 4),
                ],
                SizedBox(
                  width: 64,
                  child: Focus(
                    onFocusChange: (f) {
                      if (!f) _persist({'stale_days': _staleDays});
                    },
                    child: TextField(
                      controller: _daysCtrl,
                      keyboardType: TextInputType.number,
                      style: xs.copyWith(color: Tw.gray700),
                      decoration: InputDecoration(
                        isDense: true,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                        enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(4), borderSide: const BorderSide(color: Tw.gray200)),
                        focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(4), borderSide: const BorderSide(color: Tw.gray200)),
                      ),
                      onChanged: (v) {
                        final n = (int.tryParse(v) ?? 0).clamp(1, 730);
                        if (n != _staleDays) {
                          setState(() => _staleDays = n);
                          _fetch();
                        }
                      },
                    ),
                  ),
                ),
              ],
            ),
            GestureDetector(
              onTap: () {
                setState(() => _includeNeverSold = !_includeNeverSold);
                _persist({'include_never_sold': _includeNeverSold});
                _fetch();
              },
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SizedBox(
                    width: 16,
                    height: 16,
                    child: Checkbox(
                      value: _includeNeverSold,
                      onChanged: (v) {
                        setState(() => _includeNeverSold = v ?? false);
                        _persist({'include_never_sold': _includeNeverSold});
                        _fetch();
                      },
                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      visualDensity: VisualDensity.compact,
                      activeColor: KhatarioColors.primary600,
                    ),
                  ),
                  const SizedBox(width: 4),
                  Text('Include never-sold', style: xs.copyWith(color: Tw.gray600)),
                ],
              ),
            ),
            if (branches.length > 1)
              selectBox(
                branches.where((b) => b['id']?.toString() == _branchId).map((b) => b['name'].toString()).firstOrNull ?? 'All branches',
                () => _pick('Branch', _branchId, [
                  (null, 'All branches'),
                  for (final b in branches) (b['id']?.toString(), b['name']?.toString() ?? ''),
                ], (v) {
                  setState(() => _branchId = v);
                  _persist({'branch_id': v});
                  _fetch();
                }),
              ),
            if (data?['stock_mode'] == 'warehouse' && warehouses.length > 1)
              selectBox(
                warehouses.where((w) => w['id']?.toString() == _warehouseId).map((w) => w['name'].toString()).firstOrNull ??
                    'All warehouses',
                () => _pick('Warehouse', _warehouseId, [
                  (null, 'All warehouses'),
                  for (final w in warehouses.where((w) => _branchId == null || w['branch_id']?.toString() == _branchId))
                    (w['id']?.toString(), w['name']?.toString() ?? ''),
                ], (v) {
                  setState(() => _warehouseId = v);
                  _persist({'warehouse_id': v});
                  _fetch();
                }),
              ),
          ],
        ),
        if (data != null && rows.isNotEmpty) ...[
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('${_jsStr(totals['sku_count'])} SKU${toNum(totals['sku_count']) == 1 ? '' : 's'} stuck',
                  style: xs.copyWith(color: Tw.gray500)),
              Text('Value: ₹ ${_jsLocale(totals['total_value'])}', style: xs.copyWith(color: Tw.gray500)),
            ],
          ),
        ],
        const SizedBox(height: 12),
        if (_loading)
          const _Pulse(child: Text('Loading...', style: _loadingStyle))
        else if (_error != null)
          Text(_error!, style: _textSm.copyWith(color: Tw.red600))
        else if (data != null && rows.isEmpty)
          _gray('No dead stock for the current rules.')
        else if (data != null)
          _list([for (final r in rows) _DeadStockRow(api: widget.api, row: r, onOpen: widget.onOpen)]),
      ],
    );
  }
}

class _DeadStockRow extends StatefulWidget {
  const _DeadStockRow({required this.api, required this.row, required this.onOpen});

  final KhatarioApi api;
  final Map row;
  final ValueChanged<String> onOpen;

  @override
  State<_DeadStockRow> createState() => _DeadStockRowState();
}

class _DeadStockRowState extends State<_DeadStockRow> {
  bool _expanded = false;
  List<Map>? _suggestions;
  bool _loading = false;
  String? _error;

  Map get _row => widget.row;

  Future<void> _toggle() async {
    final next = !_expanded;
    setState(() => _expanded = next);
    if (!next || _suggestions != null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final q = Uri(queryParameters: {
        'item_id': _row['item_id']?.toString() ?? '',
        'branch_id': _row['branch_id']?.toString() ?? '',
      }).query;
      final body = await widget.api.getJson('/api/dashboard/dead-stock/suggestions?$q');
      if (mounted) setState(() => _suggestions = ((body['suggestions'] as List?) ?? const []).whereType<Map>().toList());
    } catch (e) {
      if (mounted) setState(() => _error = _requestError(e, 'Failed to load suggestions'));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String get _defaultMessage =>
      "Hi, we currently have ${_jsStr(_row['quantity'])} ${_jsStr(_row['unit'])} of ${_row['item_name'] ?? ''} available"
      "${_row['last_sale_date'] != null ? '' : ' and thought you might be interested'}. Let us know if you'd like to place an order.";

  String? _whatsappTo(String phone) {
    final digits = phone.replaceAll(RegExp(r'\D+'), '').replaceFirst(RegExp(r'^0+'), '');
    if (digits.isEmpty) return null;
    return digits.length == 10 ? '91$digits' : digits;
  }

  @override
  Widget build(BuildContext context) {
    const caption = TextStyle(fontSize: 11, height: 15 / 11);
    const xs = TextStyle(fontSize: 12, height: 16 / 12);
    final meta = StringBuffer('${_jsStr(_row['quantity'])} ${_jsStr(_row['unit'])} · ${_row['branch_name'] ?? ''}');
    if (_row['warehouse_name'] != null) meta.write(' / ${_row['warehouse_name']}');
    meta.write(_row['last_sale_date'] != null ? ' · last sold ${_jsStr(_row['days_without_sale'])}d ago' : ' · never sold');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  GestureDetector(
                    onTap: _toggle,
                    child: Text(_row['item_name']?.toString() ?? '',
                        maxLines: 1, overflow: TextOverflow.ellipsis, style: _textSm.copyWith(color: Tw.gray800)),
                  ),
                  Text(meta.toString(), maxLines: 1, overflow: TextOverflow.ellipsis, style: caption.copyWith(color: Tw.gray500)),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text('₹ ${_jsLocale(_row['inventory_value'])}',
                    style: _textSm.copyWith(fontWeight: FontWeight.w500, color: Tw.gray900)),
                GestureDetector(
                  onTap: () => widget.onOpen('Item ${_row['item_name']}'),
                  child: Text('View item', style: caption.copyWith(color: KhatarioColors.primary600)),
                ),
              ],
            ),
          ],
        ),
        if (_expanded)
          Container(
            margin: const EdgeInsets.only(top: 8),
            padding: const EdgeInsets.only(left: 8),
            decoration: BoxDecoration(border: Border(left: BorderSide(color: KhatarioColors.primary200, width: 2))),
            child: _loading
                ? _Pulse(child: Text('Finding likely buyers...', style: xs.copyWith(color: Tw.gray500)))
                : _error != null
                    ? Text(_error!, style: xs.copyWith(color: Tw.red600))
                    : (_suggestions ?? const []).isEmpty
                        ? Text('No matching customer history in the last 12 months.', style: xs.copyWith(color: Tw.gray500))
                        : Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              for (final s in _suggestions!) ...[
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text.rich(
                                        TextSpan(children: [
                                          TextSpan(text: s['name']?.toString() ?? '', style: const TextStyle(color: Tw.gray800)),
                                          TextSpan(
                                            text: ' (${s['match_type'] == 'same_item' ? 'bought this' : 'same category'})',
                                            style: const TextStyle(fontSize: 10, color: Tw.gray500),
                                          ),
                                        ]),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: xs,
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    Builder(builder: (context) {
                                      final to = s['phone'] == null ? null : _whatsappTo(s['phone'].toString());
                                      if (to == null) {
                                        return const Text('No phone', style: TextStyle(fontSize: 10, color: Tw.gray400));
                                      }
                                      return GestureDetector(
                                        onTap: () => composeBusinessWhatsApp(context, widget.api, to: to, message: _defaultMessage, title: s['name']?.toString() ?? 'WhatsApp'),
                                        child: Text('WhatsApp', style: xs.copyWith(color: Tw.green600)),
                                      );
                                    }),
                                  ],
                                ),
                                const SizedBox(height: 4),
                              ],
                            ],
                          ),
          ),
      ],
    );
  }
}
