import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../chats/chats_inbox_screen.dart';
import '../settings/appearance_screen.dart';
import '../settings/plan_billing_screen.dart';
import '../settings/settings_editor.dart';
import '../accounting/journal_form_screen.dart';
import '../expenses/expense_form_screen.dart';
import '../purchases/bill_form_screen.dart';
import '../invoices/invoice_form_screen.dart';
import '../parties/customer_form_logic.dart';
import '../parties/supplier_form_screen.dart';
import 'page_catalog.dart';

/// List, report, or tool for a website route that does not have its own screen yet.
class RecordPage extends StatefulWidget {
  const RecordPage({super.key, required this.session, required this.page, this.embedded = false});

  final AppSession session;
  final AppPage page;

  /// Bottom-bar tabs already have the shell app bar.
  final bool embedded;

  @override
  State<RecordPage> createState() => _RecordPageState();
}

class _RecordPageState extends State<RecordPage> {
  dynamic _body;
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  final _hsn = TextEditingController();
  final _keyword = TextEditingController();
  final _location = TextEditingController();
  final _gstAmount = TextEditingController();
  final _gstRate = TextEditingController(text: '18');
  final _settingsQuery = TextEditingController();
  final _listQuery = TextEditingController();
  bool _gstInclusive = false;

  @override
  void initState() {
    super.initState();
    final href = widget.page.href;
    if (widget.page.tool == null && href != '/settings' && href != '/settings/features' && href != '/tools' && href != '/suppliers/new' && href != '/expenses/new') {
      _load();
    } else {
      _loading = false;
    }
  }

  @override
  void dispose() {
    _hsn.dispose();
    _keyword.dispose();
    _location.dispose();
    _gstAmount.dispose();
    _gstRate.dispose();
    _settingsQuery.dispose();
    _listQuery.dispose();
    super.dispose();
  }

  /// No phone API behind this page; it lives only on the website.
  bool get _webOnly => !widget.page.path.startsWith('/api');

  String get _path {
    final page = widget.page;
    var base = sessionBusinessPath(page.path, widget.session.businessId);
    final now = DateTime.now();
    if (base.startsWith('/api/gst/gstr2b/reconcile')) {
      final period = '${now.year}-${now.month.toString().padLeft(2, '0')}';
      base = '$base${base.contains('?') ? '&' : '?'}filing_period=$period';
    }
    if (base.startsWith('/api/offline-sync/history')) {
      final userId = widget.session.user['id']?.toString() ?? '';
      if (userId.isNotEmpty) {
        base = '$base&user_id=${Uri.encodeQueryComponent(userId)}';
      }
    }
    final startYear = now.month < 4 ? now.year - 1 : now.year;
    final from = '$startYear-04-01';
    final to = '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
    final joiner = base.contains('?') ? '&' : '?';
    return switch (page.query) {
      PageQuery.range => '$base${joiner}from_date=$from&to_date=$to',
      PageQuery.month => '$base${joiner}month=${now.month}&year=${now.year}',
      PageQuery.financialYear => '$base${joiner}financial_year=$startYear-${(startYear + 1).toString().substring(2)}',
      PageQuery.none => base,
    };
  }

