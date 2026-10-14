import 'dart:io';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../ui/kit.dart';
import '../../theme.dart';
import 'customer_form_logic.dart';
import 'party_logic.dart';

/// `customers/[id]/statement`: this financial year's party statement, CSV and PDF.
class CustomerStatementScreen extends StatefulWidget {
  const CustomerStatementScreen({super.key, required this.session, required this.customerId});

  final AppSession session;
  final String customerId;

  @override
  State<CustomerStatementScreen> createState() => _CustomerStatementScreenState();
}

class _CustomerStatementScreenState extends State<CustomerStatementScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  ({String fromDate, String toDate}) get _period => defaultStatementPeriod(DateTime.now());

  Map<String, String> _query() {
    final period = _period;
    final branch = widget.session.defaultBranchId;
    return {
      'party_type': 'customer',
      'party_id': widget.customerId,
      'from_date': period.fromDate,
      'to_date': period.toDate,
      if (widget.session.businessId != null) 'business_id': widget.session.businessId!,
      if (widget.session.user['id'] != null) 'user_id': widget.session.user['id'].toString(),
      if (branch != null && branch != 'ALL') 'branch_id': branch,
    };
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final body = await widget.session.api.getJson(Uri(path: '/api/reports/party/statement', queryParameters: _query()).toString());
      if (!mounted) return;
      setState(() {
        _data = body;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _data = null; _loading = false; });
    } catch (_) {
      if (mounted) setState(() { _error = 'Could not load statement'; _data = null; _loading = false; });
    }
  }

  List<Map<String, dynamic>> get _rows {
    final list = _data?['transactions'];
    return list is List ? list.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [];
  }

  Future<void> _pdf() async {
    try {
      final bytes = await widget.session.api.getBytes(Uri(path: '/api/reports/party/statement/pdf', queryParameters: _query()).toString());
      final period = _period;
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/statement-${period.fromDate}-${period.toDate}.pdf');
      await file.writeAsBytes(bytes, flush: true);
      await SharePlus.instance.share(ShareParams(files: [XFile(file.path, mimeType: 'application/pdf')], subject: 'Customer statement'));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not share statement')));
    }
  }

  Future<void> _csv() async {
    final data = _data;
    if (data == null) return;
    final party = data['party'] is Map ? Map<String, dynamic>.from(data['party'] as Map) : const <String, dynamic>{};
    final business = data['business'] is Map ? Map<String, dynamic>.from(data['business'] as Map) : const <String, dynamic>{};
    final name = party['name']?.toString().isNotEmpty == true ? party['name'].toString() : 'Customer';
    final csv = buildStatementCsv(
      businessName: business['name']?.toString() ?? widget.session.businessName,
      partyName: name,
      fromDate: data['from_date']?.toString() ?? _period.fromDate,
      toDate: data['to_date']?.toString() ?? _period.toDate,
      openingBalance: toNum(data['opening_balance']),
      closingBalance: toNum(data['closing_balance']),
      transactions: _rows,
    );
    try {
      final safe = name.replaceAll(RegExp(r'[^\w\-]+'), '_');
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/statement-${safe.isEmpty ? 'customer' : safe}.csv');
      await file.writeAsString(csv, flush: true);
      await SharePlus.instance.share(ShareParams(files: [XFile(file.path, mimeType: 'text/csv')], subject: 'Customer statement'));
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('CSV downloaded')));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not download CSV')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final party = data?['party'] is Map ? Map<String, dynamic>.from(data!['party'] as Map) : const <String, dynamic>{};
    final business = data?['business'] is Map ? Map<String, dynamic>.from(data!['business'] as Map) : const <String, dynamic>{};
    final closing = toNum(data?['closing_balance']);
    final summary = data == null ? null : customerStatementSummary(closing);
    String money(num v) => '$rupeeSign${enIn(v, maxFraction: 2)}';
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              height: 64,
              child: Row(
                children: [
                  const SizedBox(width: 4),
                  KIconButton(icon: LucideIcons.arrowLeft, tooltip: 'Back', onTap: () => Navigator.pop(context)),
                  const SizedBox(width: 4),
                  Expanded(child: Text('Party statement', style: AppText.heading.copyWith(fontSize: 18))),
                ],
              ),
            ),
            Expanded(
              child: _loading
                  ? const KSpinner()
                  : _error != null
                      ? KEmptyState(
                          icon: LucideIcons.cloudOff,
                          title: 'Could not load statement',
                          body: _error,
                          action: KButton.secondary(label: 'Retry', expand: false, onPressed: _load),
                        )
                      : ListView(
                          padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
                          children: [
                            KCard(
                              raised: true,
                              padding: const EdgeInsets.all(18),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      KAvatar(name: party['name']?.toString() ?? 'Customer', size: 40),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(party['name']?.toString() ?? 'Customer', style: AppText.bodyStrong),
                                            Text(
                                              [if (party['phone'] != null) party['phone'].toString(), business['name']?.toString() ?? widget.session.businessName]
                                                  .join(' · '),
                                              style: AppText.caption.copyWith(fontSize: 12),
                                            ),
                                          ],
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 14),
                                  KPill(
                                    label: '${statementDate(data?['from_date'])} – ${statementDate(data?['to_date'])}',
                                    tone: KTone.neutral,
                                    icon: LucideIcons.calendar,
                                  ),
                                  if (summary != null) ...[
                                    const SizedBox(height: 14),
                                    Text(summary.title, style: AppText.label),
                                    const SizedBox(height: 2),
                                    KAmount(summary.amount, style: AppText.amount, maxFraction: 2),
                                    Text(summary.subtitle, style: AppText.caption.copyWith(fontSize: 12)),
                                  ],
                                ],
                              ),
                            ),
                            const SizedBox(height: AppSpace.xl),
                            const KSectionHeader('Transactions'),
                            KCard(
                              child: _rows.isEmpty
                                  ? Padding(padding: const EdgeInsets.all(16), child: Text('No transactions in this period.', style: AppText.caption))
                                  : KDivided(
                                      children: [
                                        for (final row in _rows)
                                          Padding(
                                            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                                            child: Row(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              children: [
                                                Expanded(
                                                  child: Column(
                                                    crossAxisAlignment: CrossAxisAlignment.start,
                                                    children: [
                                                      Text(customerVoucherLabel(row['transaction_type']?.toString() ?? ''), style: AppText.bodyStrong),
                                                      Text(
                                                        [
                                                          statementDate(row['transaction_date']),
                                                          row['reference_number']?.toString() ?? '',
                                                        ].where((p) => p.isNotEmpty).join(' · '),
                                                        style: AppText.caption.copyWith(fontSize: 12),
                                                      ),
                                                      if ((row['description']?.toString() ?? '').isNotEmpty)
                                                        Text(row['description'].toString(),
                                                            maxLines: 2, overflow: TextOverflow.ellipsis, style: AppText.caption.copyWith(fontSize: 12)),
                                                    ],
                                                  ),
                                                ),
                                                const SizedBox(width: 12),
                                                Column(
                                                  crossAxisAlignment: CrossAxisAlignment.end,
                                                  children: [
                                                    if (toNum(row['debit']) > 0)
                                                      Text('+ ${money(toNum(row['debit']))}', style: AppText.bodyStrong.copyWith(color: AppColors.due))
                                                    else if (toNum(row['credit']) > 0)
                                                      Text('− ${money(toNum(row['credit']))}', style: AppText.bodyStrong.copyWith(color: AppColors.positive)),
                                                    Text('Bal ${money(toNum(row['running_balance']))}', style: AppText.caption.copyWith(fontSize: 12)),
                                                  ],
                                                ),
                                              ],
                                            ),
                                          ),
                                        Padding(
                                          padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
                                          child: Row(
                                            children: [
                                              Expanded(child: Text('Closing balance', style: AppText.bodyStrong)),
                                              Text(money(closing), style: AppText.heading.copyWith(fontFeatures: AppText.tabular)),
                                            ],
                                          ),
                                        ),
                                      ],
                                    ),
                            ),
                          ],
                        ),
            ),
            if (data != null && !_loading)
              KBottomBar(children: [
                Expanded(child: KButton.secondary(label: 'CSV', icon: LucideIcons.sheet, onPressed: _csv)),
                Expanded(flex: 2, child: KButton(label: 'Print / PDF', icon: LucideIcons.printer, onPressed: _pdf)),
              ]),
          ],
        ),
      ),
    );
  }
}
