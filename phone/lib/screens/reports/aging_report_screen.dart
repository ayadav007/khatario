import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../invoices/invoice_detail_screen.dart';
import '../purchases/purchase_section.dart';
import 'aging_logic.dart';

/// Website receivables / payables aging: tap a party to see each open invoice and how many days it is overdue.
class AgingReportScreen extends StatefulWidget {
  const AgingReportScreen({super.key, required this.session, required this.payables});

  final AppSession session;
  final bool payables;

  @override
  State<AgingReportScreen> createState() => _AgingReportScreenState();
}

class _AgingReportScreenState extends State<AgingReportScreen> {
  late DateTime _asOn;
  List<Map<String, dynamic>> _rows = const [];
  Map<String, dynamic>? _totals;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _asOn = DateTime(now.year, now.month, now.day);
    _load();
  }

  String get _kind => widget.payables ? 'payables' : 'receivables';
  String get _docLabel => widget.payables ? 'Bill' : 'Invoice';

  String _iso(DateTime date) =>
      '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final body = await widget.session.api.getJson('/api/reports/aging/$_kind?as_on_date=${_iso(_asOn)}');
      final raw = body['aging'];
      if (!mounted) return;
      setState(() {
        _rows = raw is List ? raw.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList() : const [];
        _totals = body['totals'] is Map ? Map<String, dynamic>.from(body['totals'] as Map) : null;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        _loading = false;
      });
    }
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _asOn,
      firstDate: DateTime(2015),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked == null || !mounted) return;
    setState(() => _asOn = DateTime(picked.year, picked.month, picked.day));
    await _load();
  }

  String _money(dynamic value) {
    final n = toNum(value);
    final text = '₹${enIn(n.abs(), maxFraction: 2)}';
    return n < 0 ? '($text)' : text;
  }

  String _date(dynamic value) {
    final raw = value?.toString() ?? '';
    if (raw.length < 10) return '—';
    final parsed = DateTime.tryParse(raw.substring(0, 10));
    if (parsed == null) return raw.substring(0, 10);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${parsed.day} ${months[parsed.month - 1]} ${parsed.year}';
  }

  void _openItem(Map<String, dynamic> item) {
    final id = item['transaction_id']?.toString() ?? '';
    final type = item['transaction_type']?.toString() ?? '';
    if (id.isEmpty) return;
    if (type == 'invoice') {
      Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => InvoiceDetailScreen(api: widget.session.api, invoiceId: id, businessName: widget.session.businessName, session: widget.session),
      ));
      return;
    }
    if (type == 'purchase') {
      Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => PurchaseDetailScreen(session: widget.session, title: 'Purchase', path: '/api/purchases/$id', objectKey: 'purchase', kind: PurchaseKind.bills),
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = widget.payables ? 'Payables aging' : 'Receivables aging';
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(title: Text(title)),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: KCard(
              onTap: _pickDate,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                children: [
                  const Icon(LucideIcons.calendar, size: 18),
                  const SizedBox(width: 10),
                  Expanded(child: Text('As on ${_date(_iso(_asOn))}', style: AppText.bodyStrong)),
                  Icon(LucideIcons.chevronDown, size: 18, color: AppColors.ink3),
                ],
              ),
            ),
          ),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null && _rows.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              TextButton(onPressed: _load, child: const Text('Try again')),
            ],
          ),
        ),
      );
    }
    if (_rows.isEmpty) {
      return Center(child: Text('No ${widget.payables ? 'payables' : 'receivables'} outstanding on this date', style: AppText.caption));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          if (_totals != null) ...[
            KCard(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Total outstanding', style: AppText.caption),
                  const SizedBox(height: 4),
                  Text(_money(_totals!['total_outstanding']), style: AppText.amount.copyWith(fontSize: 24)),
                  const SizedBox(height: 10),
                  Wrap(spacing: 8, runSpacing: 6, children: _bucketChips(_totals!)),
                ],
              ),
            ),
            const SizedBox(height: 12),
          ],
          for (final row in _rows) ...[
            _party(row),
            const SizedBox(height: 8),
          ],
        ],
      ),
    );
  }

  List<Widget> _bucketChips(Map<String, dynamic> row) {
    const buckets = [
      ('bucket_not_due', 'Not due'),
      ('bucket_0_30', '1-30'),
      ('bucket_31_60', '31-60'),
      ('bucket_61_90', '61-90'),
      ('bucket_90_plus', '90+'),
      ('on_account', 'Unapplied'),
    ];
    return [
      for (final (key, label) in buckets)
        if (toNum(row[key]).abs() > 0.005)
          KPill(
            label: '$label ${_money(row[key])}',
            tone: key == 'bucket_90_plus' ? KTone.negative : KTone.neutral,
          ),
    ];
  }

  Widget _party(Map<String, dynamic> row) {
    final items = row['transactions'];
    final lines = items is List ? items.whereType<Map>().map((item) => Map<String, dynamic>.from(item)).toList() : <Map<String, dynamic>>[];
    return KCard(
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 16),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          title: Text(row['party_name']?.toString() ?? (widget.payables ? 'Supplier' : 'Customer'), style: AppText.bodyStrong),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Wrap(spacing: 8, runSpacing: 6, children: [
              Text(_money(row['total_outstanding']), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
              ..._bucketChips(row),
            ]),
          ),
          children: [
            if (lines.isEmpty) Text('No open $_docLabel'.toLowerCase(), style: AppText.caption),
            for (final item in lines) _line(item),
          ],
        ),
      ),
    );
  }

  Widget _line(Map<String, dynamic> item) {
    final days = agingDays(item['days_overdue']);
    final outstanding = toNum(item['outstanding']);
    final overdue = days > 0 && outstanding > 0;
    final type = item['transaction_type']?.toString() ?? '';
    final canOpen = type == 'invoice' || type == 'purchase';
    return InkWell(
      onTap: canOpen ? () => _openItem(item) : null,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item['reference_number']?.toString().isNotEmpty == true ? item['reference_number'].toString() : _docLabel, style: AppText.body),
                  const SizedBox(height: 2),
                  Text('${_date(item['invoice_date'])} · due ${_date(item['due_date'] ?? item['invoice_date'])}', style: AppText.caption),
                  Text(
                    agingDueLabel(outstanding: outstanding, daysOverdue: days),
                    style: AppText.caption.copyWith(color: overdue ? AppColors.negative : AppColors.ink2, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(_money(item['outstanding']), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular, color: overdue ? AppColors.negative : null)),
                Text(_money(item['original_amount']), style: AppText.caption),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
