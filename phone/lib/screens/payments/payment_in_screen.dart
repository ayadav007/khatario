import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../ui/web_ui.dart';
import 'payment_in_logic.dart';

/// `app/(app)/payments/in/page.tsx`.
class PaymentInScreen extends StatefulWidget {
  const PaymentInScreen({super.key, required this.session, this.payable = false, this.highlightIds = const []});

  final AppSession session;
  final bool payable;

  /// Receipts just recorded. Those rows are marked and scrolled into view.
  final List<String> highlightIds;

  @override
  State<PaymentInScreen> createState() => _PaymentInScreenState();
}

class _PaymentInScreenState extends State<PaymentInScreen> {
  List<Map<String, dynamic>> _payments = const [];
  bool _loading = true;
  String? _error;
  final _search = TextEditingController();
  final _highlightIds = <String>{};
  final _highlightKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    _highlightIds.addAll(widget.highlightIds);
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
      final body = await widget.session.api.getJson('/api/payments?type=${widget.payable ? 'payable' : 'receivable'}');
      if (!mounted) return;
      final rows = (body['payments'] as List?) ?? const [];
      setState(() {
        _payments = rows.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
        _loading = false;
      });
      _scrollToHighlight();
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  void _scrollToHighlight() {
    if (_highlightIds.isEmpty) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final ctx = _highlightKey.currentContext;
      if (ctx != null) Scrollable.ensureVisible(ctx, alignment: 0.2, duration: const Duration(milliseconds: 280));
    });
  }

  Future<void> _record() async {
    final saved = await Navigator.of(context).push<RecordedPayments>(MaterialPageRoute(
      builder: (_) => PaymentInFormScreen(session: widget.session, payable: widget.payable),
    ));
    if (saved == null || !mounted) return;
    setState(() => _highlightIds.addAll(saved.ids));
    await _load();
  }

  Future<void> _shareReceipt(String id) async {
    try {
      final bytes = await widget.session.api.getBytes('/api/payments/$id/receipt/pdf');
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/Receipt-${id.substring(0, id.length < 8 ? id.length : 8)}.pdf');
      await file.writeAsBytes(bytes);
      await SharePlus.instance.share(ShareParams(files: [XFile(file.path)], subject: 'Payment receipt'));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final shown = _payments.where((p) => paymentMatches(p, _search.text)).toList();
    final total = shown.where((p) => p['status'] != 'reversed').fold<num>(0, (sum, p) => sum + toNum(p['amount']));
    final tint = widget.payable ? AppTints.rose : AppTints.green;
    return Scaffold(
      backgroundColor: AppColors.bg,
      floatingActionButton: KFab(label: widget.payable ? 'Record payment out' : 'Record payment', onTap: _record),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              height: 64,
              child: Row(children: [
                const SizedBox(width: 4),
                KIconButton(icon: LucideIcons.arrowLeft, tooltip: 'Back', onTap: () => Navigator.of(context).pop()),
                const SizedBox(width: 4),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(widget.payable ? 'Payment out' : 'Payment in', style: AppText.heading.copyWith(fontSize: 18)),
                      Text(
                        widget.payable ? 'Money paid to suppliers.' : 'Money received from customers — with or without a specific invoice.',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.caption.copyWith(fontSize: 12),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: AppSpace.gutter),
              ]),
            ),
            Expanded(
              child: RefreshIndicator(
                color: AppColors.brand,
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, 112),
                  children: [
                    KCard(
                      raised: true,
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          Container(
                            width: 44,
                            height: 44,
                            decoration: BoxDecoration(color: tint.$1, borderRadius: BorderRadius.circular(14)),
                            child: Icon(widget.payable ? LucideIcons.arrowUpRight : LucideIcons.arrowDownLeft, color: tint.$2),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(widget.payable ? 'Paid out' : 'Received', style: AppText.label),
                                _loading
                                    ? Container(height: 28, width: 100, color: AppColors.sunken)
                                    : KAmount(total, style: AppText.amount, maxFraction: 2, color: tint.$2),
                              ],
                            ),
                          ),
                          Text('${shown.length} payments', style: AppText.caption),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpace.lg),
                    KSearchField(controller: _search, hint: 'Customer, mode or amount', onChanged: (_) => setState(() {})),
                    const SizedBox(height: AppSpace.lg),
                    if (_loading)
                      const KSpinner(padding: EdgeInsets.symmetric(vertical: 48))
                    else if (_error != null)
                      KEmptyState(icon: LucideIcons.cloudOff, title: 'Could not load payments', body: _error, action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load))
                    else if (shown.isEmpty)
                      const KEmptyState(icon: LucideIcons.handCoins, title: 'No payments found', body: 'Payments you record show up here.')
                    else
                      KCard(
                        child: KDivided(
                          indent: 66,
                          children: [
                            for (var i = 0; i < shown.length; i++)
                              Builder(builder: (context) {
                                final p = shown[i];
                                final id = p['id'].toString();
                                final fresh = _highlightIds.contains(id);
                                final firstFresh = fresh && shown.take(i).every((earlier) => !_highlightIds.contains(earlier['id'].toString()));
                                final name = p['customer_name']?.toString().isNotEmpty == true ? p['customer_name'].toString() : 'Cash sale';
                                final reversed = p['status'] == 'reversed';
                                return ColoredBox(
                                  key: firstFresh ? _highlightKey : null,
                                  color: fresh ? tint.$1 : Colors.transparent,
                                  child: KListRow(
                                  onTap: () => _shareReceipt(id),
                                  leading: KAvatar(name: name, muted: reversed),
                                  title: name,
                                  subtitle: '${fresh ? 'Just recorded · ' : ''}${_day(p['payment_date'])} · ${paymentReferenceLabel(p)}${reversed ? ' · Reversed' : ''}',
                                  trailing: Column(
                                    crossAxisAlignment: CrossAxisAlignment.end,
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Text(
                                        '${widget.payable ? '−' : '+'}₹${enIn(toNum(p['amount']), maxFraction: 2)}',
                                        style: AppText.bodyStrong.copyWith(
                                          color: reversed ? AppColors.ink3 : tint.$2,
                                          decoration: reversed ? TextDecoration.lineThrough : null,
                                          fontFeatures: AppText.tabular,
                                        ),
                                      ),
                                      Text('Receipt', style: AppText.small.copyWith(fontSize: 11, color: AppColors.brand)),
                                    ],
                                  ),
                                ),
                                );
                              }),
                          ],
                        ),
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

  String _day(dynamic raw) {
    final d = DateTime.tryParse(raw?.toString() ?? '');
    return d == null ? '' : ddMMMyyyy(d.toLocal());
  }
}

