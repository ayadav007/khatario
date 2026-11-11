import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import '../reports/report_period.dart';
import 'account_ledger_screen.dart';
import 'books_logic.dart';

/// `app/(app)/ledger/page.tsx`: every ledger entry for a period (the day book).
///
/// `GET /api/ledger?from_date=&to_date=&account_id=&voucher_type=&page=` returns `entries` (with
/// `debit`, `credit`, `opening`, `opening_side`, `closing`, `balance_side` worked out by the server)
/// and `pagination` (50 a page). "Show more" asks for the next page. The website has no account
/// filter on this page; the route supports one, so the phone offers it.
class LedgerScreen extends StatefulWidget {
  const LedgerScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<LedgerScreen> createState() => _LedgerScreenState();
}

class _LedgerScreenState extends State<LedgerScreen> {
  final _search = TextEditingController();
  ReportPeriod _period = ReportPeriod.of('this_fy');
  String _accountId = '';
  String _accountName = '';
  String _voucherType = '';

  List<Map<String, dynamic>> _rows = const [];
  ({int page, int totalPages})? _paging;
  bool _loading = true;
  bool _loadingMore = false;
  bool _notInPlan = false;
  String? _error;
  int _seq = 0;

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

  String _path(int page) => ledgerPath(_period, accountId: _accountId, voucherType: _voucherType, page: page);

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
      final body = await widget.session.api.getData(_path(1));
      if (!mounted || seq != _seq) return;
      setState(() {
        _rows = docRows(body, 'entries');
        _paging = docPaging(body);
        _loading = false;
        _error = null;
        _notInPlan = false;
      });
    } on ApiException catch (e) {
      if (!mounted || seq != _seq) return;
      if (!spinner && _error == null && !_loading) return showKToast(context, e.message, tone: KTone.negative);
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || seq != _seq) return;
      if (!spinner && _error == null && !_loading) return showKToast(context, 'Could not reach the server.', tone: KTone.negative);
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  Future<void> _showMore() async {
    final paging = _paging;
    if (paging == null || _loadingMore) return;
    final seq = _seq;
    setState(() => _loadingMore = true);
    try {
      final body = await widget.session.api.getData(_path(paging.page + 1));
      if (!mounted || seq != _seq) return;
      setState(() {
        _rows = [..._rows, ...docRows(body, 'entries')];
        _paging = docPaging(body) ?? paging;
      });
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not reach the server.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  void _filter(VoidCallback change) {
    setState(change);
    _load();
  }

  List<Map<String, dynamic>> get _shown {
    final q = _search.text.trim().toLowerCase();
    if (q.isEmpty) return _rows;
    return [
      for (final r in _rows)
        if ([
          docText(r['account_name']),
          docText(r['account_code']),
          docText(r['voucher_number']),
          docText(r['reference_number']),
          docText(r['narration']),
          ledgerVoucherWords(r),
        ].any((t) => t.toLowerCase().contains(q)))
          r,
    ];
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Ledger'),
            ReportPeriodBar(period: _period, onChanged: (p) => _filter(() => _period = p)),
            Expanded(child: _content()),
          ],
        ),
      ),
    );
  }

  Widget _filters() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        KAsyncPickField(
          label: 'Account',
          valueLabel: _accountId.isEmpty ? 'All accounts' : _accountName,
          search: (q) => searchAccounts(widget.session.api, q),
          onPicked: (id, label) => _filter(() {
            _accountId = id;
            _accountName = label;
          }),
        ),
        if (_accountId.isNotEmpty)
          Align(
            alignment: Alignment.centerLeft,
            child: KTextButton(label: 'Clear account', onTap: () => _filter(() {
              _accountId = '';
              _accountName = '';
            })),
          ),
        const SizedBox(height: AppSpace.md),
        KPickField<String>(
          label: 'Voucher type',
          value: _voucherType,
          options: [('', 'All types'), ...kVoucherTypes],
          searchable: true,
          onChanged: (v) => _filter(() => _voucherType = v),
        ),
      ],
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
    final shown = _shown;
    final paging = _paging;
    final searching = _search.text.trim().isNotEmpty;
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: () => _load(spinner: false),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.xxl),
        children: [
          _filters(),
          const SizedBox(height: AppSpace.md),
          if (_rows.isNotEmpty || searching) ...[
            KSearchField(controller: _search, hint: 'Search these entries', onChanged: (_) => setState(() {})),
            const SizedBox(height: AppSpace.md),
          ],
          if (_rows.isEmpty)
            const KEmptyState(icon: LucideIcons.fileText, title: 'No ledger entries found', body: 'Try another period or filter.')
          else if (shown.isEmpty)
            const KEmptyState(icon: LucideIcons.search, title: 'Nothing matches your search', body: 'Try another word.')
          else
            KCard(child: KDivided(children: [for (final r in shown) _row(r)])),
          if (paging != null && paging.page < paging.totalPages && !searching) ...[
            const SizedBox(height: AppSpace.lg),
            KButton.secondary(label: 'Show more', loading: _loadingMore, onPressed: _showMore),
          ],
        ],
      ),
    );
  }

  Widget _row(Map<String, dynamic> r) {
    final date = docDate(r['entry_date']);
    final debit = docNum(r['debit']) ?? 0;
    final credit = docNum(r['credit']) ?? 0;
    final voucher = docText(r['reference_number']).isNotEmpty ? docText(r['reference_number']) : docText(r['voucher_number']);
    final line = [if (date != null) ddMMMyyyy(date), voucher, ledgerVoucherWords(r)].where((t) => t.isNotEmpty).join(' · ');
    final narration = docText(r['narration']);
    final opening = sidedBalance((amount: docNum(r['opening']) ?? 0, side: docText(r['opening_side']).isEmpty ? null : docText(r['opening_side'])));
    final balance = sidedBalance((amount: docNum(r['closing']) ?? 0, side: docText(r['balance_side']).isEmpty ? null : docText(r['balance_side'])));
    final accountId = docText(r['account_id']);
    return InkWell(
      onTap: accountId.isEmpty
          ? null
          : () => Navigator.of(context).push(MaterialPageRoute<void>(
                builder: (_) => AccountLedgerScreen(session: widget.session, accountId: accountId, accountName: docText(r['account_name'])),
              )),
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
                  Text(docText(r['account_name']), style: AppText.bodyStrong),
                  if (docText(r['account_code']).isNotEmpty) Text(docText(r['account_code']), style: AppText.caption),
                  if (line.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(line, style: AppText.caption)),
                  if (narration.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(narration, style: AppText.caption)),
                ],
              ),
            ),
            const SizedBox(width: AppSpace.md),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (debit > 0) Text('Dr ${ledgerMoney(debit)}', style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
                if (credit > 0) Text('Cr ${ledgerMoney(credit)}', style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular, color: AppColors.positive)),
                const SizedBox(height: 4),
                Text('Opening $opening', style: AppText.caption),
                Text('Balance $balance', style: AppText.caption),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
