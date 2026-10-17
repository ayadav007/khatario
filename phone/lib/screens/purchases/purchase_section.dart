import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import 'bill_form_screen.dart';
import 'purchase_tools.dart';

enum PurchaseKind { bills, orders, returns, requests }

/// List, detail and create for the purchase area, in the same layout as Invoices.
class PurchaseSectionScreen extends StatefulWidget {
  const PurchaseSectionScreen({super.key, required this.session, required this.kind});

  final AppSession session;
  final PurchaseKind kind;

  @override
  State<PurchaseSectionScreen> createState() => _PurchaseSectionScreenState();
}

class _Kind {
  const _Kind({
    required this.title,
    required this.path,
    required this.listKey,
    required this.partyKey,
    required this.numberKey,
    required this.dateKey,
    required this.amountKey,
    required this.statusKey,
    required this.empty,
    required this.searchHint,
    required this.filters,
    this.detailPath,
    this.detailKey,
  });

  final String title;
  final String path;
  final String listKey;
  final String partyKey;
  final String numberKey;
  final String dateKey;
  final String? amountKey;
  final String statusKey;
  final String empty;
  final String searchHint;
  final List<(String, String)> filters;
  final String? detailPath;
  final String? detailKey;
}

const _kinds = {
  PurchaseKind.bills: _Kind(
    title: 'Purchases',
    path: '/api/purchases',
    listKey: 'purchases',
    partyKey: 'supplier_name',
    numberKey: 'bill_number',
    dateKey: 'bill_date',
    amountKey: 'grand_total',
    statusKey: 'payment_status',
    empty: 'Bills you record will show here.',
    searchHint: 'Bill number or supplier',
    filters: [('all', 'All'), ('draft', 'Draft'), ('final', 'Final'), ('paid', 'Paid'), ('unpaid', 'Unpaid')],
    detailPath: '/api/purchases',
    detailKey: 'purchase',
  ),
  PurchaseKind.orders: _Kind(
    title: 'Purchase orders',
    path: '/api/purchase-orders',
    listKey: 'purchaseOrders',
    partyKey: 'supplier_name',
    numberKey: 'order_number',
    dateKey: 'order_date',
    amountKey: 'grand_total',
    statusKey: 'status',
    empty: 'Orders you send to suppliers will show here.',
    searchHint: 'Order number or supplier',
    filters: [('all', 'All'), ('draft', 'Draft'), ('confirmed', 'Open'), ('partially_fulfilled', 'Part received'), ('fulfilled', 'Closed')],
    detailPath: '/api/purchase-orders',
    detailKey: 'purchaseOrder',
  ),
  PurchaseKind.returns: _Kind(
    title: 'Purchase returns',
    path: '/api/purchase-returns',
    listKey: 'purchaseReturns',
    partyKey: 'supplier_name',
    numberKey: 'return_number',
    dateKey: 'return_date',
    amountKey: 'grand_total',
    statusKey: 'refund_status',
    empty: 'Goods you send back will show here.',
    searchHint: 'Return number or supplier',
    filters: [('all', 'All'), ('pending', 'Pending'), ('refunded', 'Refunded'), ('adjusted', 'Adjusted')],
    detailPath: '/api/purchase-returns',
    detailKey: 'purchaseReturn',
  ),
  PurchaseKind.requests: _Kind(
    title: 'Requests',
    path: '/api/stock-requests',
    listKey: 'requests',
    partyKey: 'responder_name',
    numberKey: 'item_name',
    dateKey: 'created_at',
    amountKey: null,
    statusKey: 'status',
    empty: 'Stock you ask a linked supplier for will show here.',
    searchHint: 'Item or supplier',
    filters: [('all', 'All'), ('pending', 'Pending'), ('accepted', 'Accepted'), ('rejected', 'Rejected')],
  ),
};

class _PurchaseSectionScreenState extends State<PurchaseSectionScreen> {
  final _search = TextEditingController();
  String _status = 'all';
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String? _error;

