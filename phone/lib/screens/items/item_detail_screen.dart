import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../settings/printers_screen.dart';
import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/detail_panel_shell.dart';
import '../../ui/kit.dart';
import '../../ui/web_ui.dart';
import '../invoices/invoice_detail_screen.dart';
import 'adjust_stock_sheet.dart';
import 'items_screen.dart';

/// `formatINR` in `ItemDetailPanel.tsx`.
String formatItemInr(dynamic n) => '₹ ${enIn(toNum(n ?? 0), maxFraction: 2)}';

/// JavaScript truthiness for API values (`"0.00"` is truthy, `0` and `""` are not).
bool _truthy(dynamic v) => v != null && v != false && v != 0 && v != '';

/// `actionDotColor` in `ItemDetailPanel.tsx`.
Color itemHistoryDotColor(String action) => switch (action) {
      'create' => Tw.green500,
      'update' => KhatarioColors.primary500,
      'delete' => Tw.red500,
      'approve' => Tw.emerald500,
      'reject' => Tw.orange500,
      _ => Tw.gray400,
    };

/// `components/items/ItemDetailPanel.tsx` inside `DetailPanelShell` (full screen on phones).
/// Pops `true` after "Remove from catalog" so the list refreshes.
class ItemDetailScreen extends StatefulWidget {
  const ItemDetailScreen({super.key, required this.session, required this.itemId, required this.onOpen});

  final AppSession session;
  final String itemId;
  final ValueChanged<String> onOpen;

  @override
  State<ItemDetailScreen> createState() => _ItemDetailScreenState();
}

enum _Tab { overview, transactions, history }

class _ItemDetailScreenState extends State<ItemDetailScreen> {
  Map<String, dynamic>? _item;
  bool _loading = true;
  _Tab _tab = _Tab.overview;
  List<Map<String, dynamic>>? _transactions;
  Map<String, dynamic>? _summary;
  bool _txLoading = false;
  List<Map<String, dynamic>>? _history;
  bool _historyLoading = false;

  KhatarioApi get _api => widget.session.api;

  @override
  void initState() {
    super.initState();
    _fetchItem();
  }

  static List<Map<String, dynamic>> _list(dynamic v) =>
      v is List ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : [];