  Future<void> _load() async {
    if (_webOnly) {
      setState(() { _loading = false; _error = null; _body = null; });
      return;
    }
    setState(() { _loading = true; _error = null; _notInPlan = false; });
    try {
      final body = await widget.session.api.getData(_path);
      final shown = body is Map && body['business'] is Map ? body['business'] : body;
      if (mounted) setState(() { _body = shown; _loading = false; });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
          _error = e.message;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _searchHsn() async {
    final q = _hsn.text.trim();
    if (q.length < 2) return;
    setState(() => _loading = true);
    try {
      final body = await widget.session.api.getData('/api/hsn/lookup?q=${Uri.encodeQueryComponent(q)}&limit=10');
      if (mounted) setState(() { _body = body; _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _searchLeads() async {
    setState(() { _loading = true; _error = null; });
    try {
      final body = await widget.session.api.postJson('/api/tools/google-leads/search', {
        'keyword': _keyword.text.trim(),
        'location': _location.text.trim(),
        'radius': 5000,
        'maxResults': 10,
        'useFreeAPI': true,
      });
      if (mounted) setState(() { _body = body; _loading = false; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final page = widget.page;
    if (page.href == '/settings/subscription') return PlanBillingScreen(session: widget.session);
    if (page.href == '/suppliers/new') return SupplierFormScreen(session: widget.session);
    if (page.href == '/expenses/new') return ExpenseFormScreen(session: widget.session);
    if (page.href == '/whatsapp/conversations') return ChatsInboxScreen(session: widget.session);
    final content = _content(page);
    if (widget.embedded) return content;
    return Scaffold(
      backgroundColor: AppColors.bg,
      floatingActionButton: _createFor(page),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              height: 64,
              child: Row(children: [
                const SizedBox(width: 4),
                KIconButton(icon: LucideIcons.arrowLeft, tooltip: 'Back', onTap: () => Navigator.of(context).maybePop()),
                const SizedBox(width: 4),
                Expanded(child: Text(page.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.heading.copyWith(fontSize: 18))),
                const SizedBox(width: AppSpace.gutter),
              ]),
            ),
            Expanded(child: content),
          ],
        ),
      ),
    );
  }

  Widget? _createFor(AppPage page) {
    final (label, screen) = switch (page.href) {
      '/estimates' => ('New quotation', InvoiceFormScreen(session: widget.session, documentType: 'proforma_invoice')),
      '/expenses' => ('New expense', ExpenseFormScreen(session: widget.session)),
      '/suppliers' => ('New supplier', SupplierFormScreen(session: widget.session)),
      '/journal-entries' => ('New journal', JournalFormScreen(session: widget.session)),
      '/purchases' => ('New purchase', BillFormScreen(session: widget.session, kind: BillKind.purchase)),
      '/purchase-orders' => ('New purchase order', BillFormScreen(session: widget.session, kind: BillKind.purchaseOrder)),
      '/credit-notes' => ('New credit note', BillFormScreen(session: widget.session, kind: BillKind.creditNote)),
      '/debit-notes' => ('New debit note', BillFormScreen(session: widget.session, kind: BillKind.debitNote)),
      '/sales-orders' => ('New sales order', BillFormScreen(session: widget.session, kind: BillKind.salesOrder)),
      '/delivery-challans' => ('New delivery challan', BillFormScreen(session: widget.session, kind: BillKind.deliveryChallan)),
      _ => (null, null),
    };
    if (label == null || screen == null) return null;
    return KFab(
      label: label,
      onTap: () async {
        final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => screen));
        if (saved == true) _load();
      },
    );
  }

  Widget _content(AppPage page) {
    return page.href == '/settings/features'
          ? AppearanceEditor(session: widget.session)
          : page.href == '/settings'
          ? _settingsHub()
          : page.href == '/tools'
              ? _hub(toolLinks)
              : page.tool == 'gst'
                          ? _gstCalculator()
                          : page.tool == 'hsn'
                              ? _hsnFinder()
                              : page.tool == 'leads'
                                  ? _leads()
                                  : page.tool == 'gstin' || page.tool == 'pan'
                                      ? _idCheck(page.tool!)
                                      : page.tool != null
                                          ? _simpleCalc(page.tool!)
                                          : _loaded();
  }

  Widget _settingsHub() {
    final query = _settingsQuery.text.trim().toLowerCase();
    final sections = <(String, List<(String, String)>)>[
      for (final section in settingsSections)
        (
          section.$1,
          [
            for (final link in section.$2)
              if (query.isEmpty || link.$2.toLowerCase().contains(query) || section.$1.toLowerCase().contains(query)) link,
          ],
        ),
    ].where((section) => section.$2.isNotEmpty).toList();
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, 4),
          child: KSearchField(controller: _settingsQuery, hint: 'Search settings', onChanged: (_) => setState(() {})),
        ),
        Expanded(
          child: sections.isEmpty
              ? const KEmptyState(icon: LucideIcons.search, title: 'No matching settings')
              : ListView(
                  padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
                  children: [
                    for (final section in sections) ...[
                      Padding(
                        padding: const EdgeInsets.fromLTRB(4, 14, 4, 8),
                        child: Text(section.$1, style: AppText.label),
                      ),
                      KCard(child: KDivided(indent: 62, children: [for (final link in section.$2) _hubRow(link.$1, link.$2)])),
                    ],
                  ],
                ),
        ),
      ],
    );
  }

  Widget _hubRow(String href, String label) {
    return KListRow(
      leading: Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(color: AppColors.brandSoft, borderRadius: BorderRadius.circular(11)),
        child: Icon(LucideIcons.chevronsRight, size: 17, color: AppColors.brand),
      ),
      title: label,
      trailing: const Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
      onTap: () {
        final next = pageForHref(href);
        if (next == null) return;
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => RecordPage(session: widget.session, page: next)));
      },
    );
  }

  Widget _hub(List<(String, String)> links) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
      children: [
        KCard(
          child: KDivided(
            indent: 62,
            children: [for (final (href, label) in links) _hubRow(href, label)],
          ),
        ),
      ],
    );
  }

  Widget _loaded() {
    if (_webOnly) {
      return ListView(children: [
        KEmptyState(
          icon: LucideIcons.pencil,
          title: 'Not on the phone yet',
          body: 'This page does not have a phone screen.',
        ),
      ]);
    }
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (_notInPlan) {
      final plans = pageForHref('/settings/subscription');
      return ListView(children: [
        KEmptyState(
          icon: LucideIcons.lock,
          title: 'Not included in your current plan',
          body: 'This module is not part of your subscription. You can upgrade your plan or add an add-on (if available) from Subscription & billing.',
          action: plans == null
              ? null
              : KButton(
                  label: 'Subscription & billing',
                  expand: false,
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => PlanBillingScreen(session: widget.session))),
                ),
        ),
      ]);
    }
    if (_error != null) {
      return ListView(children: [
        KEmptyState(
          icon: LucideIcons.cloudOff,
          title: 'Could not load this page',
          body: _error,
          action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
        ),
      ]);
    }
    final settingsObject = widget.page.href.startsWith('/settings/') && widget.page.href != '/settings/features' && _body is Map;
    if (settingsObject) {
      final draft = SettingsDraft.fromBody(Map<String, dynamic>.from(_body as Map));
      if (draft != null && draft.values.isNotEmpty) {
        return SettingsEditor(session: widget.session, path: widget.page.path, draft: draft);
      }
    }
    final rows = recordsFromBody(_body, widget.page.listKey);
    if (rows.isEmpty) {
      return ListView(children: const [KEmptyState(icon: LucideIcons.inbox, title: 'Nothing here yet')]);
    }
    if (rows.length == 1 && widget.page.query != PageQuery.none) return _detail(rows.first);
    final query = _listQuery.text.trim().toLowerCase();
    final visible = query.isEmpty ? rows : rows.where((row) => recordTitle(row).toLowerCase().contains(query) || _subtitle(row).toLowerCase().contains(query)).toList();
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, 112),
        children: [
          KSearchField(controller: _listQuery, hint: 'Search', onChanged: (_) => setState(() {})),
          const SizedBox(height: AppSpace.sm),
          Padding(
            padding: const EdgeInsets.fromLTRB(2, 0, 2, 10),
            child: Text('${visible.length} ${visible.length == 1 ? 'record' : 'records'}', style: AppText.label),
          ),
          if (visible.isEmpty)
            const KEmptyState(icon: LucideIcons.search, title: 'No matching records')
          else
          KCard(
            child: KDivided(
              indent: 66,
              children: [
                for (final row in visible) _row(row),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _row(Map<String, dynamic> row) {
    final title = recordTitle(row);
    final amount = recordAmount(row);
    final numeric = amount == null ? null : num.tryParse(amount);
    final status = row['status']?.toString() ?? row['payment_status']?.toString();
    final party = (row['customer_name'] ?? row['supplier_name'] ?? row['party_name'])?.toString() ?? '';
    return KListRow(
      onTap: () => _openRow(row),
      leading: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(color: AppColors.brandSoft, borderRadius: BorderRadius.circular(12)),
              child: Icon(LucideIcons.fileText, size: 18, color: AppColors.brand),
            ),
      title: title,
      subtitle: [if (party.isNotEmpty && party != title) party, _subtitle(row)].where((p) => p.isNotEmpty).join(' · '),
      trailing: amount == null && status == null
          ? const Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3)
          : Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (amount != null)
                  Text(
                    numeric == null ? amount : '$rupeeSign${enIn(numeric, maxFraction: 2)}',
                    style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular),
                  ),
                if (status != null && status.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  KStatusDot.status(status),
                ],
              ],
            ),
    );
  }

  void _openRow(Map<String, dynamic> row) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => _DetailPage(title: recordTitle(row), row: row)));
  }

  String _subtitle(Map<String, dynamic> row) {
    final date = row['invoice_date'] ?? row['bill_date'] ?? row['payment_date'] ?? row['created_at'] ?? row['date'];
    final parsed = DateTime.tryParse(date?.toString() ?? '');
    final status = row['status']?.toString() ?? row['payment_mode']?.toString() ?? '';
    return [if (parsed != null) ddMMMyyyy(parsed.toLocal()), if (status.isNotEmpty) status].join(' · ');
  }

  Widget _detail(Map<String, dynamic> row) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
      children: [
        KInfoCard(
          title: 'Details',
          rows: _settingRows(row),
        ),
      ],
    );
  }

  Widget _hsnFinder() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.md),
          child: KSearchField(
            controller: _hsn,
            hint: 'Product name or HSN code',
            trailing: KSquareButton(icon: LucideIcons.search, label: 'Search', onTap: _searchHsn),
          ),
        ),
        Expanded(child: _loaded()),
      ],
    );
  }

  Widget _leads() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            children: [
              _input(_keyword, 'Keyword'),
              const SizedBox(height: AppSpace.md),
              _input(_location, 'Location'),
              const SizedBox(height: AppSpace.md),
              KButton(label: 'Search', icon: LucideIcons.search, loading: _loading, onPressed: _searchLeads),
            ],
          ),
        ),
        Expanded(child: _loaded()),
      ],
    );
  }

  Widget _idCheck(String tool) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _input(_gstAmount, tool == 'pan' ? 'PAN' : 'GSTIN', caps: true),
        const SizedBox(height: AppSpace.md),
        _ResultCard(lines: [_checkLabel(tool, _gstAmount.text)], tone: _checkTone(tool, _gstAmount.text)),
      ],
    );
  }

  String _checkLabel(String tool, String raw) {
    final value = raw.trim().toUpperCase();
    if (value.isEmpty) return 'Enter a value';
    if (tool == 'pan') {
      final ok = RegExp(r'^[A-Z]{5}[0-9]{4}[A-Z]$').hasMatch(value);
      return ok ? '$value is a valid PAN shape' : '$value is not a valid PAN';
    }
    return isValidGstin(value) ? '$value is a valid GSTIN' : '$value is not a valid GSTIN';
  }

  Widget _simpleCalc(String tool) {
    final a = double.tryParse(_gstAmount.text) ?? 0;
    final b = double.tryParse(_gstRate.text) ?? 0;
    final lines = switch (tool) {
      'discount' => ['Discount ₹${enIn(a * b / 100, maxFraction: 2)}', 'Net ₹${enIn(a - a * b / 100, maxFraction: 2)}'],
      'margin' => ['Margin ₹${enIn(b - a, maxFraction: 2)}', 'Margin % ${a == 0 ? '0' : enIn((b - a) / b * 100, maxFraction: 2)}'],
      'tds' => ['TDS ₹${enIn(a * b / 100, maxFraction: 2)}', 'Net ₹${enIn(a - a * b / 100, maxFraction: 2)}'],
      'interest' => ['Simple interest ₹${enIn(a * b / 100, maxFraction: 2)}'],
      'emi' => () {
        final months = b <= 0 ? 0.0 : b;
        final monthly = (double.tryParse(_keyword.text) ?? 0) / 12 / 100;
        if (months == 0 || monthly == 0) return ['Enter principal, annual % and months'];
        final emi = a * monthly * _pow(1 + monthly, months) / (_pow(1 + monthly, months) - 1);
        return ['EMI ₹${enIn(emi, maxFraction: 2)}'];
      }(),
      'currency' => ['Converted ${enIn(a * b, maxFraction: 2)}'],
      _ => ['Next number preview: ${_location.text.trim().isEmpty ? 'INV' : _location.text.trim()}-${a.toInt()}'],
    };
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _input(_gstAmount, tool == 'invoice-number' ? 'Sequence' : 'Amount', number: true),
        const SizedBox(height: AppSpace.md),
        _input(
          _gstRate,
          tool == 'emi' ? 'Months' : tool == 'currency' ? 'Rate' : tool == 'invoice-number' ? 'Unused' : 'Percent or second amount',
          number: true,
        ),
        if (tool == 'emi') ...[const SizedBox(height: AppSpace.md), _input(_keyword, 'Annual interest %', number: true)],
        if (tool == 'invoice-number') ...[const SizedBox(height: AppSpace.md), _input(_location, 'Prefix')],
        const SizedBox(height: AppSpace.lg),
        _ResultCard(lines: lines),
      ],
    );
  }

  KTone _checkTone(String tool, String raw) {
    final value = raw.trim().toUpperCase();
    if (value.isEmpty) return KTone.neutral;
    final ok = tool == 'pan' ? RegExp(r'^[A-Z]{5}[0-9]{4}[A-Z]$').hasMatch(value) : isValidGstin(value);
    return ok ? KTone.positive : KTone.negative;
  }

  Widget _input(TextEditingController c, String label, {bool number = false, bool caps = false}) {
    OutlineInputBorder border(Color color, [double w = 1.5]) =>
        OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.md), borderSide: BorderSide(color: color, width: w));
    return TextField(
      controller: c,
      keyboardType: number ? const TextInputType.numberWithOptions(decimal: true) : null,
      textCapitalization: caps ? TextCapitalization.characters : TextCapitalization.none,
      onChanged: (_) => setState(() {}),
      style: AppText.body,
      cursorColor: AppColors.brand,
      decoration: InputDecoration(
        labelText: label,
        labelStyle: AppText.body.copyWith(color: AppColors.ink3),
        filled: true,
        fillColor: AppColors.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        enabledBorder: border(AppColors.hairline),
        focusedBorder: border(AppColors.brand, 2),
      ),
    );
  }

  Widget _gstCalculator() {
    final amount = double.tryParse(_gstAmount.text) ?? 0;
    final rate = double.tryParse(_gstRate.text) ?? 0;
    final gst = _gstInclusive ? amount - (amount * 100 / (100 + rate)) : amount * rate / 100;
    final half = gst / 2;
    final base = _gstInclusive ? amount - gst : amount;
    final total = _gstInclusive ? amount : amount + gst;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _input(_gstAmount, 'Amount', number: true),
        const SizedBox(height: AppSpace.md),
        Text('GST rate', style: AppText.label),
        const SizedBox(height: AppSpace.sm),
        KChipBar<String>(
          value: _gstRate.text,
          padding: EdgeInsets.zero,
          options: const [('0', '0%'), ('5', '5%'), ('12', '12%'), ('18', '18%'), ('28', '28%')],
          onChanged: (v) => setState(() => _gstRate.text = v),
        ),
        SwitchListTile.adaptive(
          contentPadding: EdgeInsets.zero,
          activeTrackColor: AppColors.brand,
          title: Text('Amount includes GST', style: AppText.body),
          value: _gstInclusive,
          onChanged: (v) => setState(() => _gstInclusive = v),
        ),
        _ResultCard(
          lines: [
            'Taxable ₹${enIn(base, maxFraction: 2)}',
            'CGST ₹${enIn(half, maxFraction: 2)}',
            'SGST ₹${enIn(half, maxFraction: 2)}',
          ],
          total: 'Total ₹${enIn(total, maxFraction: 2)}',
        ),
      ],
    );
  }
}

