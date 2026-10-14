import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/detail_panel_shell.dart';
import '../../ui/kit.dart';
import 'invoice_form_screen.dart';
import 'invoice_pdf_screen.dart';
import 'invoice_share.dart';
import 'record_payment_dialog.dart';

/// `formatINR` in `InvoiceDetailPanel.tsx`.
String formatInvoiceInr(dynamic n) => '$rupeeSign${enIn(toNum(n ?? 0), maxFraction: 2)}';

/// `deriveInvoicePaymentStatus` in `lib/invoice-payment-status.ts`.
String deriveInvoicePaymentStatus(dynamic grandTotal, dynamic paidAmount, dynamic balanceAmount) {
  final grand = toNum(grandTotal);
  final paid = toNum(paidAmount);
  final due = balanceAmount != null && balanceAmount != '' ? toNum(balanceAmount) : grand - paid;
  if (paid <= 0.01) return 'unpaid';
  if (due <= 0.01) return 'paid';
  return 'partially_paid';
}

DateTime? parseServerDate(dynamic v) => v == null ? null : DateTime.tryParse(v.toString())?.toLocal();

String capitalizeWords(String s) =>
    s.split(' ').map((w) => w.isEmpty ? w : w[0].toUpperCase() + w.substring(1)).join(' ');

/// `who • dd MMM yyyy, HH:mm` under each history entry.
String historyMeta(Map<String, dynamic> h) {
  final who = [h['user_name'], h['user_email']].map((e) => e?.toString() ?? '').firstWhere((e) => e.isNotEmpty, orElse: () => 'System');
  final at = parseServerDate(h['created_at']);
  final when = at == null ? '' : '${ddMMMyyyy(at)}, ${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}';
  return '$who • $when';
}

/// `components/invoices/InvoiceDetailPanel.tsx` inside `DetailPanelShell` (full screen on phones).
class InvoiceDetailScreen extends StatefulWidget {
  const InvoiceDetailScreen({super.key, required this.api, required this.invoiceId, this.businessName, this.session});

  final KhatarioApi api;
  final String invoiceId;
  final String? businessName;
  final AppSession? session;

  @override
  State<InvoiceDetailScreen> createState() => _InvoiceDetailScreenState();
}

enum _Tab { overview, transactions, history }

class _InvoiceDetailScreenState extends State<InvoiceDetailScreen> {
  Map<String, dynamic>? _invoice;
  bool _loading = true;
  _Tab _tab = _Tab.overview;
  List<Map<String, dynamic>>? _history;
  bool _historyLoading = false;

  @override
  void initState() {
    super.initState();
    _fetchInvoice();
  }

