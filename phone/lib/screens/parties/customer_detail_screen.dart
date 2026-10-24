import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../api.dart';
import '../../capability.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/detail_panel_shell.dart';
import '../hub/hub_link_cards.dart';
import '../../ui/kit.dart';
import '../../whatsapp_compose.dart';
import '../invoices/invoice_detail_screen.dart';
import 'customer_form_screen.dart';
import 'customer_statement_screen.dart';
import 'party_logic.dart';

/// `CustomerDetailPanel`: Overview, Transactions, Ledger, History, and the portal card.
class CustomerDetailScreen extends StatefulWidget {
  const CustomerDetailScreen({super.key, required this.session, required this.customerId, required this.onOpen, this.capabilities});

  final AppSession session;
  final String customerId;
  final void Function(String what) onOpen;
  final Capabilities? capabilities;

  @override
  State<CustomerDetailScreen> createState() => _CustomerDetailScreenState();
}

class _CustomerDetailScreenState extends State<CustomerDetailScreen> {
  Map<String, dynamic>? _customer;
  List<Map<String, dynamic>> _transactions = const [];
  num _totalReceivable = 0;
  bool _loading = true;
  bool _missing = false;
  String _tab = 'overview';
  List<Map<String, dynamic>>? _history;
  bool _historyLoading = false;
  String _ledgerPreset = 'current_month';
  Map<String, dynamic>? _ledger;
  bool _ledgerLoading = false;
  String? _ledgerError;
  bool _sendingReminder = false;