  Future<void> _fetchItem() async {
    setState(() => _loading = true);
    try {
      final data = await _api.getJson('/api/items/${widget.itemId}');
      final item = data['item'];
      _item = item is Map ? Map<String, dynamic>.from(item) : null;
    } catch (_) {
      _item = null;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _fetchTransactions() async {
    setState(() => _txLoading = true);
    try {
      final data = await _api.getJson('/api/items/${widget.itemId}/transactions?limit=100');
      _transactions = _list(data['transactions']);
      final s = data['summary'];
      _summary = s is Map ? Map<String, dynamic>.from(s) : null;
    } catch (_) {
      _transactions = [];
    } finally {
      if (mounted) setState(() => _txLoading = false);
    }
  }

  Future<void> _fetchHistory() async {
    setState(() => _historyLoading = true);
    try {
      final data = await _api.getJson('/api/items/${widget.itemId}/history');
      _history = _list(data['history']);
    } catch (_) {
      _history = [];
    } finally {
      if (mounted) setState(() => _historyLoading = false);
    }
  }

  void _selectTab(_Tab t) {
    setState(() => _tab = t);
    if (t == _Tab.transactions && _transactions == null && !_txLoading) _fetchTransactions();
    if (t == _Tab.history && _history == null && !_historyLoading) _fetchHistory();
  }

  Future<void> _confirmDelete(Map<String, dynamic> item) async {
    final deleted = await showDialog<bool>(
      context: context,
      barrierColor: const Color(0x66000000),
      builder: (_) => _DeleteItemDialog(api: _api, item: item),
    );
    if (deleted != true || !mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(const SnackBar(content: Text('Item deleted successfully')));
    Navigator.of(context).pop(true);
  }

  void _openTransaction(Map<String, dynamic> tx) {
    if (tx['type'] == 'invoice') {
      Navigator.of(context).push(MaterialPageRoute<void>(
        builder: (_) => InvoiceDetailScreen(api: _api, invoiceId: tx['id'].toString(), session: widget.session, businessName: widget.session.businessName),
      ));
    } else {
      widget.onOpen('Purchase detail');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: KhatarioColors.background,
      body: SafeArea(child: _panel()),
    );
  }

  Future<void> _adjustStock(Map<String, dynamic> item) async {
    if (_truthy(item['has_variants']) || _truthy(item['is_bundle'])) {
      widget.onOpen('New inventory adjustment');
      return;
    }
    final saved = await showAdjustItemStockSheet(context, session: widget.session, item: item);
    if (saved && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Stock updated')));
      await _fetchItem();
      if (mounted) setState(() {});
    }
  }

  Widget _panel() {
    final item = _item;
    if (_loading || item == null) {
      return DetailPanelPlaceholder(loading: _loading, notFoundText: 'Item not found', onClose: () => Navigator.of(context).pop());
    }
    final isService = item['item_type'] == 'service';
    final code = item['code']?.toString() ?? '';
    final barcode = item['barcode']?.toString() ?? '';
    final image = itemImage(item['image_url']);
    return DetailPanelShell<_Tab>(
      title: item['name']?.toString() ?? '',
      subtitle: [
        if (code.isNotEmpty) Text('Code: $code'),
        if (barcode.isNotEmpty) Text(barcode, style: const TextStyle(fontFamily: 'monospace')),
        KPill(label: isService ? 'SERVICE' : 'GOODS', tone: KTone.brand),
      ],
      avatar: Container(
        width: 40,
        height: 40,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(color: AppColors.sunken, borderRadius: BorderRadius.circular(12)),
        child: image != null
            ? Image(image: image, fit: BoxFit.cover, errorBuilder: (_, _, _) => const SizedBox.shrink())
            : Icon(isService ? LucideIcons.tag : LucideIcons.package, size: 20, color: AppColors.ink2),
      ),
      tabs: const [
        (_Tab.overview, 'Overview', LucideIcons.clipboardList),
        (_Tab.transactions, 'Transactions', LucideIcons.package),
        (_Tab.history, 'History', LucideIcons.history),
      ],
      activeTab: _tab,
      onTabChange: _selectTab,
      onClose: () => Navigator.of(context).pop(),
      moreActions: [
        DetailMoreAction(label: 'Open full page', icon: LucideIcons.externalLink, onTap: () => widget.onOpen('The full item page')),
        DetailMoreAction(label: 'Print barcode labels', icon: LucideIcons.printer, onTap: () => printItemLabels(context, widget.session, widget.itemId)),
        if (widget.session.canDelete('items'))
          DetailMoreAction(label: 'Remove from catalog', icon: LucideIcons.trash2, danger: true, onTap: () => _confirmDelete(item)),
      ],
      header: _PriceHero(item: item),
      body: switch (_tab) {
        _Tab.overview => _overview(item),
        _Tab.transactions => _transactionsTab(item),
        _Tab.history => _historyTab(),
      },
      bottomBar: isService
          ? null
          : KBottomBar(children: [
              Expanded(child: KButton(label: 'Adjust stock', icon: LucideIcons.arrowUpDown, onPressed: () => _adjustStock(item))),
            ]),
    );
  }

  Widget _overview(Map<String, dynamic> item) {
    final isService = item['item_type'] == 'service';
    final unit = item['unit'];
    String text(String key) => item[key]?.toString() ?? '';
    final valuation = switch (item['valuation_method']) {
      'fifo' => 'FIFO',
      'weighted_avg' || 'lifo' => 'WEIGHTED AVG',
      'simple' => 'SIMPLE',
      _ => '',
    };
    final batchSerial = [
      if (_truthy(item['track_batch'])) 'Batch',
      if (_truthy(item['track_serial'])) 'Serial',
    ].join(' + ');
    final description = text('description');

    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xl, AppSpace.gutter, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KInfoCard(title: 'Primary Details', rows: [
            ('Item Name', text('name')),
            ('Item Type', isService ? 'Service' : 'Goods'),
            ('Unit', _truthy(unit) ? unit.toString() : '-'),
            ('HSN / SAC', _truthy(item['hsn_sac']) ? text('hsn_sac') : '-'),
            if (_truthy(item['code'])) ('Item Code', text('code')),
            if (_truthy(item['barcode'])) ('Barcode', text('barcode')),
            if (_truthy(item['brand'])) ('Brand', text('brand')),
            if (_truthy(item['country_of_origin'])) ('Country of Origin', text('country_of_origin')),
          ]),
          const SizedBox(height: AppSpace.xl),
          KInfoCard(title: 'Sales Information', rows: [
            ('Selling Price', item['selling_price'] != null ? formatItemInr(item['selling_price']) : 'Not set'),
            if (_truthy(item['mrp'])) ('MRP', formatItemInr(item['mrp'])),
            ('Purchase Price', _truthy(item['purchase_price']) ? formatItemInr(item['purchase_price']) : '-'),
            ('Tax Rate', '${item['tax_rate'] ?? 0}%'),
          ]),
          if (!isService) ...[
            const SizedBox(height: AppSpace.xl),
            KInfoCard(title: 'Stock', rows: [
              ('Low Stock Alert', '${jsNumberString(toNum(item['min_stock'] ?? 0))} ${unit ?? ''}'),
              if (_truthy(item['valuation_method'])) ('Valuation Method', valuation),
              ('Track Batch / Serial', batchSerial.isEmpty ? 'No' : batchSerial),
            ]),
          ],
          if (description.isNotEmpty) ...[
            const SizedBox(height: AppSpace.xl),
            KInfoCard(title: 'Description', rows: [('About', description)]),
          ],
          const SizedBox(height: AppSpace.xl),
          const KSectionHeader('Reporting Tags'),
          Text('No reporting tag has been associated with this item.', style: AppText.caption.copyWith(fontStyle: FontStyle.italic)),
        ],
      ),
    );
  }