  _Kind get _k => _kinds[widget.kind]!;

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

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final body = await widget.session.api.getJson(_k.path);
      final list = body[_k.listKey];
      if (!mounted) return;
      setState(() {
        _rows = list is List ? list.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [];
      });
    } on ApiException catch (e) {
      if (mounted) setState(() { _rows = const []; _error = e.message; });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> get _filtered {
    final q = _search.text.trim().toLowerCase();
    return [
      for (final row in _rows)
        if (_status == 'all' || row[_k.statusKey]?.toString() == _status || (_status == 'unpaid' && row['payment_status'] == 'unpaid') || (_status == 'final' && row['status'] == 'final') || (_status == 'draft' && row['status'] == 'draft'))
          if (q.isEmpty ||
              (row[_k.partyKey]?.toString().toLowerCase().contains(q) ?? false) ||
              (row[_k.numberKey]?.toString().toLowerCase().contains(q) ?? false) ||
              (row['requester_name']?.toString().toLowerCase().contains(q) ?? false))
            row,
    ];
  }

  Future<void> _create() async {
    final screen = switch (widget.kind) {
      PurchaseKind.bills => BillFormScreen(session: widget.session, kind: BillKind.purchase),
      PurchaseKind.orders => BillFormScreen(session: widget.session, kind: BillKind.purchaseOrder),
      PurchaseKind.returns => PurchaseReturnForm(session: widget.session),
      PurchaseKind.requests => PurchaseRequestForm(session: widget.session),
    };
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => screen));
    if (saved == true) _load();
  }

  void _actions(Map<String, dynamic> row) {
    final id = row['id']?.toString();
    if (id == null) return;
    final status = row['status']?.toString() ?? '';
    final paid = row['payment_status']?.toString() ?? '';
    showKSheet<void>(
      context,
      title: row[_k.numberKey]?.toString() ?? _k.title,
      builder: (ctx) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          KSheetAction(icon: LucideIcons.fileText, label: 'Open', onTap: () { Navigator.pop(ctx); _open(row); }),
          if (widget.kind == PurchaseKind.bills && status == 'draft')
            KSheetAction(icon: LucideIcons.pencil, label: 'Edit draft', onTap: () { Navigator.pop(ctx); _editDraft(row); }),
          if (widget.kind == PurchaseKind.bills && status == 'final' && paid != 'paid')
            KSheetAction(icon: LucideIcons.handCoins, label: 'Record payment', onTap: () { Navigator.pop(ctx); _pay(row); }),
          if (widget.kind == PurchaseKind.bills && status == 'final')
            KSheetAction(icon: LucideIcons.undo2, label: 'Create return', onTap: () { Navigator.pop(ctx); _returnBill(row); }),
          if (widget.kind == PurchaseKind.bills)
            KSheetAction(icon: LucideIcons.barcode, label: 'Print labels', onTap: () { Navigator.pop(ctx); openPurchaseLabels(context, widget.session, id); }),
          if (widget.kind == PurchaseKind.bills && status == 'draft')
            KSheetAction(icon: LucideIcons.trash2, label: 'Delete draft', danger: true, onTap: () { Navigator.pop(ctx); _deleteDraft(id); }),
          if (widget.kind == PurchaseKind.bills && status == 'final')
            KSheetAction(icon: LucideIcons.ban, label: 'Cancel bill', danger: true, onTap: () { Navigator.pop(ctx); _cancelBill(id); }),
          if (widget.kind == PurchaseKind.orders && row['converted_purchase_id'] == null && status != 'cancelled')
            KSheetAction(icon: LucideIcons.fileCheck, label: 'Convert to bill', onTap: () { Navigator.pop(ctx); _convertOrder(id); }),
          if (widget.kind == PurchaseKind.orders && row['converted_purchase_id'] != null)
            KSheetAction(icon: LucideIcons.externalLink, label: 'Open bill', onTap: () { Navigator.pop(ctx); _openPurchase(row['converted_purchase_id'].toString()); }),
          if (widget.kind == PurchaseKind.orders) ...[
            KSheetAction(icon: LucideIcons.printer, label: 'Print / PDF', onTap: () { Navigator.pop(ctx); openPurchaseOrderPdf(widget.session, id, row['order_number']?.toString() ?? ''); }),
            KSheetAction(icon: LucideIcons.mail, label: 'Email', onTap: () { Navigator.pop(ctx); emailPurchaseOrder(context, widget.session, id, row['order_number']?.toString() ?? ''); }),
            KSheetAction(icon: LucideIcons.paperclip, label: 'Attachments', onTap: () { Navigator.pop(ctx); openPurchaseOrderFiles(context, widget.session, id); }),
            KSheetAction(icon: LucideIcons.messageSquare, label: 'Comments', onTap: () { Navigator.pop(ctx); openPurchaseOrderComments(context, widget.session, id); }),
          ],
          if (widget.kind == PurchaseKind.requests && row['status'] == 'pending' && row['responder_business_id']?.toString() == widget.session.businessId)
            KSheetAction(icon: LucideIcons.check, label: 'Reply', onTap: () async { Navigator.pop(ctx); await respondToStockRequest(context, widget.session, row); _load(); }),
          if (widget.kind == PurchaseKind.requests)
            KSheetAction(icon: LucideIcons.link, label: 'Link order or bill', onTap: () async { Navigator.pop(ctx); await linkStockRequest(context, widget.session, id); _load(); }),
        ],
      ),
    );
  }

  void _editDraft(Map<String, dynamic> row) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => BillFormScreen(session: widget.session, kind: BillKind.purchase, purchaseId: row['id'].toString()),
    )).then((saved) { if (saved == true) _load(); });
  }

  void _returnBill(Map<String, dynamic> row) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => PurchaseReturnForm(
        session: widget.session,
        purchaseId: row['id'].toString(),
        supplierId: row['supplier_id']?.toString(),
      ),
    )).then((saved) { if (saved == true) _load(); });
  }

  void _openPurchase(String id) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => PurchaseDetailScreen(session: widget.session, title: 'Purchase', path: '/api/purchases/$id', objectKey: 'purchase', kind: PurchaseKind.bills),
    ));
  }

  Future<void> _pay(Map<String, dynamic> row) async {
    final grand = toNum(row['grand_total']);
    final already = toNum(row['paid_amount']);
    final balance = row['balance_amount'] == null ? grand - already : toNum(row['balance_amount']);
    final amount = TextEditingController(text: balance > 0 ? balance.toString() : '');
    final reference = TextEditingController();
    var mode = 'cash';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
        title: const Text('Record payment'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: amount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Amount')),
            TextField(controller: reference, decoration: const InputDecoration(labelText: 'Reference')),
            const SizedBox(height: 8),
            DropdownButton<String>(
              isExpanded: true,
              value: mode,
              items: const [
                DropdownMenuItem(value: 'cash', child: Text('Cash')),
                DropdownMenuItem(value: 'upi', child: Text('UPI')),
                DropdownMenuItem(value: 'bank', child: Text('Bank')),
              ],
              onChanged: (v) => setLocal(() => mode = v ?? 'cash'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
        ],
      ),
      ),
    );
    if (ok != true || !mounted) return;
    final today = DateTime.now();
    final date = '${today.year}-${today.month.toString().padLeft(2, '0')}-${today.day.toString().padLeft(2, '0')}';
    try {
      await widget.session.api.patchJson('/api/purchases/${row['id']}/payments', {
        'amount': num.tryParse(amount.text) ?? 0,
        'payment_mode': mode,
        'reference': reference.text.trim().isEmpty ? null : reference.text.trim(),
        'payment_date': date,
      });
      _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
    amount.dispose();
    reference.dispose();
  }

  Future<void> _deleteDraft(String id) async {
    try {
      await widget.session.api.deleteJson('/api/purchases/$id');
      _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _cancelBill(String id) async {
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel bill'),
        content: TextField(controller: reason, decoration: const InputDecoration(labelText: 'Reason'), maxLines: 2),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Back')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Cancel bill')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await widget.session.api.postJson('/api/purchases/$id/cancel', {'reason': reason.text.trim()});
      _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
    reason.dispose();
  }

  Future<void> _convertOrder(String id) async {
    try {
      final body = await widget.session.api.postJson('/api/purchase-orders/$id/convert', {});
      final purchase = body['purchase'];
      final purchaseId = purchase is Map ? purchase['id']?.toString() : null;
      if (purchaseId != null && mounted) _openPurchase(purchaseId);
      _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  void _open(Map<String, dynamic> row) {
    if (_k.detailPath == null) {
      _requestDetail(row);
      return;
    }
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => PurchaseDetailScreen(
        session: widget.session,
        title: _k.title,
        path: '${_k.detailPath}/${row['id']}',
        objectKey: _k.detailKey!,
        kind: widget.kind,
        onChanged: _load,
      ),
    ));
  }

  void _requestDetail(Map<String, dynamic> row) {
    final qty = row['requested_qty'];
    showKSheet<void>(
      context,
      title: row['item_name']?.toString() ?? 'Request',
      builder: (ctx) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(row['responder_name']?.toString() ?? 'Supplier', style: AppText.bodyStrong),
            const SizedBox(height: 8),
            Text('Quantity ${qty ?? ''}', style: AppText.body),
            const SizedBox(height: 4),
            Text((row['status']?.toString() ?? '').replaceAll('_', ' '), style: AppText.caption),
            if ((row['notes']?.toString() ?? '').isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(row['notes'].toString(), style: AppText.body),
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final rows = _filtered;
    return Scaffold(
      backgroundColor: AppColors.bg,
      floatingActionButton: KFab(label: 'New', onTap: _create),
      body: RefreshIndicator(
        color: AppColors.brand,
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(top: 8, bottom: 112),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 4, AppSpace.gutter, 0),
              child: Row(children: [
                KIconButton(icon: LucideIcons.arrowLeft, tooltip: 'Back', onTap: () => Navigator.of(context).maybePop()),
                Expanded(child: Text(_k.title, style: AppText.heading.copyWith(fontSize: 22))),
                if (!_loading) Text('${rows.length}', style: AppText.label),
              ]),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 0),
              child: KSearchField(controller: _search, hint: _k.searchHint, onChanged: (_) => setState(() {})),
            ),
            const SizedBox(height: AppSpace.md),
            KChipBar<String>(value: _status, options: _k.filters, onChanged: (v) => setState(() => _status = v)),
            if (_loading)
              const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
            else if (_error != null)
              KEmptyState(icon: LucideIcons.circleAlert, title: 'Could not load', body: _error)
            else if (rows.isEmpty)
              KEmptyState(icon: LucideIcons.shoppingCart, title: 'Nothing here', body: _search.text.isEmpty && _status == 'all' ? _k.empty : 'Try another search or filter.')
            else
              KCard(
                margin: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.lg, AppSpace.gutter, 0),
                child: KDivided(
                  indent: 66,
                  children: [
                    for (final row in rows)
                      KListRow(
                        onTap: () => _open(row),
                        onLongPress: () => _actions(row),
                        leading: KAvatar(name: row[_k.partyKey]?.toString() ?? ''),
                        title: (row[_k.partyKey]?.toString().trim().isNotEmpty ?? false) ? row[_k.partyKey].toString() : 'No supplier',
                        subtitle: [
                          row[_k.numberKey]?.toString() ?? '',
                          _dateLabel(row[_k.dateKey]),
                        ].where((s) => s.isNotEmpty).join(' · '),
                        trailing: Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (_k.amountKey != null)
                              Text(inr(toNum(row[_k.amountKey]), maxFraction: 2), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
                            if (_k.amountKey == null)
                              Text('${row['requested_qty'] ?? ''} qty', style: AppText.bodyStrong),
                            const SizedBox(height: 2),
                            KStatusDot.status((row[_k.statusKey] ?? row['status'] ?? '').toString()),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  String _dateLabel(dynamic raw) {
    final parsed = DateTime.tryParse(raw?.toString() ?? '');
    return parsed == null ? '' : ddMMM(parsed.toLocal());
  }
}

/// A saved purchase, order or return: party, lines and the total the server stored.
class PurchaseDetailScreen extends StatefulWidget {
  const PurchaseDetailScreen({super.key, required this.session, required this.title, required this.path, required this.objectKey, this.kind, this.onChanged});

  final AppSession session;
  final String title;
  final String path;
  final String objectKey;
  final PurchaseKind? kind;
  final VoidCallback? onChanged;

  @override
  State<PurchaseDetailScreen> createState() => _PurchaseDetailScreenState();
}

class _PurchaseDetailScreenState extends State<PurchaseDetailScreen> {
  Map<String, dynamic>? _doc;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _detailPay(Map<String, dynamic> doc) async {
    final balance = toNum(doc['grand_total']) - toNum(doc['paid_amount']);
    final amount = TextEditingController(text: balance > 0 ? balance.toString() : '');
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Record payment'),
        content: TextField(controller: amount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Amount')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final today = DateTime.now();
    final date = '${today.year}-${today.month.toString().padLeft(2, '0')}-${today.day.toString().padLeft(2, '0')}';
    try {
      await widget.session.api.patchJson('/api/purchases/${doc['id']}/payments', {
        'amount': num.tryParse(amount.text) ?? 0,
        'payment_mode': 'cash',
        'payment_date': date,
      });
      widget.onChanged?.call();
      _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
    amount.dispose();
  }

  Future<void> _detailCancel(String id) async {
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel bill'),
        content: TextField(controller: reason, decoration: const InputDecoration(labelText: 'Reason')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Back')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Cancel bill')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await widget.session.api.postJson('/api/purchases/$id/cancel', {'reason': reason.text.trim()});
      widget.onChanged?.call();
      _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
    reason.dispose();
  }

  Future<void> _detailConvert(String id) async {
    try {
      await widget.session.api.postJson('/api/purchase-orders/$id/convert', {});
      widget.onChanged?.call();
      if (mounted) Navigator.of(context).maybePop();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson(widget.path);
      final doc = body[widget.objectKey];
      if (!mounted) return;
      setState(() => _doc = doc is Map ? Map<String, dynamic>.from(doc) : null);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final doc = _doc;
    final items = doc == null ? const <Map<String, dynamic>>[] : _items(doc['items']);
    final number = doc?['bill_number'] ?? doc?['order_number'] ?? doc?['return_number'] ?? '';
    final party = doc?['supplier_name']?.toString() ?? '';
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: _loading
          ? const KSpinner(padding: EdgeInsets.symmetric(vertical: 80))
          : ListView(
              padding: const EdgeInsets.only(bottom: 32),
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 8, AppSpace.gutter, 0),
                  child: Row(children: [
                    KIconButton(icon: LucideIcons.arrowLeft, tooltip: 'Back', onTap: () => Navigator.of(context).maybePop()),
                    Expanded(child: Text(number.toString().isEmpty ? widget.title : number.toString(), style: AppText.heading.copyWith(fontSize: 20))),
                  ]),
                ),
                if (_error != null)
                  KEmptyState(icon: LucideIcons.circleAlert, title: 'Could not open this', body: _error)
                else if (doc == null)
                  const KEmptyState(icon: LucideIcons.fileSearch, title: 'Not found')
                else ...[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 0),
                    child: KCard(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(party.isEmpty ? 'Supplier' : party, style: AppText.bodyStrong),
                            const SizedBox(height: 6),
                            Text(
                              [
                                doc['bill_date'] ?? doc['order_date'] ?? doc['return_date'] ?? '',
                                (doc['status'] ?? doc['refund_status'] ?? '').toString().replaceAll('_', ' '),
                              ].where((s) => s.toString().isNotEmpty).join(' · '),
                              style: AppText.caption,
                            ),
                            const SizedBox(height: 12),
                            Text(inr(toNum(doc['grand_total']), maxFraction: 2), style: AppText.heading),
                            if ((toNum(doc['paid_amount'])) > 0) ...[
                              const SizedBox(height: 4),
                              Text('Paid ${inr(toNum(doc['paid_amount']), maxFraction: 2)}', style: AppText.caption),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ),
                  if (widget.kind == PurchaseKind.bills)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 0),
                      child: KButton.secondary(label: 'Print labels', onPressed: () => openPurchaseLabels(context, widget.session, doc['id'].toString())),
                    ),
                  if (widget.kind == PurchaseKind.bills && doc['status'] == 'final')
                    Padding(
                      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 0),
                      child: Column(
                        children: [
                          if (doc['payment_status'] != 'paid')
                            KButton(label: 'Record payment', onPressed: () => _detailPay(doc)),
                          const SizedBox(height: 8),
                          KButton.secondary(label: 'Create return', onPressed: () {
                            Navigator.of(context).push(MaterialPageRoute(
                              builder: (_) => PurchaseReturnForm(
                                session: widget.session,
                                purchaseId: doc['id']?.toString(),
                                supplierId: doc['supplier_id']?.toString(),
                              ),
                            ));
                          }),
                          const SizedBox(height: 8),
                          KButton(label: 'Cancel bill', kind: KButtonKind.danger, onPressed: () => _detailCancel(doc['id'].toString())),
                        ],
                      ),
                    ),
                  if (widget.kind == PurchaseKind.orders) ...[
                    if (doc['converted_purchase_id'] == null && doc['status'] != 'cancelled')
                      Padding(
                        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 0),
                        child: KButton(label: 'Convert to bill', onPressed: () => _detailConvert(doc['id'].toString())),
                      ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, 0),
                      child: KButton.secondary(
                        label: 'Print / PDF',
                        onPressed: () => openPurchaseOrderPdf(widget.session, doc['id'].toString(), doc['order_number']?.toString() ?? ''),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, 0),
                      child: KButton.secondary(
                        label: 'Email',
                        onPressed: () => emailPurchaseOrder(context, widget.session, doc['id'].toString(), doc['order_number']?.toString() ?? ''),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, 0),
                      child: KButton.secondary(label: 'Attachments', onPressed: () => openPurchaseOrderFiles(context, widget.session, doc['id'].toString())),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, 0),
                      child: KButton.secondary(label: 'Comments', onPressed: () => openPurchaseOrderComments(context, widget.session, doc['id'].toString())),
                    ),
                  ],
                  Padding(
                    padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xl, AppSpace.gutter, AppSpace.sm),
                    child: Text('ITEMS', style: AppText.overline),
                  ),
                  if (items.isEmpty)
                    const Padding(padding: EdgeInsets.symmetric(horizontal: AppSpace.gutter), child: Text('No lines on this document.'))
                  else
                    KCard(
                      margin: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
                      child: KDivided(
                        children: [
                          for (final line in items)
                            KListRow(
                              title: (line['item_name'] ?? line['catalog_item_name'] ?? line['description'] ?? 'Item').toString(),
                              subtitle: '${line['quantity'] ?? line['qty'] ?? ''} × ${inr(toNum(line['unit_price']), maxFraction: 2)}',
                              trailing: Text(inr(toNum(line['line_total'] ?? line['total']), maxFraction: 2), style: AppText.bodyStrong),
                            ),
                        ],
                      ),
                    ),
                ],
              ],
            ),
    );
  }

  List<Map<String, dynamic>> _items(dynamic raw) {
    if (raw is! List) return const [];
    return raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }
}