  KhatarioApi get _api => widget.session.api;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await _api.getJson('/api/customers/${widget.customerId}');
      if (!mounted) return;
      final customer = body['customer'];
      setState(() {
        _customer = customer is Map ? Map<String, dynamic>.from(customer) : null;
        _missing = customer is! Map;
        _transactions = _rows(body['transactions']);
        _totalReceivable = toNum(body['totalReceivable']);
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() { _missing = true; _loading = false; });
    }
  }

  List<Map<String, dynamic>> _rows(dynamic value) =>
      value is List ? value.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [];

  Future<void> _loadHistory() async {
    setState(() => _historyLoading = true);
    try {
      final body = await _api.getJson('/api/customers/${widget.customerId}/history');
      if (!mounted) return;
      setState(() => _history = _rows(body['history']));
    } catch (_) {
      if (mounted) setState(() => _history = const []);
    } finally {
      if (mounted) setState(() => _historyLoading = false);
    }
  }

  Future<void> _loadLedger() async {
    final range = ledgerRange(_ledgerPreset, DateTime.now());
    final query = <String, String>{
      'party_type': 'customer',
      'party_id': widget.customerId,
      if (widget.session.businessId != null) 'business_id': widget.session.businessId!,
      if (widget.session.user['id'] != null) 'user_id': widget.session.user['id'].toString(),
      if (range.fromDate != null) 'from_date': range.fromDate!,
      if (range.toDate != null) 'to_date': range.toDate!,
    };
    setState(() { _ledgerLoading = true; _ledgerError = null; });
    try {
      final body = await _api.getJson(Uri(path: '/api/reports/party/ledger', queryParameters: query).toString());
      if (!mounted) return;
      setState(() => _ledger = body);
    } on ApiException catch (e) {
      if (mounted) setState(() { _ledgerError = e.message; _ledger = null; });
    } catch (_) {
      if (mounted) setState(() { _ledgerError = 'Could not load ledger'; _ledger = null; });
    } finally {
      if (mounted) setState(() => _ledgerLoading = false);
    }
  }

  void _selectTab(String id) {
    setState(() => _tab = id);
    if (id == 'history' && _history == null) _loadHistory();
    if (id == 'ledger' && _ledger == null && !_ledgerLoading) _loadLedger();
  }

  Future<void> _edit() async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => CustomerFormScreen(
        session: widget.session,
        capabilities: widget.capabilities,
        customerId: widget.customerId,
      ),
    ));
    if (saved == true) _load();
  }

  Future<void> _sendReminder() async {
    setState(() => _sendingReminder = true);
    var message = 'Failed to send reminders. Please try again.';
    try {
      final data = await _api.postJson('/api/customers/${widget.customerId}/send-reminder', reminderRequestBody(widget.session.businessId));
      message = reminderOutcome(ok: true, data: data).message;
    } on ApiException catch (e) {
      message = reminderOutcome(ok: false, data: {'error': e.message}).message;
    } catch (_) {}
    if (!mounted) return;
    setState(() => _sendingReminder = false);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _statement(bool share) async {
    final range = ledgerRange(_ledgerPreset, DateTime.now());
    if (range.fromDate == null || range.toDate == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(share ? 'Select a date range to share statement' : 'Select a date range to download statement')),
      );
      return;
    }
    final query = <String, String>{
      'party_type': 'customer',
      'party_id': widget.customerId,
      'from_date': range.fromDate!,
      'to_date': range.toDate!,
      if (widget.session.businessId != null) 'business_id': widget.session.businessId!,
      if (widget.session.user['id'] != null) 'user_id': widget.session.user['id'].toString(),
    };
    try {
      final bytes = await _api.getBytes(Uri(path: '/api/reports/party/statement/pdf', queryParameters: query).toString());
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/statement-${range.fromDate}-${range.toDate}.pdf');
      await file.writeAsBytes(bytes, flush: true);
      await SharePlus.instance.share(ShareParams(
        files: [XFile(file.path, mimeType: 'application/pdf')],
        subject: 'Customer statement',
      ));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not share statement')));
    }
  }

  void _openStatement() => Navigator.of(context).push(MaterialPageRoute<void>(
        builder: (_) => CustomerStatementScreen(session: widget.session, customerId: widget.customerId),
      ));

  @override
  Widget build(BuildContext context) {
    final customer = _customer;
    if (_loading || _missing || customer == null) {
      return Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: DetailPanelPlaceholder(loading: _loading, notFoundText: 'Customer not found', onClose: () => Navigator.pop(context)),
        ),
      );
    }
    final balance = partyBalance(customer['current_balance'], customer['opening_balance']);
    final phone = customer['phone']?.toString() ?? '';
    final name = customer['name']?.toString() ?? 'Customer';
    final canRemind = balance > 0 && phone.isNotEmpty;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: DetailPanelShell<String>(
          title: name,
          subtitle: [
            if ((customer['company_name']?.toString().isNotEmpty ?? false)) Text(customer['company_name'].toString()),
            if (phone.isNotEmpty) Text(phone),
          ],
          avatar: KAvatar(name: name, size: 36),
          tabs: const [
            ('overview', 'Overview', LucideIcons.user),
            ('transactions', 'Transactions', LucideIcons.receipt),
            ('ledger', 'Ledger', LucideIcons.bookOpen),
            ('history', 'History', LucideIcons.history),
          ],
          activeTab: _tab,
          onTabChange: _selectTab,
          onClose: () => Navigator.of(context).pop(),
          actions: [
            Tooltip(message: 'Edit', child: KIconButton(icon: LucideIcons.pencil, tooltip: 'Edit', onTap: _edit)),
          ],
          moreActions: [
            DetailMoreAction(label: 'View statement', icon: LucideIcons.fileText, onTap: _openStatement),
            if (canRemind) DetailMoreAction(label: 'Send WhatsApp reminder', icon: LucideIcons.messageCircle, whatsApp: true, onTap: _sendReminder),
          ],
          header: _BalanceHero(balance: balance, totalReceivable: _totalReceivable),
          body: switch (_tab) {
            'transactions' => _Transactions(
                customerId: widget.customerId,
                rows: _transactions,
                api: _api,
                session: widget.session,
                onOpen: widget.onOpen,
              ),
            'ledger' => _Ledger(
                preset: _ledgerPreset,
                loading: _ledgerLoading,
                error: _ledgerError,
                body: _ledger,
                onPreset: (preset) {
                  setState(() {
                    _ledgerPreset = preset;
                    _ledger = null;
                  });
                  _loadLedger();
                },
                onDownload: () => _statement(false),
                onShare: () => _statement(true),
              ),
            'history' => _History(loading: _historyLoading, rows: _history),
            _ => _Overview(customer: customer, api: _api, session: widget.session),
          },
          bottomBar: KBottomBar(children: [
            if (phone.isNotEmpty) KIconTile(icon: LucideIcons.phone, label: 'Call', onTap: () => launchUrl(Uri(scheme: 'tel', path: phone))),
            if (canRemind)
              KIconTile(
                icon: _sendingReminder ? LucideIcons.loaderCircle : LucideIcons.messageCircle,
                whatsApp: !_sendingReminder,
                label: 'Send reminder',
                onTap: _sendingReminder ? () {} : _sendReminder,
              ),
            Expanded(
              child: KButton(
                label: 'New bill',
                icon: LucideIcons.plus,
                onPressed: () => widget.onOpen('New invoice:${widget.customerId}'),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}

String _inr(dynamic value) => '$rupeeSign${enIn(toNum(value), maxFraction: 2)}';

/// Balance on top of the customer page: how much they owe, or that they are clear.
class _BalanceHero extends StatelessWidget {
  const _BalanceHero({required this.balance, required this.totalReceivable});

  final num balance;
  final num totalReceivable;

  @override
  Widget build(BuildContext context) {
    final settled = isPartyBalanceSettled(balance);
    final owes = balance > 0;
    final tone = settled ? KTone.positive : KTone.negative;
    return KCard(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(customerBalanceHint(balance), style: AppText.label),
                const SizedBox(height: 4),
                settled
                    ? Text('All clear', style: AppText.amount.copyWith(color: AppColors.positive))
                    : KAmount(balance.abs(), style: AppText.amount, maxFraction: 2, color: tone.fg),
                if (totalReceivable != 0 && !settled) ...[
                  const SizedBox(height: 4),
                  Text('Total receivable ${_inr(totalReceivable)}', style: AppText.caption.copyWith(fontSize: 12)),
                ],
              ],
            ),
          ),
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(color: tone.bg, borderRadius: BorderRadius.circular(16)),
            child: Icon(settled ? LucideIcons.circleCheck : (owes ? LucideIcons.arrowDownLeft : LucideIcons.arrowUpRight), color: tone.fg),
          ),
        ],
      ),
    );
  }
}