class PaymentInFormScreen extends StatefulWidget {
  const PaymentInFormScreen({super.key, required this.session, this.payable = false});

  final AppSession session;
  final bool payable;

  @override
  State<PaymentInFormScreen> createState() => _PaymentInFormScreenState();
}

class _PaymentInFormScreenState extends State<PaymentInFormScreen> {
  List<Map<String, dynamic>> _customers = const [];
  String? _customerId;
  final _amount = TextEditingController();
  final _tds = TextEditingController();
  final _notes = TextEditingController();
  String _section = '194C';
  String _mode = 'cash';
  DateTime _date = DateTime.now();
  List<PaymentLinkDraft> _links = const [];
  bool _saving = false;
  bool _inFlight = false;
  final _keys = <String, String>{};
  final _random = Random.secure();

  @override
  void initState() {
    super.initState();
    _loadCustomers();
  }

  @override
  void dispose() {
    _amount.dispose();
    _tds.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _loadCustomers() async {
    try {
      final body = await widget.session.api.getJson(widget.payable ? '/api/suppliers?limit=100' : '/api/customers?limit=100');
      final rows = (body[widget.payable ? 'suppliers' : 'customers'] as List?) ?? const [];
      if (mounted) setState(() => _customers = rows.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList());
    } catch (_) {}
  }

  PaymentInDraft get _draft => PaymentInDraft(
        customerId: _customerId,
        amount: double.tryParse(_amount.text) ?? 0,
        tdsAmount: double.tryParse(_tds.text) ?? 0,
        tdsSection: _section,
        paymentMode: _mode,
        paymentDate: '${_date.year.toString().padLeft(4, '0')}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}',
        notes: _notes.text,
        links: widget.payable ? const [] : _links,
      );

  String _keyFor(String fingerprint) {
    return _keys.putIfAbsent(fingerprint, () => List.generate(32, (_) => _random.nextInt(16).toRadixString(16)).join());
  }

  Future<void> _save() async {
    final draft = _draft;
    final problem = validatePaymentIn(draft);
    if (problem != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(problem)));
      return;
    }
    if (_customerId == null || _customerId!.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(widget.payable ? 'Select Supplier' : 'Select Customer')));
      return;
    }
    if (_inFlight) return;
    final jobs = buildPaymentJobs(draft);
    final ids = <String>[];
    setState(() { _saving = true; _inFlight = true; });
    try {
      for (var i = 0; i < jobs.length; i++) {
        final job = jobs[i];
        final key = _keyFor(job.fingerprint);
        try {
          final payload = job.toJson();
          if (widget.payable) {
            payload['type'] = 'payable';
            payload['supplier_id'] = payload['customer_id'];
            payload['customer_id'] = null;
            payload['reference_type'] = null;
            payload['reference_id'] = null;
          }
          final body = await widget.session.api.postJson('/api/payments', payload, headers: {'X-Idempotency-Key': key});
          final id = body['payment'] is Map ? (body['payment'] as Map)['id']?.toString() : null;
          if (id != null && id.isNotEmpty) ids.add(id);
        } on ApiException catch (e) {
          if (e.code == 'IDEMPOTENCY_KEY_REUSED') _keys.remove(job.fingerprint);
          final saved = i > 0 ? ' Part of this receipt was already saved.' : '';
          if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${e.message}$saved')));
          return;
        } catch (_) {
          final saved = i > 0 ? ' Part of this receipt was already saved.' : '';
          if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed to record payment.$saved')));
          return;
        }
      }
      _keys.clear();
      if (mounted) Navigator.of(context).pop(RecordedPayments(ids));
    } finally {
      if (mounted) setState(() { _saving = false; _inFlight = false; });
    }
  }

  Future<void> _pickLinks() async {
    if (_customerId == null) return;
    final body = await widget.session.api.getJson('/api/invoices?customer_id=$_customerId&status=unpaid&limit=200');
    final rows = (body['invoices'] as List?) ?? const [];
    if (!mounted) return;
    final picked = await showModalBottomSheet<List<PaymentLinkDraft>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet))),
      builder: (ctx) => _LinkSheet(invoices: rows.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList(), initial: _links),
    );
    if (picked == null || !mounted) return;
    final total = linkedPaymentTotal(picked);
    setState(() {
      _links = picked;
      if (total > 0) _amount.text = formatEnteredAmount(total);
    });
  }

  Future<void> _pickParty() async {
    final picked = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet))),
      builder: (_) => _PartySheet(
        api: widget.session.api,
        payable: widget.payable,
        selectedId: _customerId,
      ),
    );
    if (picked == null || !mounted) return;
    final id = picked['id'].toString();
    setState(() {
      _customerId = id;
      _links = const [];
      if (_customers.every((c) => c['id'].toString() != id)) {
        _customers = [..._customers, picked];
      }
    });
  }

  Widget _field(TextEditingController c, String label, {bool number = false, bool big = false, int lines = 1}) {
    OutlineInputBorder border(Color color, [double w = 1.5]) =>
        OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.md), borderSide: BorderSide(color: color, width: w));
    return TextField(
      controller: c,
      maxLines: lines,
      keyboardType: number ? const TextInputType.numberWithOptions(decimal: true) : null,
      style: big ? AppText.amount.copyWith(fontSize: 24) : AppText.body,
      cursorColor: AppColors.brand,
      decoration: InputDecoration(
        labelText: label,
        labelStyle: AppText.body.copyWith(color: AppColors.ink3),
        prefixText: big ? '$rupeeSign ' : null,
        prefixStyle: big ? AppText.amount.copyWith(fontSize: 22, color: AppColors.ink3) : null,
        filled: true,
        fillColor: AppColors.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        enabledBorder: border(AppColors.hairline),
        focusedBorder: border(AppColors.brand, 2),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final party = _customers.where((c) => c['id'].toString() == _customerId).firstOrNull;
    const modes = [
      ('cash', 'Cash'),
      ('upi', 'UPI'),
      ('bank', 'Bank Transfer'),
      ('cheque', 'Cheque'),
      ('card', 'Card'),
      ('credit', 'Credit'),
      ('other', 'Other'),
    ];
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              height: 64,
              child: Row(children: [
                const SizedBox(width: 4),
                KIconButton(icon: LucideIcons.x, tooltip: 'Close', onTap: () => Navigator.of(context).pop()),
                const SizedBox(width: 4),
                Expanded(child: Text('Record Payment', style: AppText.heading.copyWith(fontSize: 18))),
              ]),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
                children: [
                  Material(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(AppRadius.md),
                    child: InkWell(
                      onTap: _pickParty,
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      child: Container(
                        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(AppRadius.md),
                          border: Border.all(color: AppColors.hairline, width: 1.5),
                        ),
                        child: Row(
                          children: [
                            party == null
                                ? const Icon(LucideIcons.userRound, size: 20, color: AppColors.ink3)
                                : KAvatar(name: party['name']?.toString() ?? '', size: 36),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(widget.payable ? 'Supplier *' : 'Customer *', style: AppText.label.copyWith(fontSize: 12)),
                                  Text(
                                    party == null ? 'Choose who paid' : party['name']?.toString() ?? '',
                                    style: AppText.bodyStrong.copyWith(color: party == null ? AppColors.ink3 : AppColors.ink),
                                  ),
                                ],
                              ),
                            ),
                            const Icon(LucideIcons.chevronDown, size: 18, color: AppColors.ink3),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpace.md),
                  _field(_amount, 'Amount *', number: true, big: true),
                  const SizedBox(height: AppSpace.lg),
                  Text('Received as', style: AppText.label),
                  const SizedBox(height: AppSpace.sm),
                  KChipBar<String>(value: _mode, options: modes, padding: EdgeInsets.zero, onChanged: (v) => setState(() => _mode = v)),
                  const SizedBox(height: AppSpace.lg),
                  KCard(
                    child: KDivided(
                      children: [
                        KListRow(
                          onTap: () async {
                            final picked = await showDatePicker(context: context, initialDate: _date, firstDate: DateTime(2000), lastDate: DateTime(2100));
                            if (picked != null) setState(() => _date = picked);
                          },
                          leading: const SizedBox(width: 36, child: Icon(LucideIcons.calendar, size: 18, color: AppColors.ink2)),
                          title: ddMMMyyyy(_date),
                          subtitle: 'Payment date',
                          trailing: const Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
                        ),
                        if (!widget.payable)
                          KListRow(
                            onTap: _customerId == null ? null : _pickLinks,
                            leading: const SizedBox(width: 36, child: Icon(LucideIcons.link2, size: 18, color: AppColors.ink2)),
                            title: _linkSummary,
                            subtitle: _customerId == null ? 'Choose a customer to link invoices' : 'Settle specific invoices (optional)',
                            trailing: const Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpace.lg),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(flex: 2, child: _field(_tds, 'TDS deducted', number: true)),
                      const SizedBox(width: AppSpace.md),
                      Expanded(
                        child: WebFieldSelect<String>(
                          value: _section,
                          options: [for (final s in ['194C', '194J', '194H', '194I', '194Q', '194O', 'other']) (s, s == 'other' ? 'Other' : s)],
                          onChanged: (v) => setState(() => _section = v),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpace.md),
                  _field(_notes, 'Notes', lines: 3),
                ],
              ),
            ),
            KBottomBar(children: [
              Expanded(child: KButton(label: 'Record Payment', icon: LucideIcons.check, loading: _saving, onPressed: _save)),
            ]),
          ],
        ),
      ),
    );
  }

  String get _linkSummary {
    if (_links.isEmpty) return 'No invoice linked';
    if (_links.length == 1) return '${_links.first.number} · ₹${enIn(_links.first.amount)}';
    final sum = _links.fold<double>(0, (s, l) => s + l.amount);
    return '${_links.length} invoices · ₹${enIn(sum)}';
  }
}