  Future<void> _fetchInvoice() async {
    setState(() => _loading = true);
    try {
      final data = await widget.api.getJson('/api/invoices/${widget.invoiceId}');
      final inv = data['invoice'];
      _invoice = inv is Map ? Map<String, dynamic>.from(inv) : null;
    } catch (_) {
      _invoice = null;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _fetchHistory() async {
    setState(() => _historyLoading = true);
    try {
      final data = await widget.api.getJson('/api/invoices/${widget.invoiceId}/history');
      final list = data['history'];
      _history = list is List ? list.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : [];
    } catch (_) {
      _history = [];
    } finally {
      if (mounted) setState(() => _historyLoading = false);
    }
  }

  void _selectTab(_Tab t) {
    setState(() => _tab = t);
    if (t == _Tab.history && _history == null && !_historyLoading) _fetchHistory();
  }

  Future<void> _share() async {
    final number = _invoice?['invoice_number']?.toString() ?? 'Invoice';
    final url = await fetchInvoiceShareUrl(widget.api, widget.invoiceId);
    if (!mounted) return;
    await SharePlus.instance.share(ShareParams(text: 'Invoice $number\n$url', subject: 'Invoice $number', title: 'Share invoice'));
  }

  Future<void> _collect(Map<String, dynamic> inv, num grand, num paid, num balance) async {
    final ok = await showRecordPaymentDialog(
      context,
      api: widget.api,
      invoiceId: widget.invoiceId,
      invoiceNumber: inv['invoice_number']?.toString() ?? '',
      grandTotal: grand,
      paidAmount: paid,
      balanceAmount: balance,
    );
    if (ok && mounted) _fetchInvoice();
  }

  void _openInvoiceView() {
    final inv = _invoice;
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => InvoicePdfScreen(
        api: widget.api,
        invoiceId: widget.invoiceId,
        invoiceNumber: inv?['invoice_number']?.toString() ?? 'Invoice',
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(child: _panel()),
    );
  }

  Widget _panel() {
    final inv = _invoice;
    if (_loading || inv == null) {
      return DetailPanelPlaceholder(loading: _loading, notFoundText: 'Invoice not found', onClose: () => Navigator.of(context).pop());
    }
    final grand = toNum(inv['grand_total']);
    final paid = toNum(inv['paid_amount']);
    final balance = inv['balance_amount'] != null ? toNum(inv['balance_amount']) : grand - paid;
    final due = balance > 0.01 && inv['status'] != 'cancelled';
    final canCollect = inv['status'] == 'final' && due;
    final date = parseServerDate(inv['invoice_date']);
    return DetailPanelShell<_Tab>(
      title: inv['invoice_number']?.toString() ?? 'Invoice',
      subtitle: [if (date != null) Text(ddMMMyyyy(date))],
      avatar: const SizedBox.shrink(),
      tabs: const [
        (_Tab.overview, 'Details', LucideIcons.clipboardList),
        (_Tab.transactions, 'Payments', LucideIcons.receipt),
        (_Tab.history, 'History', LucideIcons.history),
      ],
      activeTab: _tab,
      onTabChange: _selectTab,
      onClose: () => Navigator.of(context).pop(),
      moreActions: [
        if (widget.session != null && inv['status'] != 'cancelled' && inv['is_editable'] != false)
          DetailMoreAction(
            label: 'Edit',
            icon: LucideIcons.pencil,
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => InvoiceFormScreen(session: widget.session!, invoiceId: widget.invoiceId),
            )),
          ),
        DetailMoreAction(label: 'View invoice', icon: LucideIcons.externalLink, onTap: _openInvoiceView),
      ],
      header: _hero(inv, grand, paid, balance, due),
      body: switch (_tab) {
        _Tab.overview => _overview(inv),
        _Tab.transactions => _payments(inv),
        _Tab.history => _historyTab(),
      },
      bottomBar: KBottomBar(children: [
        KIconTile(icon: LucideIcons.fileText, label: 'View invoice', onTap: _openInvoiceView),
        if (canCollect) ...[
          KIconTile(icon: LucideIcons.share2, label: 'Share', onTap: _share),
          Expanded(
            child: KButton(
              label: 'Collect ${formatInvoiceInr(balance)}',
              icon: LucideIcons.handCoins,
              onPressed: () => _collect(inv, grand, paid, balance),
            ),
          ),
        ] else
          Expanded(child: KButton(label: 'Share invoice', icon: LucideIcons.share2, onPressed: _share)),
      ]),
    );
  }