  Widget _transactionsTab(Map<String, dynamic> item) {
    final transactions = _transactions;
    if (_txLoading && transactions == null) return const KSpinner();
    final summary = _summary;
    final unit = item['unit'] ?? '';
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.lg, AppSpace.gutter, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (summary != null) ...[
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(
                    child: _SummaryCard(
                      tint: AppTints.green,
                      icon: LucideIcons.trendingUp,
                      label: 'SOLD',
                      value: '${_raw(summary['sales_qty'])} $unit',
                      detail: '${formatItemInr(summary['sales_amount'])} • ${_raw(summary['sales_count'])} invoice(s)',
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _SummaryCard(
                      tint: AppTints.sky,
                      icon: LucideIcons.trendingDown,
                      label: 'PURCHASED',
                      value: '${_raw(summary['purchase_qty'])} $unit',
                      detail: '${formatItemInr(summary['purchase_amount'])} • ${_raw(summary['purchase_count'])} bill(s)',
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpace.xl),
          ],
          if (transactions != null && transactions.isEmpty)
            const DetailEmptyState(icon: LucideIcons.fileText, text: 'No transactions yet for this item.')
          else ...[
            const KSectionHeader('Movements'),
            ItemTransactionsTable(transactions: transactions ?? const [], onOpen: _openTransaction),
          ],
        ],
      ),
    );
  }

  /// JSX `{value}`: numbers print the JavaScript way.
  static String _raw(dynamic v) => v is num ? jsNumberString(v) : (v?.toString() ?? '');

  Widget _historyTab() {
    final history = _history;
    if (_historyLoading && history == null) return const KSpinner();
    if (history != null && history.isEmpty) {
      return const DetailEmptyState(icon: LucideIcons.history, text: 'No activity recorded yet.');
    }
    return DetailHistoryTimeline(
      dotColor: itemHistoryDotColor,
      entries: [
        for (final h in history ?? const <Map<String, dynamic>>[])
          (description: h['description']?.toString() ?? '', meta: historyMeta(h), action: h['action_type']?.toString() ?? ''),
      ],
    );
  }
}