class _Overview extends StatelessWidget {
  const _Overview({required this.customer, required this.api, required this.session});

  final Map<String, dynamic> customer;
  final KhatarioApi api;
  final AppSession session;

  String? _s(dynamic v) {
    final t = v?.toString().trim() ?? '';
    return t.isEmpty ? null : t;
  }

  @override
  Widget build(BuildContext context) {
    final billing = _s(customer['billing_address']) ?? _s(customer['address']);
    final cityLine = [customer['city'], customer['state'], customer['pincode']].map(_s).whereType<String>().join(', ');
    final shipping = _s(customer['shipping_address']);
    final tags = customer['tags'];
    final address = [?billing, if (cityLine.isNotEmpty) cityLine].join('\n');
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xl, AppSpace.gutter, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_s(customer['linked_business_id']) != null && _s(customer['id']) != null)
            HubCustomerLinkCard(session: session, customerId: customer['id'].toString()),
          KInfoCard(title: 'Primary Details', rows: [
            ('Name', _s(customer['name']) ?? ''),
            if (_s(customer['company_name']) != null) ('Company', _s(customer['company_name'])!),
            if (_s(customer['phone']) != null) ('Phone', _s(customer['phone'])!),
            if (_s(customer['email']) != null) ('Email', _s(customer['email'])!),
            if (_s(customer['gstin']) != null) ('GSTIN', _s(customer['gstin'])!),
            if (toNum(customer['credit_limit']) > 0) ('Credit limit', _inr(customer['credit_limit'])),
            ('Opening balance', '${_inr(customer['opening_balance'])} (${customer['opening_balance_type'] ?? ''})'),
          ]),
          if (address.isNotEmpty || (shipping != null && shipping != billing)) ...[
            const SizedBox(height: AppSpace.xl),
            KInfoCard(title: 'Address', rows: [
              if (address.isNotEmpty) ('Billing', address),
              if (shipping != null && shipping != billing) ('Shipping', shipping),
            ]),
          ],
          if (_s(customer['notes']) != null || (tags is List && tags.isNotEmpty)) ...[
            const SizedBox(height: AppSpace.xl),
            KInfoCard(
              title: 'Notes',
              rows: [if (_s(customer['notes']) != null) ('Notes', _s(customer['notes'])!)],
              child: tags is List && tags.isNotEmpty
                  ? Padding(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      child: Wrap(spacing: 6, runSpacing: 6, children: [for (final tag in tags) KPill(label: tag.toString(), tone: KTone.neutral)]),
                    )
                  : null,
            ),
          ],
          const SizedBox(height: AppSpace.xl),
          CustomerPortalCard(
            api: api,
            customerId: customer['id'].toString(),
            email: customer['email']?.toString(),
            phone: customer['phone']?.toString(),
            initialEnabled: customer['portal_enabled'] == true,
          ),
        ],
      ),
    );
  }
}