  /// Party, grand total, payment state and how much of it is paid.
  Widget _hero(Map<String, dynamic> inv, num grand, num paid, num balance, bool due) {
    final name = inv['customer_name']?.toString() ?? '';
    final cancelled = inv['status'] == 'cancelled';
    final paymentStatus = cancelled
        ? (inv['payment_status']?.toString() ?? 'unpaid')
        : deriveInvoicePaymentStatus(inv['grand_total'], inv['paid_amount'], inv['balance_amount'] ?? balance);
    final docType = inv['document_type']?.toString() ?? '';
    final (KTone tone, String label) = cancelled
        ? (KTone.negative, 'Cancelled')
        : inv['status'] == 'draft'
            ? (KTone.neutral, 'Draft')
            : due
                ? (KTone.due, '${paymentStatus == 'partially_paid' ? 'Part paid' : 'Unpaid'} · ${formatInvoiceInr(balance)} due')
                : (KTone.positive, 'Paid');
    final ratio = grand <= 0 ? 0.0 : (paid / grand).clamp(0, 1).toDouble();
    return KCard(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 18),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              KAvatar(name: name, size: 28, muted: name.isEmpty, icon: name.isEmpty ? LucideIcons.banknote : null),
              const SizedBox(width: 8),
              Flexible(
                child: Text(name.isEmpty ? 'Cash sale' : name, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.bodyStrong),
              ),
            ],
          ),
          const SizedBox(height: 12),
          KAmount(grand, maxFraction: 2),
          const SizedBox(height: 8),
          KPill(label: label, tone: tone),
          if (!cancelled) ...[
            const SizedBox(height: 16),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: ratio,
                minHeight: 6,
                backgroundColor: AppColors.sunken,
                color: AppColors.positive,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Text('Paid ', style: AppText.caption.copyWith(color: AppColors.ink2)),
                Text(formatInvoiceInr(paid), style: AppText.label.copyWith(color: AppColors.ink, fontFeatures: AppText.tabular)),
                const Spacer(),
                if (docType.isNotEmpty) Text(capitalizeWords(docType.replaceAll('_', ' ')), style: AppText.caption),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _overview(Map<String, dynamic> inv) {
    final phone = inv['customer_phone']?.toString() ?? '';
    final grand = toNum(inv['grand_total']);
    final lines = inv['items'] is List ? (inv['items'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const <Map<String, dynamic>>[];
    final tax = lines.fold<num>(0, (sum, line) => sum + toNum(line['tax_amount']));
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.lg, AppSpace.gutter, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (lines.isNotEmpty)
            KCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  KDivided(
                    children: [
                      for (final line in lines)
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(line['item_name']?.toString() ?? '', maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.bodyStrong),
                                    const SizedBox(height: 2),
                                    Text(
                                      '${enIn(toNum(line['quantity']), maxFraction: 2)} × ${formatInvoiceInr(line['unit_price'])}',
                                      style: AppText.caption.copyWith(fontFeatures: AppText.tabular),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 12),
                              Text(formatInvoiceInr(line['line_total']), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
                            ],
                          ),
                        ),
                    ],
                  ),
                  Container(
                    padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
                    decoration: const BoxDecoration(color: Color(0xFFFBF9F5), border: Border(top: BorderSide(color: AppColors.hairline))),
                    child: Column(
                      children: [
                        if (tax > 0) _totalRow('GST', formatInvoiceInr(tax)),
                        _totalRow('Total', formatInvoiceInr(grand), strong: true),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          if (phone.isNotEmpty) ...[
            const SizedBox(height: AppSpace.md),
            KCard(
              child: KListRow(
                onTap: () => launchUrl(Uri(scheme: 'tel', path: phone)),
                leading: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(color: AppColors.sunken, borderRadius: BorderRadius.circular(12)),
                  child: const Icon(LucideIcons.phone, size: 18, color: AppColors.ink),
                ),
                title: phone,
                subtitle: 'Customer phone',
                trailing: const Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _totalRow(String label, String value, {bool strong = false}) {
    final style = strong ? AppText.bodyStrong.copyWith(fontSize: 16) : AppText.caption.copyWith(color: AppColors.ink2);
    return Padding(
      padding: EdgeInsets.only(top: strong ? 6 : 2),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          Text(value, style: style.copyWith(fontFeatures: AppText.tabular)),
        ],
      ),
    );
  }

  Widget _payments(Map<String, dynamic> inv) {
    final list = inv['payments'];
    final payments = list is List ? list.whereType<Map>().toList() : const <Map>[];
    if (payments.isEmpty) {
      return const DetailEmptyState(icon: LucideIcons.receipt, text: 'No payments recorded for this invoice.');
    }
    IconData modeIcon(String mode) => switch (mode) {
          'cash' => LucideIcons.banknote,
          'upi' => LucideIcons.smartphone,
          'card' => LucideIcons.creditCard,
          'cheque' => LucideIcons.fileCheck,
          _ => LucideIcons.landmark,
        };
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.lg, AppSpace.gutter, 0),
      child: KCard(
        child: KDivided(
          indent: 66,
          children: [
            for (final p in payments)
              KListRow(
                leading: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(color: AppColors.positiveSoft, borderRadius: BorderRadius.circular(12)),
                  child: Icon(modeIcon(p['payment_mode']?.toString() ?? ''), size: 18, color: AppColors.positive),
                ),
                title: capitalizeWords(p['payment_mode']?.toString() ?? ''),
                subtitle: parseServerDate(p['payment_date']) == null ? '-' : ddMMMyyyy(parseServerDate(p['payment_date'])!),
                trailing: Text(formatInvoiceInr(p['amount']),
                    style: AppText.bodyStrong.copyWith(color: AppColors.positive, fontFeatures: AppText.tabular)),
              ),
          ],
        ),
      ),
    );
  }

  Widget _historyTab() {
    final history = _history;
    if (_historyLoading && history == null) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 48));
    if (history != null && history.isEmpty) {
      return const DetailEmptyState(icon: LucideIcons.history, text: 'No activity recorded yet.');
    }
    return DetailHistoryTimeline(
      entries: [
        for (final h in history ?? const <Map<String, dynamic>>[])
          (description: h['description']?.toString() ?? '', meta: historyMeta(h), action: h['action_type']?.toString() ?? ''),
      ],
    );
  }
}
