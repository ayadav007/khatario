import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import '../invoices/invoice_detail_screen.dart';
import '../payments/payment_in_screen.dart';
import '../purchases/purchase_section.dart';
import '../reports/report_period.dart';
import '../reports/statement_pdf.dart';
import 'books_logic.dart';
import 'journal_entries_screen.dart';

export '../reports/statement_pdf.dart' show PdfOpener;

/// `app/(app)/ledger/account/[id]/page.tsx`: one account's ledger for a period.
///
/// `GET /api/ledger/account/[id]?from_date=&to_date=` returns `account`, `opening_balance`,
/// `closing_balance` and `entries` (each with `running_balance`). Every figure shown is the
/// server's; the phone adds nothing up, and a row the server sent no running balance for shows none.
/// The route returns every entry of the period at once, so there is no paging. The statement PDF is
/// `GET /api/ledger/account/[id]/statement/pdf` with the same period names.
class AccountLedgerScreen extends StatefulWidget {
  const AccountLedgerScreen({super.key, required this.session, required this.accountId, this.accountName, this.openPdf});

  final AppSession session;
  final String accountId;
  final String? accountName;
  final PdfOpener? openPdf;

  @override
  State<AccountLedgerScreen> createState() => _AccountLedgerScreenState();
}

class _AccountLedgerScreenState extends State<AccountLedgerScreen> {
  ReportPeriod _period = ReportPeriod.of('this_fy');
  dynamic _body;
  bool _loading = true;
  bool _notInPlan = false;
  bool _pdfBusy = false;
  String? _error;
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool spinner = true}) async {
    final seq = ++_seq;
    if (spinner) {
      setState(() {
        _loading = true;
        _error = null;
        _notInPlan = false;
      });
    }
    try {
      final body = await widget.session.api.getData(accountLedgerPath(widget.accountId, _period));
      if (!mounted || seq != _seq) return;
      setState(() {
        _body = body;
        _loading = false;
        _error = null;
        _notInPlan = false;
      });
    } on ApiException catch (e) {
      if (!mounted || seq != _seq) return;
      if (!spinner && _body != null) return showKToast(context, e.message, tone: KTone.negative);
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || seq != _seq) return;
      if (!spinner && _body != null) return showKToast(context, 'Could not reach the server.', tone: KTone.negative);
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  Map<String, dynamic> get _account {
    final a = _body is Map ? (_body as Map)['account'] : null;
    return a is Map ? Map<String, dynamic>.from(a) : const {};
  }

  String get _title {
    final name = docText(_account['account_name']);
    if (name.isNotEmpty) return name;
    return widget.accountName ?? 'Account ledger';
  }

  Future<void> _pdf() async {
    if (_pdfBusy) return;
    setState(() => _pdfBusy = true);
    try {
      final bytes = await widget.session.api.getBytes(accountStatementPdfPath(widget.accountId, _period));
      if (!mounted) return;
      await (widget.openPdf ?? _openPdfViewer)(context, bytes, _title);
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not open the statement. Try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _pdfBusy = false);
    }
  }

  /// A ledger row opens its source document where the phone has a screen for it.
  void _openSource(Map<String, dynamic> row) {
    final id = docText(row['voucher_id']);
    final session = widget.session;
    final Widget? screen = switch (ledgerSourceOf(row)) {
      LedgerSource.invoice => InvoiceDetailScreen(api: session.api, invoiceId: id, businessName: session.businessName, session: session),
      LedgerSource.purchase => PurchaseDetailScreen(session: session, title: 'Purchase', path: '/api/purchases/$id', objectKey: 'purchase', kind: PurchaseKind.bills),
      LedgerSource.payment => PaymentInScreen(session: session, highlightIds: [id]),
      LedgerSource.journal => JournalDetailScreen(session: session, voucherId: id),
      LedgerSource.none => null,
    };
    if (screen != null) Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(
              _title,
              trailing: _body == null ? null : KIconButton(icon: LucideIcons.fileText, tooltip: 'Statement PDF', onTap: _pdf),
            ),
            ReportPeriodBar(period: _period, onChanged: (p) {
              setState(() => _period = p);
              _load();
            }),
            Expanded(child: _content()),
          ],
        ),
      ),
    );
  }

  Widget _content() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (_error != null) {
      return ListView(children: [
        if (_notInPlan)
          const KEmptyState(icon: LucideIcons.lock, title: 'Not included in your current plan')
        else
          KEmptyState(
            icon: LucideIcons.cloudOff,
            title: 'Could not load the ledger',
            body: _error,
            action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
          ),
      ]);
    }
    final account = _account;
    final nature = docText(account['nature']);
    final opening = docNum((_body as Map)['opening_balance']);
    final closing = docNum((_body as Map)['closing_balance']);
    final entries = docRows(_body, 'entries');
    final group = docText(account['account_group_name']);
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: () => _load(spinner: false),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.xxl),
        children: [
          Text([docText(account['account_code']), group].where((t) => t.isNotEmpty).join(' · '), style: AppText.caption),
          const SizedBox(height: AppSpace.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _tile('Opening balance', opening, nature)),
              const SizedBox(width: AppSpace.md),
              Expanded(child: _tile('Closing balance', closing, nature)),
            ],
          ),
          const SizedBox(height: AppSpace.lg),
          if (entries.isEmpty)
            const KEmptyState(icon: LucideIcons.fileText, title: 'No transactions in this period')
          else
            KCard(child: KDivided(children: [for (final e in entries) _row(e, nature)])),
        ],
      ),
    );
  }

  Widget _tile(String label, num? value, String nature) {
    return KCard(
      padding: const EdgeInsets.all(AppSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: AppText.caption, maxLines: 1, overflow: TextOverflow.ellipsis),
          const SizedBox(height: AppSpace.xs),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(value == null ? '—' : natureSidedAmount(value, nature), style: AppText.amount.copyWith(fontSize: 18)),
          ),
        ],
      ),
    );
  }

  Widget _row(Map<String, dynamic> e, String nature) {
    final date = docDate(e['entry_date']);
    final debit = docNum(e['debit']) ?? 0;
    final credit = docNum(e['credit']) ?? 0;
    final running = docNum(e['running_balance']);
    final ref = [docText(e['reference_number']), ledgerVoucherWords(e)].where((t) => t.isNotEmpty).join(' · ');
    final narration = docText(e['narration']);
    final openable = ledgerSourceOf(e) != LedgerSource.none;
    return InkWell(
      onTap: openable ? () => _openSource(e) : null,
      highlightColor: AppColors.sunken,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(date == null ? '—' : ddMMMyyyy(date), style: AppText.bodyStrong),
                  if (ref.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(ref, style: AppText.caption)),
                  if (narration.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(narration, style: AppText.caption)),
                ],
              ),
            ),
            const SizedBox(width: AppSpace.md),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (debit > 0) ...[
                  Text(ledgerMoney(debit), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
                  Text('Debit', style: AppText.caption),
                ],
                if (credit > 0) ...[
                  Text(ledgerMoney(credit), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular, color: AppColors.positive)),
                  Text('Credit', style: AppText.caption),
                ],
                if (running != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('Balance ${natureSidedAmount(running, nature)}', style: AppText.caption)),
              ],
            ),
            if (openable) Padding(padding: const EdgeInsets.only(left: 4, top: 2), child: Icon(LucideIcons.chevronRight, size: 16, color: AppColors.ink3)),
          ],
        ),
      ),
    );
  }
}

Future<void> _openPdfViewer(BuildContext context, List<int> bytes, String title) {
  final safe = title.replaceAll(RegExp(r'[^\w.-]+'), '_');
  return openPdfViewer(context, bytes, title: 'Statement · $title', fileName: 'Statement-${safe.isEmpty ? 'account' : safe}.pdf');
}