/// Selling price and stock at the top of the item page.
class _PriceHero extends StatelessWidget {
  const _PriceHero({required this.item});

  final Map<String, dynamic> item;

  @override
  Widget build(BuildContext context) {
    final isService = item['item_type'] == 'service';
    final stock = toNum(item['current_stock'] ?? 0);
    final minStock = toNum(item['min_stock'] ?? 0);
    final tone = stock <= 0 ? KTone.negative : (stock <= minStock ? KTone.due : KTone.positive);
    final price = item['selling_price'];
    return KCard(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Selling price', style: AppText.label),
                const SizedBox(height: 2),
                price == null
                    ? Text('Not set', style: AppText.amount.copyWith(color: AppColors.ink3))
                    : KAmount(toNum(price), style: AppText.amount, maxFraction: 2),
                const SizedBox(height: 2),
                Text('GST ${item['tax_rate'] ?? 0}%${_truthy(item['mrp']) ? ' · MRP ${formatItemInr(item['mrp'])}' : ''}',
                    style: AppText.caption.copyWith(fontSize: 12)),
              ],
            ),
          ),
          if (!isService)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(color: tone.bg, borderRadius: BorderRadius.circular(AppRadius.md)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text('In stock', style: AppText.small.copyWith(color: tone.fg, fontSize: 11)),
                  Text('${jsNumberString(stock)} ${item['unit'] ?? ''}',
                      style: AppText.bodyStrong.copyWith(color: tone.fg, fontSize: 16, fontFeatures: AppText.tabular)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.tint, required this.icon, required this.label, required this.value, required this.detail});

  final (Color, Color) tint;
  final IconData icon;
  final String label;
  final String value;
  final String detail;

  @override
  Widget build(BuildContext context) {
    return KCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(color: tint.$1, borderRadius: BorderRadius.circular(9)),
                child: Icon(icon, size: 15, color: tint.$2),
              ),
              const SizedBox(width: 8),
              Text(label, style: AppText.small.copyWith(color: tint.$2, letterSpacing: 0.4)),
            ],
          ),
          const SizedBox(height: 8),
          Text(value, style: AppText.heading.copyWith(fontFeatures: AppText.tabular)),
          const SizedBox(height: 2),
          Text(detail, style: AppText.caption.copyWith(fontSize: 12)),
        ],
      ),
    );
  }
}

/// Column widths of an HTML `table-layout: auto` table: stretch max-content widths when they fit,
/// fall back to min-content (and scroll) when even those do not, otherwise interpolate.
List<double> autoTableColumnWidths(List<(double, double)> columns, double available) {
  final minSum = columns.fold<double>(0, (s, c) => s + c.$1);
  final maxSum = columns.fold<double>(0, (s, c) => s + c.$2);
  if (minSum >= available) return [for (final c in columns) c.$1];
  if (maxSum <= available) {
    return [for (final c in columns) maxSum == 0 ? available / columns.length : c.$2 + (available - maxSum) * c.$2 / maxSum];
  }
  final t = (available - minSum) / (maxSum - minSum);
  return [for (final c in columns) c.$1 + (c.$2 - c.$1) * t];
}

/// Sales and purchases of one item, one row each: type, reference, date and party, quantity and amount.
class ItemTransactionsTable extends StatelessWidget {
  const ItemTransactionsTable({super.key, required this.transactions, required this.onOpen});

  final List<Map<String, dynamic>> transactions;
  final ValueChanged<Map<String, dynamic>> onOpen;