class PurchaseReturnForm extends StatefulWidget {
  const PurchaseReturnForm({super.key, required this.session, this.purchaseId, this.supplierId, this.prefillQty, this.reason});

  final AppSession session;
  final String? purchaseId;
  final String? supplierId;

  /// Quantities to start with per item id (for example a bill received short or damaged).
  final Map<String, double>? prefillQty;
  final String? reason;

  @override
  State<PurchaseReturnForm> createState() => _PurchaseReturnFormState();
}

class _PurchaseReturnFormState extends State<PurchaseReturnForm> {
  final _number = TextEditingController();
  final _reason = TextEditingController();
  final _lines = <_ReturnLine>[_ReturnLine()];
  List<Map<String, dynamic>> _suppliers = const [];
  List<Map<String, dynamic>> _items = const [];
  String? _supplierId;
  DateTime _date = DateTime.now();
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _number.dispose();
    _reason.dispose();
    for (final line in _lines) {
      line.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        widget.session.api.getJson('/api/suppliers'),
        widget.session.api.getJson('/api/items'),
      ]);
      if (!mounted) return;
      setState(() {
        _suppliers = _list(results[0], const ['suppliers']);
        _items = _list(results[1], const ['items']);
        _supplierId ??= widget.supplierId;
        final prefill = widget.prefillQty;
        if (prefill != null && prefill.isNotEmpty) {
          for (final line in _lines) {
            line.dispose();
          }
          _lines.clear();
          for (final entry in prefill.entries) {
            final item = _items.where((i) => i['id']?.toString() == entry.key).firstOrNull;
            if (item == null) continue;
            final line = _ReturnLine()
              ..item = item
              ..taxRate = toNum(item['tax_rate']).toDouble();
            line.qty.text = entry.value.toString();
            line.price.text = toNum(item['purchase_price']).toString();
            _lines.add(line);
          }
          if (_lines.isEmpty) _lines.add(_ReturnLine());
        }
        if (widget.reason != null && _reason.text.isEmpty) _reason.text = widget.reason!;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _save() async {
    final number = _number.text.trim();
    if (_supplierId == null || number.isEmpty) {
      setState(() => _error = 'Choose a supplier and a return number.');
      return;
    }
    final items = <Map<String, dynamic>>[];
    for (final line in _lines) {
      final item = line.item;
      if (item == null) continue;
      items.add({
        'item_id': item['id'],
        'item_name': item['name'],
        'description': item['name'],
        'qty': num.tryParse(line.qty.text) ?? 0,
        'unit_price': num.tryParse(line.price.text) ?? 0,
        'tax_rate': line.taxRate,
        'hsn_sac': item['hsn_sac'],
        'unit': item['unit'] ?? 'PCS',
      });
    }
    if (items.isEmpty) {
      setState(() => _error = 'Add at least one item.');
      return;
    }
    final date = '${_date.year.toString().padLeft(4, '0')}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}';
    setState(() { _saving = true; _error = null; });
    try {
      await widget.session.api.postJson('/api/purchase-returns', {
        'business_id': widget.session.businessId,
        'created_by': widget.session.user['id'],
        'supplier_id': _supplierId,
        if (widget.purchaseId != null) 'purchase_id': widget.purchaseId,
        'return_number': number,
        'return_date': date,
        'reason': _reason.text.trim(),
        'branch_id': widget.session.defaultBranchId,
        'items': items,
      });
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: KSpinner(padding: EdgeInsets.symmetric(vertical: 64)));
    final supplier = _suppliers.cast<Map<String, dynamic>?>().where((s) => s?['id']?.toString() == _supplierId).firstOrNull;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          _formHeader(context, 'New purchase return'),
          _pickRow('Supplier', supplier?['name']?.toString() ?? 'Choose', () {
            showKPicker<String>(
              context,
              title: 'Supplier',
              value: _supplierId ?? '',
              options: [for (final s in _suppliers) (s['id'].toString(), s['name']?.toString() ?? 'Supplier')],
              onChanged: (id) => setState(() => _supplierId = id),
            );
          }),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
            child: TextField(controller: _number, decoration: const InputDecoration(labelText: 'Return number')),
          ),
          ListTile(
            title: const Text('Date'),
            subtitle: Text(ddMMMyyyy(_date)),
            onTap: () async {
              final picked = await showDatePicker(context: context, initialDate: _date, firstDate: DateTime(2000), lastDate: DateTime(2100));
              if (picked != null) setState(() => _date = picked);
            },
          ),
          for (var i = 0; i < _lines.length; i++) _returnLine(i),
          TextButton(onPressed: () => setState(() => _lines.add(_ReturnLine())), child: const Text('Add item')),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
            child: TextField(controller: _reason, decoration: const InputDecoration(labelText: 'Reason'), maxLines: 2),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.all(16), child: Text(_error!, style: AppText.body.copyWith(color: AppColors.negative))),
          Padding(padding: const EdgeInsets.all(16), child: KButton(label: _saving ? 'Saving…' : 'Save return', onPressed: _saving ? null : _save)),
        ],
      ),
    );
  }

  Widget _returnLine(int index) {
    final line = _lines[index];
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 8, AppSpace.gutter, 0),
      child: KCard(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            children: [
              _pickRow('Item ${index + 1}', line.item?['name']?.toString() ?? 'Choose', () {
                showKPicker<String>(
                  context,
                  title: 'Item',
                  value: line.item?['id']?.toString() ?? '',
                  options: [for (final item in _items) (item['id'].toString(), item['name']?.toString() ?? 'Item')],
                  onChanged: (id) {
                    final item = _items.cast<Map<String, dynamic>?>().where((row) => row?['id']?.toString() == id).firstOrNull;
                    setState(() {
                      line.item = item;
                      line.price.text = (item?['purchase_price'] ?? item?['selling_price'] ?? '').toString();
                      line.taxRate = double.tryParse(item?['tax_rate']?.toString() ?? '') ?? 0;
                    });
                  },
                );
              }),
              TextField(controller: line.qty, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Quantity')),
              TextField(controller: line.price, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Unit price')),
            ],
          ),
        ),
      ),
    );
  }
}