List<(String, String)> _settingRows(Map<String, dynamic> row, [String prefix = '']) {
  final rows = <(String, String)>[];
  for (final entry in row.entries) {
    final value = entry.value;
    final label = prefix.isEmpty ? _label(entry.key) : '$prefix · ${_label(entry.key)}';
    if (value is Map) {
      rows.addAll(_settingRows(Map<String, dynamic>.from(value), _label(entry.key)));
    } else if (value is List) {
      if (value.isNotEmpty) rows.add((label, '${value.length}'));
    } else if (value != null && value.toString().isNotEmpty) {
      rows.add((label, value.toString()));
    }
  }
  return rows;
}

String _label(String key) {
  final words = key.replaceAll('_', ' ').trim();
  return words.isEmpty ? key : words[0].toUpperCase() + words.substring(1);
}

/// Calculator / validator output.
class _ResultCard extends StatelessWidget {
  const _ResultCard({required this.lines, this.total, this.tone = KTone.brand});

  final List<String> lines;
  final String? total;
  final KTone tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: tone.bg, borderRadius: BorderRadius.circular(AppRadius.lg)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final line in lines)
            Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Text(line, style: AppText.body.copyWith(color: AppColors.ink))),
          if (total != null) ...[
            const Divider(color: AppColors.hairline),
            Text(total!, style: AppText.amount.copyWith(fontSize: 22, color: tone == KTone.brand ? AppColors.brand : tone.fg)),
          ],
        ],
      ),
    );
  }
}

double _pow(double base, double exp) {
  var result = 1.0;
  final times = exp.round();
  for (var i = 0; i < times; i++) {
    result *= base;
  }
  return result;
}

class _DetailPage extends StatelessWidget {
  const _DetailPage({required this.title, required this.row});
  final String title;
  final Map<String, dynamic> row;

  @override
  Widget build(BuildContext context) {
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
                KIconButton(icon: LucideIcons.arrowLeft, tooltip: 'Back', onTap: () => Navigator.of(context).pop()),
                const SizedBox(width: 4),
                Expanded(child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.heading.copyWith(fontSize: 18))),
              ]),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
                children: [
                  KInfoCard(
                    title: 'Details',
                    rows: [
                      for (final entry in row.entries)
                        if (entry.value is! Map && entry.value is! List) (_label(entry.key), entry.value?.toString() ?? ''),
                    ],
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

Future<void> openWebsitePage(String href) async {
  final uri = Uri.parse('https://staging.khatario.com$href');
  await launchUrl(uri, mode: LaunchMode.externalApplication);
}