  @override
  Widget build(BuildContext context) {
    return KCard(
      child: KDivided(
        indent: 66,
        children: [
          for (final tx in transactions)
            Builder(builder: (context) {
              final sale = tx['type'] == 'invoice';
              final date = parseServerDate(tx['date']);
              final party = tx['party_name']?.toString() ?? '';
              final tint = sale ? AppTints.green : AppTints.sky;
              return KListRow(
                onTap: () => onOpen(tx),
                leading: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(color: tint.$1, borderRadius: BorderRadius.circular(12)),
                  child: Icon(sale ? LucideIcons.arrowUpRight : LucideIcons.arrowDownLeft, size: 18, color: tint.$2),
                ),
                title: tx['ref_no']?.toString() ?? '',
                subtitle: [
                  sale ? 'Sale' : 'Purchase',
                  if (date != null) ddMMMyyyy(date),
                  if (party.isNotEmpty) party,
                ].join(' · '),
                trailing: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(formatItemInr(tx['line_total']), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
                    Text('Qty ${tx['quantity'] ?? ''}', style: AppText.caption.copyWith(fontSize: 12)),
                  ],
                ),
              );
            }),
        ],
      ),
    );
  }
}

/// `DeleteAction` modal (`variant="delete"`, `entityName="Item"`) used by "Remove from catalog".
class _DeleteItemDialog extends StatefulWidget {
  const _DeleteItemDialog({required this.api, required this.item});

  final KhatarioApi api;
  final Map<String, dynamic> item;

  @override
  State<_DeleteItemDialog> createState() => _DeleteItemDialogState();
}

class _DeleteItemDialogState extends State<_DeleteItemDialog> {
  bool _busy = false;

  Future<void> _confirm() async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await widget.api.deleteJson('/api/items/${widget.item['id']}');
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message.isEmpty ? 'Failed to delete item' : e.message)));
    } catch (_) {
      messenger.showSnackBar(const SnackBar(content: Text('Action failed. Please try again.')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !_busy,
      child: Dialog(
        insetPadding: const EdgeInsets.all(16),
        backgroundColor: KhatarioColors.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: const BorderSide(color: KhatarioColors.line),
        ),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 448),
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(8),
              boxShadow: const [
                BoxShadow(color: Color(0x1A000000), blurRadius: 25, spreadRadius: -5, offset: Offset(0, 20)),
                BoxShadow(color: Color(0x1A000000), blurRadius: 10, spreadRadius: -6, offset: Offset(0, 8)),
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('Delete Item?',
                    style: TextStyle(fontSize: 14, height: 20 / 14, fontWeight: FontWeight.w600, color: KhatarioColors.ink)),
                const SizedBox(height: 8),
                Text(
                  'Remove "${widget.item['name']}" from your catalog? It will no longer appear in the item list; '
                  'past invoices and records stay unchanged.',
                  style: const TextStyle(fontSize: 14, height: 20 / 14, color: KhatarioColors.inkSecondary),
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    WebSecondaryButton(label: 'Cancel', height: 44, onPressed: _busy ? null : () => Navigator.of(context).pop()),
                    const SizedBox(width: 8),
                    _DangerSecondaryButton(label: _busy ? 'Please wait…' : 'Delete', onPressed: _busy ? null : _confirm),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// `variant="secondary" className="border border-red-200 text-red-700 hover:bg-red-50"`.
class _DangerSecondaryButton extends StatelessWidget {
  const _DangerSecondaryButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: onPressed == null ? 0.5 : 1,
      child: Material(
        color: KhatarioColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8), side: const BorderSide(color: Tw.red200)),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          highlightColor: Tw.red50,
          onTap: onPressed,
          child: Container(
            height: 44,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            alignment: Alignment.center,
            child: Text(label, style: const TextStyle(fontSize: 14, height: 20 / 14, fontWeight: FontWeight.w500, color: Tw.red700)),
          ),
        ),
      ),
    );
  }
}