class CustomerPortalCard extends StatefulWidget {
  const CustomerPortalCard({
    super.key,
    required this.api,
    required this.customerId,
    required this.email,
    required this.phone,
    required this.initialEnabled,
  });

  final KhatarioApi api;
  final String customerId;
  final String? email;
  final String? phone;
  final bool initialEnabled;

  @override
  State<CustomerPortalCard> createState() => _CustomerPortalCardState();
}

class _CustomerPortalCardState extends State<CustomerPortalCard> {
  late bool _enabled = widget.initialEnabled;
  String? _portalUrl;
  bool _busy = false;
  bool _copied = false;

  @override
  void initState() {
    super.initState();
    _loadUrl();
  }

  Future<void> _loadUrl() async {
    try {
      final body = await widget.api.getJson('/api/settings/customer-surface');
      final url = body['portal_url']?.toString();
      if (mounted && url != null && url.isNotEmpty) setState(() => _portalUrl = url);
    } catch (_) {}
  }

  Future<void> _update(bool next, bool sendInvite) async {
    if (next && (widget.email == null || widget.email!.trim().isEmpty)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Add an email on this customer before enabling the portal.')),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      final data = await widget.api.patchJson('/api/customers/${widget.customerId}/portal', {
        'portal_enabled': next,
        'send_invite': sendInvite,
      });
      if (!mounted) return;
      setState(() {
        _enabled = next;
        final url = data['portal_url']?.toString();
        if (url != null && url.isNotEmpty) _portalUrl = url;
      });
      final message = next
          ? (sendInvite ? 'Portal enabled and invite sent' : 'Portal enabled for this customer')
          : 'Portal access disabled';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to update portal access')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendPortalLink(String url) async {
    final digits = (widget.phone ?? '').replaceAll(RegExp(r'\D'), '');
    final to = digits.length == 10 ? '91$digits' : digits;
    await composeBusinessWhatsApp(
      context,
      widget.api,
      to: to,
      message: 'Your bills are here: $url',
      title: 'Customer portal',
    );
  }

  @override
  Widget build(BuildContext context) {
    final url = _portalUrl;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const KSectionHeader('Customer portal'),
        KCard(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(color: AppTints.indigo.$1, borderRadius: BorderRadius.circular(12)),
                    child: Icon(LucideIcons.globe, size: 18, color: AppTints.indigo.$2),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Let this customer sign in with their email to see all their bills with you.',
                      style: AppText.caption.copyWith(color: AppColors.ink2),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: Text('Enable customer portal', style: AppText.bodyStrong.copyWith(fontWeight: FontWeight.w500))),
                  Switch.adaptive(
                    value: _enabled,
                    activeTrackColor: AppColors.brand,
                    activeThumbColor: AppColors.onBrand,
                    onChanged: _busy ? null : (v) => _update(v, false),
                  ),
                ],
              ),
              if (url != null) ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
                  decoration: BoxDecoration(color: AppColors.sunken, borderRadius: BorderRadius.circular(AppRadius.sm)),
                  child: Row(
                    children: [
                      Expanded(child: Text(url, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppText.caption.copyWith(color: AppColors.ink))),
                      KTextButton(
                        label: _copied ? 'Copied' : 'Copy',
                        onTap: () async {
                          await Clipboard.setData(ClipboardData(text: url));
                          setState(() => _copied = true);
                          await Future<void>.delayed(const Duration(seconds: 2));
                          if (mounted) setState(() => _copied = false);
                        },
                      ),
                      const SizedBox(width: 8),
                      KTextButton(label: 'Send link', onTap: () => _sendPortalLink(url)),
                      const SizedBox(width: 8),
                    ],
                  ),
                ),
              ],
              if (_enabled && widget.email != null && widget.email!.trim().isNotEmpty) ...[
                const SizedBox(height: 12),
                KButton.secondary(label: 'Send invite email', icon: LucideIcons.mail, loading: _busy, onPressed: () => _update(true, true)),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _Transactions extends StatelessWidget {
  const _Transactions({required this.customerId, required this.rows, required this.api, required this.session, required this.onOpen});

  final String customerId;
  final List<Map<String, dynamic>> rows;
  final KhatarioApi api;
  final AppSession session;
  final void Function(String what) onOpen;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) {
      return KEmptyState(
        icon: LucideIcons.receipt,
        title: 'No transactions yet.',
        action: KButton(label: 'New bill', icon: LucideIcons.plus, expand: false, onPressed: () => onOpen('New invoice:$customerId')),
      );
    }
    final invoices = rows.where((t) => t['type'] == 'invoice' && t['document_type'] != 'proforma_invoice').toList();
    final estimates = rows.where((t) => t['type'] == 'invoice' && t['document_type'] == 'proforma_invoice').toList();
    final payments = rows.where((t) => t['type'] == 'payment').toList();

    Widget section(String title, String action, VoidCallback onAction, List<Widget> children, String empty) => Padding(
          padding: const EdgeInsets.only(top: AppSpace.xl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              KSectionHeader(title, action: action, onAction: onAction),
              KCard(
                child: children.isEmpty
                    ? Padding(padding: const EdgeInsets.all(16), child: Text(empty, style: AppText.caption))
                    : KDivided(indent: 66, children: children),
              ),
            ],
          ),
        );

    Widget docIcon(IconData icon, (Color, Color) tint) => Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(color: tint.$1, borderRadius: BorderRadius.circular(12)),
          child: Icon(icon, size: 18, color: tint.$2),
        );

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          section(
            'Invoices (${invoices.length})',
            '+ New',
            () => onOpen('New invoice:$customerId'),
            [
              for (final tx in invoices)
                KListRow(
                  onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
                    builder: (_) => InvoiceDetailScreen(api: api, invoiceId: tx['id'].toString(), session: session),
                  )),
                  leading: docIcon(LucideIcons.fileText, AppTints.sky),
                  title: tx['ref_no']?.toString() ?? '',
                  subtitle: [
                    partyDay(tx['date']),
                    if (toNum(tx['balance_amount']) > 0.005) 'Due ${_inr(tx['balance_amount'])}',
                  ].join(' · '),
                  trailing: Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_inr(tx['amount']), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
                      const SizedBox(height: 2),
                      KStatusDot.status(_invoiceStatus(tx)),
                    ],
                  ),
                ),
            ],
            'No invoices for this customer.',
          ),
          section(
            'Quotes & estimates (${estimates.length})',
            '+ New',
            () => onOpen('New estimate'),
            [
              for (final tx in estimates)
                KListRow(
                  leading: docIcon(LucideIcons.fileSpreadsheet, AppTints.violet),
                  title: tx['ref_no']?.toString() ?? '',
                  subtitle: partyDay(tx['date']),
                  trailing: KStatusDot.status(tx['estimate_status']?.toString() ?? tx['status']?.toString() ?? 'draft'),
                ),
            ],
            'No estimates for this customer.',
          ),
          section(
            'Payments (${payments.length})',
            '+ New',
            () => onOpen('New payment'),
            [
              for (final tx in payments)
                KListRow(
                  leading: docIcon(LucideIcons.handCoins, AppTints.green),
                  title: tx['ref_no']?.toString() ?? '',
                  subtitle: '${partyDay(tx['date'])} · ${tx['payment_mode'] ?? '—'}',
                  trailing: Text(
                    _inr(toNum(tx['amount']).abs()),
                    style: AppText.bodyStrong.copyWith(color: AppColors.positive, fontFeatures: AppText.tabular),
                  ),
                ),
            ],
            'No payments recorded.',
          ),
        ],
      ),
    );
  }

  String _invoiceStatus(Map<String, dynamic> tx) {
    final status = tx['status']?.toString();
    if (status == 'cancelled') return 'cancelled';
    if (status == 'draft') return 'draft';
    return tx['payment_status']?.toString() ?? 'unpaid';
  }
}