class _LinkSheet extends StatefulWidget {
  const _LinkSheet({required this.invoices, required this.initial});
  final List<Map<String, dynamic>> invoices;
  final List<PaymentLinkDraft> initial;

  @override
  State<_LinkSheet> createState() => _LinkSheetState();
}

class _LinkSheetState extends State<_LinkSheet> {
  late final Map<String, TextEditingController> _amounts;
  String? _error;

  @override
  void initState() {
    super.initState();
    _amounts = {
      for (final inv in widget.invoices)
        inv['id'].toString(): TextEditingController(
          text: widget.initial.where((l) => l.id == inv['id'].toString()).map((l) => formatEnteredAmount(l.amount)).firstOrNull ?? '',
        ),
    };
    for (final c in _amounts.values) {
      c.addListener(() {
        if (mounted) setState(() => _error = null);
      });
    }
  }

  double get _total {
    var sum = 0.0;
    for (final c in _amounts.values) {
      sum += double.tryParse(c.text.trim()) ?? 0;
    }
    return roundMoney(sum);
  }

  @override
  void dispose() {
    for (final c in _amounts.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  margin: const EdgeInsets.only(top: 8),
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(color: AppColors.hairline, borderRadius: BorderRadius.circular(4)),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 10, 20, 4),
                child: Text('Link to invoices', style: AppText.heading),
              ),
              Flexible(
                child: widget.invoices.isEmpty
                    ? const KEmptyState(icon: LucideIcons.fileCheck, title: 'No unpaid invoices for this customer.')
                    : ListView(
                        shrinkWrap: true,
                        children: [
                          for (final inv in widget.invoices)
                            Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(inv['invoice_number']?.toString() ?? '', style: AppText.bodyStrong),
                                        Text('Balance ₹${enIn(toNum(inv['balance_amount'] ?? inv['grand_total']))}', style: AppText.caption.copyWith(color: AppColors.due)),
                                      ],
                                    ),
                                  ),
                                  SizedBox(
                                    width: 110,
                                    child: TextField(
                                      controller: _amounts[inv['id'].toString()],
                                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                      textAlign: TextAlign.right,
                                      style: AppText.bodyStrong,
                                      decoration: InputDecoration(
                                        hintText: '0',
                                        prefixText: '₹ ',
                                        isDense: true,
                                        filled: true,
                                        fillColor: AppColors.sunken,
                                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.sm), borderSide: BorderSide.none),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text(_error!, style: AppText.body.copyWith(color: AppColors.negative)),
                      )
                    else if (_total > 0)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text('Amount ₹${enIn(_total)}', style: AppText.bodyStrong),
                      ),
                    KButton(
                      label: 'Use these links',
                      onPressed: () {
                        final links = <PaymentLinkDraft>[];
                        for (final inv in widget.invoices) {
                          final amount = double.tryParse(_amounts[inv['id'].toString()]?.text ?? '') ?? 0;
                          if (amount <= 0) continue;
                          final balance = toNum(inv['balance_amount'] ?? inv['grand_total']).toDouble();
                          final number = inv['invoice_number']?.toString() ?? 'Invoice';
                          if (amount > balance + 0.01) {
                            setState(() => _error = '$number cannot take more than its balance of ₹${enIn(balance)}');
                            return;
                          }
                          links.add(PaymentLinkDraft(
                            id: inv['id'].toString(),
                            amount: amount,
                            balance: balance,
                            number: number,
                          ));
                        }
                        Navigator.pop(context, links);
                      },
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PartySheet extends StatefulWidget {
  const _PartySheet({required this.api, required this.payable, required this.selectedId});

  final KhatarioApi api;
  final bool payable;
  final String? selectedId;

  @override
  State<_PartySheet> createState() => _PartySheetState();
}

class _PartySheetState extends State<_PartySheet> {
  final _query = TextEditingController();
  Timer? _debounce;
  int _request = 0;
  List<Map<String, dynamic>> _loaded = const [];
  List<Map<String, dynamic>> _shown = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load('');
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  Future<List<Map<String, dynamic>>> _fetch(String query) async {
    final path = widget.payable ? '/api/suppliers' : '/api/customers';
    final key = widget.payable ? 'suppliers' : 'customers';
    final search = Uri.encodeQueryComponent(query.trim());
    final body = await widget.api.getJson('$path?limit=100${search.isEmpty ? '' : '&search=$search'}');
    final rows = (body[key] as List?) ?? const [];
    return rows.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  Future<void> _load(String query) async {
    final request = ++_request;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final remote = await _fetch(query);
      if (!mounted || request != _request) return;
      if (query.trim().isEmpty) {
        setState(() {
          _loaded = remote;
          _shown = remote;
        });
      } else {
        final byId = <String, Map<String, dynamic>>{
          for (final party in _loaded.where((p) => partyMatches(p, query))) party['id'].toString(): party,
          for (final party in remote) party['id'].toString(): party,
        };
        setState(() => _shown = byId.values.toList());
      }
    } catch (e) {
      if (mounted && request == _request) setState(() => _error = e is ApiException ? e.message : 'Could not load.');
    } finally {
      if (mounted && request == _request) setState(() => _loading = false);
    }
  }

  void _onChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () => _load(value));
  }

  String _subtitle(Map<String, dynamic> party) {
    final phone = party['phone']?.toString().trim() ?? '';
    final address = [
      party['billing_address'] ?? party['address'],
      party['city'],
      party['state'],
      party['pincode'],
    ].map((v) => v?.toString().trim() ?? '').where((v) => v.isNotEmpty).join(', ');
    return [phone, address].where((v) => v.isNotEmpty).join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    final title = widget.payable ? 'Supplier' : 'Customer';
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.85,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 8),
                width: 36,
                height: 4,
                decoration: BoxDecoration(color: AppColors.hairline, borderRadius: BorderRadius.circular(4)),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 8, 4),
              child: Row(
                children: [
                  Expanded(child: Text(title, style: AppText.heading)),
                  KIconButton(icon: LucideIcons.x, tooltip: 'Close', onTap: () => Navigator.of(context).pop()),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 4, AppSpace.gutter, AppSpace.sm),
              child: KSearchField(
                controller: _query,
                hint: 'Name, number or address',
                autofocus: true,
                onChanged: _onChanged,
              ),
            ),
            Expanded(
              child: _loading && _shown.isEmpty
                  ? const KSpinner()
                  : _error != null && _shown.isEmpty
                      ? KEmptyState(icon: LucideIcons.cloudOff, title: 'Could not load', body: _error)
                      : _shown.isEmpty
                          ? KEmptyState(icon: LucideIcons.userRound, title: 'No $title found', body: 'Try a name, phone number, or address.')
                          : ListView(
                              children: [
                                for (final party in _shown)
                                  KListRow(
                                    onTap: () => Navigator.of(context).pop(party),
                                    leading: KAvatar(name: party['name']?.toString() ?? ''),
                                    title: party['name']?.toString() ?? '',
                                    subtitle: _subtitle(party).isEmpty ? null : _subtitle(party),
                                    trailing: party['id'].toString() == widget.selectedId
                                        ? Icon(LucideIcons.check, size: 18, color: AppColors.brand)
                                        : null,
                                  ),
                              ],
                            ),
            ),
          ],
        ),
      ),
    );
  }
}
