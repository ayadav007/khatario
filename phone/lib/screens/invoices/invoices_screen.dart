import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../shell/shell_banners.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'invoice_detail_screen.dart';
import 'invoice_share.dart';
import 'record_payment_dialog.dart';

/// `INVOICE_STATUS_FILTERS` (mobile chips).
const invoiceStatusFilters = [
  ('all', 'All'),
  ('draft', 'Draft'),
  ('final', 'Final'),
  ('paid', 'Paid'),
  ('unpaid', 'Unpaid'),
];

/// `INVOICE_CHANNELS` / `CHANNEL_LABEL` in `lib/invoices/channel.ts`.
const invoiceChannelOptions = [
  ('all', 'All sources'),
  ('online_store', 'Online store'),
  ('whatsapp', 'WhatsApp'),
  ('counter', 'Counter'),
  ('manual', 'Manual'),
  ('sales_order', 'Sales order'),
];

const _pageSize = 25;

/// In-memory filtering from `app/(app)/invoices/page.tsx`.
List<Map<String, dynamic>> filterInvoices(
  List<Map<String, dynamic>> all, {
  required String search,
  required String status,
  required String channel,
}) {
  var list = all.where((i) => i['status'] != 'cancelled' && i['document_type'] != 'proforma_invoice');
  final q = search.trim().toLowerCase();
  if (q.isNotEmpty) {
    list = list.where((i) =>
        (i['invoice_number']?.toString().toLowerCase().contains(q) ?? false) ||
        (i['customer_name']?.toString().toLowerCase().contains(q) ?? false));
  }
  if (status != 'all') {
    list = list.where((i) => switch (status) {
          'draft' || 'final' || 'cancelled' => i['status'] == status,
          'paid' || 'unpaid' => i['payment_status'] == status,
          _ => true,
        });
  }
  if (channel != 'all') list = list.where((i) => (i['channel'] ?? 'manual') == channel);
  return list.toList();
}

/// `app/(app)/invoices/page.tsx` at the phone breakpoint.
class InvoicesScreen extends StatefulWidget {
  const InvoicesScreen({
    super.key,
    required this.session,
    required this.banners,
    required this.onOpen,
    required this.onPaymentRecorded,
  });

  final AppSession session;
  final ShellBannersController banners;
  final ValueChanged<String> onOpen;

  /// `refreshBadgeCounts` after a payment.
  final VoidCallback onPaymentRecorded;

  @override
  State<InvoicesScreen> createState() => _InvoicesScreenState();
}

class _InvoicesScreenState extends State<InvoicesScreen> {
  final _search = TextEditingController();
  String _status = 'all';
  String _channel = 'all';
  int _page = 1;
  List<Map<String, dynamic>> _all = const [];
  bool _loading = true;
  int _request = 0;

  KhatarioApi get _api => widget.session.api;

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

  /// Status and channel go to the API (not only the in-memory filter) so older drafts are not missed.
  Future<void> _load({bool showSpinner = true}) async {
    final request = ++_request;
    if (showSpinner) setState(() => _loading = true);
    final query = <String, String>{'limit': '100'};
    final branch = widget.session.defaultBranchId;
    if (branch != null) query['branch_id'] = branch;
    if (_status != 'all') query['status'] = _status;
    if (_channel != 'all') query['channel'] = _channel;
    try {
      final body = await _api.getJson(Uri(path: '/api/invoices', queryParameters: query).toString());
      final list = body['invoices'];
      if (request != _request || !mounted) return;
      setState(() {
        _all = list is List ? list.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [];
      });
    } catch (_) {
      if (request != _request || !mounted) return;
      setState(() => _all = const []);
    } finally {
      if (request == _request && mounted) setState(() => _loading = false);
    }
  }

  void _setStatus(String s) {
    if (s == _status) return;
    setState(() {
      _status = s;
      _page = 1;
    });
    _load();
  }