class _Ledger extends StatelessWidget {
  const _Ledger({
    required this.preset,
    required this.loading,
    required this.error,
    required this.body,
    required this.onPreset,
    required this.onDownload,
    required this.onShare,
  });

  final String preset;
  final bool loading;
  final String? error;
  final Map<String, dynamic>? body;
  final ValueChanged<String> onPreset;
  final VoidCallback onDownload;
  final VoidCallback onShare;

  /// `formatInr` in `CustomerLedgerView.tsx`: `₹ 1,250` / `₹ 1,250.5`.
  static String _money(num n) => '₹ ${enIn(n, maxFraction: 2)}';

  @override
  Widget build(BuildContext context) {
    final range = ledgerRange(preset, DateTime.now());
    final rows = body == null
        ? const <Map<String, dynamic>>[]
        : (body!['transactions'] is List
            ? (body!['transactions'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
            : const <Map<String, dynamic>>[]);
    final closing = body == null || body!['closing_balance'] == null ? null : toNum(body!['closing_balance']);
    final opening = toNum(body?['opening_balance']);
    num debit = 0;
    num credit = 0;
    for (final row in rows) {
      debit += toNum(row['debit']);
      credit += toNum(row['credit']);
    }
    final summary = closing == null ? null : customerStatementSummary(closing);
    final drCr = summary == null ? '' : (summary.signedClosing > 0.005 ? 'Dr' : (summary.signedClosing < -0.005 ? 'Cr' : ''));
    final netColor = summary == null
        ? AppColors.ink
        : (summary.signedClosing > 0.005 ? AppColors.negative : (summary.signedClosing < -0.005 ? AppColors.positive : AppColors.ink));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: AppSpace.lg),
        KChipBar<String>(
          value: preset,
          options: [for (final e in ledgerRangeLabels.entries) (e.key, e.value)],
          onChanged: onPreset,
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Debit increases amount due; credit is payment received.', style: AppText.caption.copyWith(fontSize: 12)),
              const SizedBox(height: AppSpace.md),
              if (summary != null && !loading && error == null) ...[
                KCard(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text.rich(
                        TextSpan(children: [
                          const TextSpan(text: 'Ledger Summary '),
                          TextSpan(text: '(${range.label})', style: AppText.caption.copyWith(fontSize: 12)),
                        ]),
                        style: AppText.bodyStrong.copyWith(fontSize: 14),
                      ),
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        decoration: BoxDecoration(
                          color: netColor == AppColors.ink ? AppColors.sunken : netColor.withValues(alpha: 0.08),
                          borderRadius: BorderRadius.circular(AppRadius.md),
                        ),
                        child: Column(
                          children: [
                            Text('Net Balance', style: AppText.caption.copyWith(fontSize: 12)),
                            const SizedBox(height: 2),
                            Text(
                              '${_money(summary.amount)} $drCr'.trim(),
                              style: AppText.amount.copyWith(fontSize: 28, color: netColor),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Expanded(child: _TotalBox(label: 'Total Debit (-)', value: _money(debit))),
                          const SizedBox(width: 10),
                          Expanded(child: _TotalBox(label: 'Total Credit (+)', value: _money(credit))),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpace.lg),
              ],
              if (loading) const KSpinner(),
              if (!loading && error != null)
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(color: AppColors.dueSoft, borderRadius: BorderRadius.circular(AppRadius.md)),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Ledger could not be loaded', style: AppText.bodyStrong.copyWith(color: AppColors.due)),
                      const SizedBox(height: 4),
                      Text(error!, style: AppText.caption.copyWith(color: AppColors.due)),
                    ],
                  ),
                ),
              if (!loading && error == null && rows.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 32),
                  child: Text('No ledger entries in this period.', textAlign: TextAlign.center, style: AppText.body.copyWith(color: AppColors.ink2)),
                ),
              if (!loading && error == null && rows.isNotEmpty) ...[
                Text('Transaction history', style: AppText.bodyStrong.copyWith(fontSize: 14)),
                const SizedBox(height: 8),
                KCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Container(
                        color: AppColors.sunken.withValues(alpha: 0.6),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        child: Row(
                          children: [
                            Expanded(child: Text('TRANSACTIONS', style: AppText.overline.copyWith(fontSize: 10))),
                            SizedBox(width: _LedgerRow.amountWidth, child: Text('DEBIT', textAlign: TextAlign.right, style: AppText.overline.copyWith(fontSize: 10))),
                            SizedBox(width: _LedgerRow.amountWidth, child: Text('CREDIT', textAlign: TextAlign.right, style: AppText.overline.copyWith(fontSize: 10))),
                          ],
                        ),
                      ),
                      KDivided(
                        children: [
                          if (range.fromDate != null)
                            _LedgerRow(
                              title: 'Opening balance',
                              date: null,
                              detail: '(on ${partyDay(range.fromDate)})',
                              debit: opening > 0 ? _money(opening) : '—',
                              credit: opening < 0 ? _money(opening.abs()) : '—',
                              bold: true,
                            ),
                          for (final row in rows)
                            _LedgerRow(
                              title: customerVoucherLabel(row['transaction_type']?.toString() ?? ''),
                              date: partyDay(row['transaction_date']),
                              detail: [row['reference_number'], row['description']]
                                  .where((v) => v != null && v.toString().isNotEmpty)
                                  .join(' • '),
                              debit: toNum(row['debit']) > 0 ? _money(toNum(row['debit'])) : '—',
                              credit: toNum(row['credit']) > 0 ? _money(toNum(row['credit'])) : '—',
                            ),
                        ],
                      ),
                      Container(
                        decoration: BoxDecoration(
                          color: AppColors.sunken.withValues(alpha: 0.6),
                          border: const Border(top: BorderSide(color: AppColors.hairline)),
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                        child: Row(
                          children: [
                            Expanded(child: Text('Grand Total', style: AppText.bodyStrong.copyWith(fontSize: 14))),
                            SizedBox(
                              width: _LedgerRow.amountWidth,
                              child: FittedBox(
                                fit: BoxFit.scaleDown,
                                alignment: Alignment.centerRight,
                                child: Text(_money(debit), style: AppText.bodyStrong.copyWith(fontSize: 14, fontFeatures: AppText.tabular)),
                              ),
                            ),
                            SizedBox(
                              width: _LedgerRow.amountWidth,
                              child: FittedBox(
                                fit: BoxFit.scaleDown,
                                alignment: Alignment.centerRight,
                                child: Text(_money(credit), style: AppText.bodyStrong.copyWith(fontSize: 14, fontFeatures: AppText.tabular)),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpace.lg),
                Row(
                  children: [
                    Expanded(child: KButton.secondary(label: 'Download', icon: LucideIcons.download, onPressed: loading ? null : onDownload)),
                    const SizedBox(width: 12),
                    Expanded(child: KButton(label: 'Share', icon: LucideIcons.share2, onPressed: loading ? null : onShare)),
                  ],
                ),
                const SizedBox(height: 8),
                Text('Download/Share attaches the statement PDF (WhatsApp, email…).', style: AppText.caption.copyWith(fontSize: 12)),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _TotalBox extends StatelessWidget {
  const _TotalBox({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.hairline, width: 1.5),
      ),
      child: Column(
        children: [
          Text(label, style: AppText.caption.copyWith(fontSize: 12)),
          const SizedBox(height: 2),
          FittedBox(fit: BoxFit.scaleDown, child: Text(value, style: AppText.heading.copyWith(fontFeatures: AppText.tabular))),
        ],
      ),
    );
  }
}

/// One ledger line: voucher, date and reference on the left; debit and credit columns on the right.
class _LedgerRow extends StatelessWidget {
  const _LedgerRow({
    required this.title,
    required this.date,
    required this.detail,
    required this.debit,
    required this.credit,
    this.bold = false,
  });

  static const amountWidth = 86.0;

  final String title;
  final String? date;
  final String detail;
  final String debit;
  final String credit;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    Widget amount(String v, Color color) => SizedBox(
          width: amountWidth,
          child: FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerRight,
            child: Text(v, style: AppText.label.copyWith(color: v == '—' ? AppColors.ink3 : color, fontFeatures: AppText.tabular)),
          ),
        );
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppText.bodyStrong.copyWith(fontSize: 14, fontWeight: bold ? FontWeight.w700 : FontWeight.w600)),
                if (date != null) Text(date!, style: AppText.caption.copyWith(fontSize: 12)),
                if (detail.isNotEmpty) Text(detail, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppText.caption.copyWith(fontSize: 12)),
              ],
            ),
          ),
          amount(debit, AppColors.ink),
          amount(credit, AppColors.positive),
        ],
      ),
    );
  }
}

class _History extends StatelessWidget {
  const _History({required this.loading, required this.rows});

  final bool loading;
  final List<Map<String, dynamic>>? rows;

  @override
  Widget build(BuildContext context) {
    if (loading && rows == null) return const KSpinner();
    if (rows == null || rows!.isEmpty) return const DetailEmptyState(icon: LucideIcons.history, text: 'No activity recorded yet.');
    return DetailHistoryTimeline(
      entries: [
        for (final h in rows!)
          (
            description: h['description']?.toString() ?? '',
            meta: '${h['user_name'] ?? h['user_email'] ?? 'System'} • ${partyDayTime(h['created_at'])}',
            action: h['action_type']?.toString() ?? '',
          ),
      ],
    );
  }
}

String partyDayTime(dynamic value) {
  final d = parsePartyDate(value);
  return d == null ? '—' : ddMMMyyyyHm(d);
}