class _ReturnLine {
  Map<String, dynamic>? item;
  final qty = TextEditingController(text: '1');
  final price = TextEditingController();
  double taxRate = 0;
  void dispose() { qty.dispose(); price.dispose(); }
}

class PurchaseRequestForm extends StatefulWidget {
  const PurchaseRequestForm({super.key, required this.session});
  final AppSession session;
  @override
  State<PurchaseRequestForm> createState() => _PurchaseRequestFormState();
}

class _PurchaseRequestFormState extends State<PurchaseRequestForm> {
  List<Map<String, dynamic>> _suppliers = const [];
  List<Map<String, dynamic>> _items = const [];
  String? _supplierId;
  String? _itemId;
  final _qty = TextEditingController(text: '1');
  final _notes = TextEditingController();
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _qty.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        widget.session.api.getJson('/api/suppliers'),
        widget.session.api.getJson('/api/items'),
      ]);
      if (!mounted) return;
      setState(() {
        _suppliers = _list(results[0], const ['suppliers']);
        _items = _list(results[1], const ['items']);
        _loading = false;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _save() async {
    final supplier = _suppliers.cast<Map<String, dynamic>?>().where((s) => s?['id']?.toString() == _supplierId).firstOrNull;
    final linked = supplier?['linked_business_id']?.toString();
    final qty = num.tryParse(_qty.text) ?? 0;
    if (supplier == null || linked == null || linked.isEmpty || _itemId == null || qty <= 0) {
      setState(() => _error = 'Choose a linked supplier, an item, and a quantity.');
      return;
    }
    setState(() { _saving = true; _error = null; });
    try {
      await widget.session.api.postJson('/api/stock-requests', {
        'requests': [
          {
            'requester_business_id': widget.session.businessId,
            'responder_business_id': linked,
            'item_id': _itemId,
            'requested_qty': qty,
            'notes': _notes.text.trim(),
          },
        ],
      });
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: KSpinner(padding: EdgeInsets.symmetric(vertical: 64)));
    final supplier = _suppliers.cast<Map<String, dynamic>?>().where((s) => s?['id']?.toString() == _supplierId).firstOrNull;
    final item = _items.cast<Map<String, dynamic>?>().where((s) => s?['id']?.toString() == _itemId).firstOrNull;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          _formHeader(context, 'New request'),
          _pickRow('Supplier', supplier?['name']?.toString() ?? 'A supplier linked to another business', () {
            showKPicker<String>(
              context,
              title: 'Supplier',
              value: _supplierId ?? '',
              options: [for (final s in _suppliers) (s['id'].toString(), s['name']?.toString() ?? 'Supplier')],
              onChanged: (id) => setState(() => _supplierId = id),
            );
          }),
          _pickRow('Item', item?['name']?.toString() ?? 'From your catalogue', () {
            showKPicker<String>(
              context,
              title: 'Item',
              value: _itemId ?? '',
              options: [for (final it in _items) (it['id'].toString(), it['name']?.toString() ?? 'Item')],
              onChanged: (id) => setState(() => _itemId = id),
            );
          }),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
            child: TextField(controller: _qty, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Quantity')),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
            child: TextField(controller: _notes, decoration: const InputDecoration(labelText: 'Note'), maxLines: 2),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.all(16), child: Text(_error!, style: AppText.body.copyWith(color: AppColors.negative))),
          Padding(padding: const EdgeInsets.all(16), child: KButton(label: _saving ? 'Sending…' : 'Send request', onPressed: _saving ? null : _save)),
        ],
      ),
    );
  }
}

Widget _formHeader(BuildContext context, String title) {
  return Padding(
    padding: const EdgeInsets.fromLTRB(4, 8, AppSpace.gutter, 8),
    child: Row(children: [
      KIconButton(icon: LucideIcons.arrowLeft, tooltip: 'Back', onTap: () => Navigator.of(context).maybePop()),
      Expanded(child: Text(title, style: AppText.heading.copyWith(fontSize: 22))),
    ]),
  );
}

Widget _pickRow(String label, String value, VoidCallback onTap) {
  return KListRow(
    onTap: onTap,
    title: label,
    subtitle: value,
    trailing: const Icon(LucideIcons.chevronRight, size: 18),
  );
}

List<Map<String, dynamic>> _list(Map<String, dynamic> body, List<String> keys) {
  for (final key in keys) {
    final value = body[key];
    if (value is List) return value.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }
  for (final value in body.values) {
    if (value is List && value.whereType<Map>().isNotEmpty) {
      return value.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    }
  }
  return const [];
}