  void _setChannel(String c) {
    setState(() {
      _channel = c;
      _page = 1;
    });
    _load();
  }

  void _openDetail(Map<String, dynamic> invoice) {
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => InvoiceDetailScreen(
        api: _api,
        invoiceId: invoice['id'].toString(),
        businessName: widget.session.businessName,
        session: widget.session,
      ),
    ));
  }

  void _share(Map<String, dynamic> invoice) {
    showShareInvoiceSheet(
      context,
      session: widget.session,
      invoiceId: invoice['id'].toString(),
      invoiceNumber: invoice['invoice_number']?.toString() ?? '',
    );
  }

  Future<void> _recordPayment(Map<String, dynamic> invoice) async {
    final grand = toNum(invoice['grand_total']);
    final balance = invoice['balance_amount'];
    final ok = await showRecordPaymentDialog(
      context,
      api: _api,
      invoiceId: invoice['id'].toString(),
      invoiceNumber: invoice['invoice_number']?.toString() ?? '',
      grandTotal: grand,
      paidAmount: toNum(invoice['paid_amount']),
      balanceAmount: balance == null || balance == '' || balance == 0 ? grand : toNum(balance),
    );
    if (!ok || !mounted) return;
    widget.onPaymentRecorded();
    _load(showSpinner: false);
  }

  /// Long-press menu on a row: the actions that used to sit as small icons on every row.
  void _rowActions(Map<String, dynamic> invoice) {
    final number = invoice['invoice_number']?.toString() ?? '';
    showKSheet<void>(
      context,
      title: number.isEmpty ? 'Invoice' : number,
      builder: (ctx) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          KSheetAction(
            icon: LucideIcons.fileText,
            label: 'Open',
            onTap: () {
              Navigator.of(ctx).pop();
              _openDetail(invoice);
            },
          ),
          KSheetAction(
            icon: LucideIcons.share2,
            label: 'Share',
            onTap: () {
              Navigator.of(ctx).pop();
              _share(invoice);
            },
          ),
          if (InvoiceListRow.canRecordPayment(invoice))
            KSheetAction(
              icon: LucideIcons.handCoins,
              label: 'Record payment',
              onTap: () {
                Navigator.of(ctx).pop();
                _recordPayment(invoice);
              },
            ),
        ],
      ),
    );
  }

  static String _groupLabel(DateTime? d) {
    if (d == null) return 'No date';
    final today = dateOnly(DateTime.now());
    final day = dateOnly(d);
    if (day == today) return 'Today';
    if (day == today.subtract(const Duration(days: 1))) return 'Yesterday';
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return day.year == today.year ? '${weekdays[day.weekday - 1]}, ${dMMM(day)}' : ddMMMyyyy(day);
  }

  @override
  Widget build(BuildContext context) {
    final filtered = filterInvoices(_all, search: _search.text, status: _status, channel: _channel);
    final shown = filtered.take(_page * _pageSize).toList();
    final groups = <(String, List<Map<String, dynamic>>)>[];
    for (final inv in shown) {
      final label = _groupLabel(parseServerDate(inv['invoice_date']));
      if (groups.isEmpty || groups.last.$1 != label) {
        groups.add((label, [inv]));
      } else {
        groups.last.$2.add(inv);
      }
    }
    final channelLabel = invoiceChannelOptions.firstWhere((o) => o.$1 == _channel).$2;

    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: () => _load(showSpinner: false),
      child: ListView(
        padding: const EdgeInsets.only(bottom: 112),
        children: [
          ShellBanners(controller: widget.banners, placement: BannerPlacement.compact, onOpen: widget.onOpen),
          KPageTitle(
            'Invoices',
            trailing: _loading ? null : Text('${filtered.length} bills', style: AppText.label),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
            child: InlineUsageBanner(session: widget.session, limitType: 'invoices', onViewPlans: () => widget.onOpen('Subscription')),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 0),
            child: KSearchField(
              controller: _search,
              hint: 'Number or customer',
              onChanged: (_) => setState(() => _page = 1),
              trailing: KSquareButton(
                icon: LucideIcons.slidersHorizontal,
                label: 'Source: $channelLabel',
                active: _channel != 'all',
                onTap: () => showKPicker<String>(
                  context,
                  title: 'Source',
                  value: _channel,
                  options: invoiceChannelOptions,
                  onChanged: _setChannel,
                ),
              ),
            ),
          ),
          const SizedBox(height: AppSpace.md),
          KChipBar<String>(value: _status, options: invoiceStatusFilters, onChanged: _setStatus),
          if (_channel != 'all')
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, 0),
              child: Row(
                children: [
                  Text('Source: ', style: AppText.caption),
                  Text(channelLabel, style: AppText.label.copyWith(color: AppColors.ink)),
                  const SizedBox(width: 8),
                  KTextButton(label: 'Clear', onTap: () => _setChannel('all')),
                ],
              ),
            ),
          if (_loading)
            const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
          else if (filtered.isEmpty)
            KEmptyState(
              icon: LucideIcons.fileSearch,
              title: 'No invoices found',
              body: _search.text.isNotEmpty || _status != 'all' || _channel != 'all'
                  ? 'Try another search or filter.'
                  : 'Bills you create will show here.',
            )
          else ...[
            for (final (label, rows) in groups) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter + 2, AppSpace.xl, AppSpace.gutter + 2, AppSpace.sm),
                child: Text(label.toUpperCase(), style: AppText.overline),
              ),
              KCard(
                margin: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
                child: KDivided(
                  indent: 66,
                  children: [
                    for (final inv in rows)
                      InvoiceListRow(
                        invoice: inv,
                        onOpen: () => _openDetail(inv),
                        onLongPress: () => _rowActions(inv),
                      ),
                  ],
                ),
              ),
            ],
            if (shown.length < filtered.length)
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.lg, AppSpace.gutter, 0),
                child: KButton.secondary(
                  label: 'Show more (${filtered.length - shown.length} left)',
                  onPressed: () => setState(() => _page++),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

/// One invoice: party, number, amount and payment status. Long-press for Share / Record payment.
class InvoiceListRow extends StatelessWidget {
  const InvoiceListRow({
    super.key,
    required this.invoice,
    required this.onOpen,
    this.onLongPress,
  });

  final Map<String, dynamic> invoice;
  final VoidCallback onOpen;
  final VoidCallback? onLongPress;

  static String paymentLabel(Map<String, dynamic> invoice) {
    final raw = (invoice['payment_status']?.toString() ?? 'unpaid').replaceAll('_', ' ');
    return raw.isEmpty ? 'unpaid' : raw;
  }

  static bool canRecordPayment(Map<String, dynamic> invoice) =>
      invoice['status'] == 'final' && invoice['payment_status'] != 'paid';

  @override
  Widget build(BuildContext context) {
    final customer = invoice['customer_name']?.toString() ?? '';
    final number = invoice['invoice_number']?.toString() ?? '';
    final draft = invoice['status'] == 'draft';
    final status = draft ? 'draft' : (invoice['payment_status']?.toString() ?? 'unpaid');
    final channel = invoiceChannelOptions.where((o) => o.$1 == invoice['channel'] && o.$1 != 'manual').map((o) => o.$2).firstOrNull;
    return KListRow(
      onTap: onOpen,
      onLongPress: onLongPress,
      leading: KAvatar(name: customer, muted: customer.isEmpty, icon: customer.isEmpty ? LucideIcons.banknote : null),
      title: customer.isEmpty ? 'Cash sale' : customer,
      subtitle: [if (number.isNotEmpty) number, ?channel].join(' · '),
      trailing: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(formatInvoiceInr(invoice['grand_total']), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
          const SizedBox(height: 2),
          KStatusDot.status(status),
        ],
      ),
    );
  }
}
