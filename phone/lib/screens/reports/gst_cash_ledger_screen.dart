import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import '../sales/doc_action_sheets.dart';
import 'gst_kit.dart';
import 'gst_logic.dart';
import 'report_period.dart';
import 'table_report_screen.dart';

String _m(dynamic v) => reportCellText(v, money: true);

/// Website `/reports/gst/cash-ledger`: the electronic cash ledger as on a date, with deposit, utilisation and
/// reversal. `GET /api/gst/cash-ledger?as_on_date&(branch_id|consolidated=1)` replies a block per head
/// (`cash_balance`, `output_liability`, `rcm_liability` and their account codes), `pooled_rcm` and the
/// `statement` (`app/api/gst/cash-ledger/route.ts`). Every balance is the server's.
///
/// Deposit, utilise and reverse post to `/api/gst/cash-ledger/{deposit,utilize,reverse}`. Each asks first, posts
/// once, loads the ledger again and shows the server's message when it refuses. The business and the user come from
/// the session; the branch is the one the ledger shows (a user with several branches picks one, and posting is blocked
/// while every branch shows, as on the website). The bank account of a deposit is the server's default (1102), as when the website leaves it blank.
class GstCashLedgerScreen extends StatefulWidget {
  const GstCashLedgerScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<GstCashLedgerScreen> createState() => _GstCashLedgerScreenState();
}

class _GstCashLedgerScreenState extends State<GstCashLedgerScreen> with GstLoader<GstCashLedgerScreen> {
  DateTime _asOn = dateOnly(DateTime.now());
  late String? _branchId = _known(widget.session.defaultBranchId);
  bool _busy = false;

  @override
  AppSession get gstSessionOf => widget.session;
  @override
  String get gstWhat => 'the cash ledger';
  @override
  String get gstTitle => 'GST cash ledger';
  @override
  String gstPath() => gstCashLedgerPath(_asOn, branchId: _branchId);

  @override
  void initState() {
    super.initState();
    gstLoad();
  }

  Map<String, dynamic> get _ledger => gstBody is Map ? Map<String, dynamic>.from(gstBody as Map) : const {};

  Map<String, num> get _balances => {
        for (final h in gstCashHeads) h: docNum(readPath(_ledger, '${h.toLowerCase()}.cash_balance')) ?? 0,
      };


  /// The branches the user can see (id, name), from the session. The website's branch switcher lists the same.
  List<(String, String)> get _branches => [
        for (final b in (widget.session.raw['branches'] is List ? widget.session.raw['branches'] as List : const []).whereType<Map>())
          if (b['is_active'] != false && docText(b['id']).isNotEmpty) (docText(b['id']), docText(b['name']).isEmpty ? docText(b['id']) : docText(b['name'])),
      ];

  /// The website posts only into one branch: with every branch showing it asks for a branch first.
  bool get _allBranches => _branchId == null && _branches.length > 1;

  /// A branch id only when it is in the branch list; anything else means every branch.
  String? _known(String? id) => id != null && _branches.any((b) => b.$1 == id) ? id : null;

  void _guarded(VoidCallback post) {
    if (_allBranches) return showKToast(context, 'Select a branch before posting', tone: KTone.negative);
    post();
  }
  Future<void> _push(Widget screen) async {
    final message = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => screen));
    if (message == null || !mounted) return;
    showKToast(context, message, tone: KTone.positive);
    await gstLoad(spinner: false);
  }

  Future<void> _open(Map<String, dynamic> line, Set<String> reversed) async {
    final reversible = gstLineReversible(line, reversed);
    final wantsReverse = await showGstSheet<bool>(
      context,
      title: gstVoucherLabel(docText(line['voucher_type'])),
      rows: [
        ('Date', reportCellText(line['date'])),
        ('Head', docText(line['head'])),
        ('Debit', docNum(line['debit']) == null || docNum(line['debit']) == 0 ? '—' : _m(line['debit'])),
        ('Credit', docNum(line['credit']) == null || docNum(line['credit']) == 0 ? '—' : _m(line['credit'])),
        ('Running balance', _m(line['running_balance'])),
        if (docText(line['reference_number']).isNotEmpty) ('Reference', docText(line['reference_number'])),
        if (docText(line['narration']).isNotEmpty) ('Narration', docText(line['narration'])),
      ],
      after: [
        if (reversible) Builder(builder: (ctx) => KSheetAction(icon: LucideIcons.undo2, label: 'Reverse entry', danger: true, onTap: () => Navigator.of(ctx).pop(true))),
      ],
    );
    if (wantsReverse == true && mounted) await _reverse(line);
  }

  Future<void> _reverse(Map<String, dynamic> line) async {
    if (_allBranches) return showKToast(context, 'Select a branch before posting', tone: KTone.negative);
    final deposit = docText(line['voucher_type']) == gstCashDeposit;
    final amount = docNum(line['debit']) != null && docNum(line['debit'])! > 0 ? line['debit'] : line['credit'];
    final reason = await showGstReasonSheet(
      context,
      title: 'Reverse the ${deposit ? 'deposit' : 'utilisation'} of ${_m(amount)}?',
      confirmLabel: 'Reverse',
      hint: 'Reason for the reversal',
    );
    if (reason == null || !mounted) return;
    if (reason.isEmpty) return showKToast(context, 'Give a reason for the reversal', tone: KTone.negative);
    if (_busy) return;
    setState(() => _busy = true);
    final body = gstReverseBody(line: line, reason: reason, today: dateOnly(DateTime.now()), branchId: _branchId);
    final ok = await gstAct(context, () => widget.session.api.postJson('/api/gst/cash-ledger/reverse', body));
    if (mounted) setState(() => _busy = false);
    if (!ok || !mounted) return;
    showKToast(context, 'Entry reversed', tone: KTone.positive);
    await gstLoad(spinner: false);
  }

  @override
  Widget build(BuildContext context) {
    return gstScaffold(
      periodBar: Padding(
        padding: const EdgeInsets.only(bottom: AppSpace.sm),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          AsOnDateBar(date: _asOn, onChanged: (d) {
            setState(() => _asOn = d);
            gstLoad();
          }),
          if (_branches.length > 1)
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, 0),
              child: KPickField<String>(
                label: 'Branch',
                value: _branchId ?? '',
                options: [('', 'All branches'), for (final b in _branches) b],
                onChanged: (v) {
                  setState(() => _branchId = v.isEmpty ? null : v);
                  gstLoad();
                },
              ),
            ),
        ]),
      ),
      children: _children,
    );
  }

  List<Widget> _children() {
    final ledger = _ledger;
    final statement = docRows(ledger['statement'], '');
    final reversed = gstReversedVouchers(statement);
    final pooled = ledger['pooled_rcm'] is Map ? Map<String, dynamic>.from(ledger['pooled_rcm'] as Map) : null;
    return [
      for (final h in gstCashHeads) ...[_headCard(h, ledger), const SizedBox(height: AppSpace.md)],
      if (pooled != null)
        Text(
          'Pooled RCM liability ${docText(pooled['liability_account'])}: ${_m(pooled['liability'])}. Unspecified payments of this account use cash ledger ${docText(pooled['cash_account_when_unspecified'])} (IGST).',
          style: AppText.caption,
        ),
      const SizedBox(height: AppSpace.lg),
if (_allBranches) Padding(padding: const EdgeInsets.only(bottom: AppSpace.sm), child: Text('Showing every branch. Select one branch to deposit or utilise.', style: AppText.caption)),
      Row(children: [
        Expanded(
          child: KButton(
            label: 'Deposit',
            icon: LucideIcons.plus,
            onPressed: () => _guarded(() => _push(GstCashDepositScreen(session: widget.session, branchId: _branchId))),
          ),
        ),
        const SizedBox(width: AppSpace.md),
        Expanded(
          child: KButton.secondary(
            label: 'Utilise',
            onPressed: () => _guarded(() => _push(GstCashUtiliseScreen(session: widget.session, branchId: _branchId, balances: _balances))),
          ),
        ),
      ]),
      const SizedBox(height: AppSpace.xl),
      const KSectionHeader('Statement'),
      if (statement.isEmpty)
        Text('No cash ledger lines up to this date.', style: AppText.caption)
      else
        KCard(
          child: KDivided(children: [
            for (final line in statement)
              KListRow(
                title: gstVoucherLabel(docText(line['voucher_type'])),
                subtitle: _join([
                  reportCellText(line['date']),
                  docText(line['head']),
                  docText(line['reference_number']).isNotEmpty ? docText(line['reference_number']) : docText(line['narration']),
                  'Balance ${_m(line['running_balance'])}',
                ]),
                trailing: Text(
                  (docNum(line['debit']) ?? 0) > 0 ? 'Dr ${_m(line['debit'])}' : 'Cr ${_m(line['credit'])}',
                  style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular),
                ),
                onTap: () => _open(line, reversed),
              ),
          ]),
        ),
    ];
  }

  static String _join(Iterable<String> parts) => parts.where((p) => p.trim().isNotEmpty).join(' · ');

  Widget _headCard(String head, Map<String, dynamic> ledger) {
    final row = ledger[head.toLowerCase()] is Map ? Map<String, dynamic>.from(ledger[head.toLowerCase()] as Map) : const <String, dynamic>{};
    final rcmAccount = docText(row['rcm_liability_account']);
    return KCard(
      padding: const EdgeInsets.all(AppSpace.lg),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('$head cash', style: AppText.caption),
        const SizedBox(height: AppSpace.xs),
        Text(row.isEmpty ? '—' : _m(row['cash_balance']), style: AppText.amount),
        Text('Account ${docText(row['cash_account_code']).isEmpty ? '—' : docText(row['cash_account_code'])}', style: AppText.caption),
        if (row.isNotEmpty) Text('Output liability ${docText(row['output_liability_account'])}: ${_m(row['output_liability'])}', style: AppText.caption),
        if (rcmAccount.isNotEmpty) Text('RCM $rcmAccount: ${_m(row['rcm_liability'])}', style: AppText.caption),
      ]),
    );
  }
}

/// Deposit to the cash ledger (`POST /api/gst/cash-ledger/deposit`): Dr electronic cash ledger, Cr bank. It does
/// not reduce the GST liability. Pops the toast text on success.
class GstCashDepositScreen extends StatefulWidget {
  const GstCashDepositScreen({super.key, required this.session, this.branchId});

  final AppSession session;
  final String? branchId;

  @override
  State<GstCashDepositScreen> createState() => _GstCashDepositScreenState();
}

class _GstCashDepositScreenState extends State<GstCashDepositScreen> {
  final _amount = TextEditingController();
  final _challan = TextEditingController();
  DateTime _date = dateOnly(DateTime.now());
  String _head = 'IGST';

  @override
  void initState() {
    super.initState();
    for (final c in [_amount, _challan]) {
      c.addListener(() => setState(() {}));
    }
  }

  @override
  void dispose() {
    _amount.dispose();
    _challan.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final amount = gstTypedAmount(_amount.text);
    if (amount == null) return;
    final sure = await askSheet(
      context,
      title: 'Deposit to cash ledger?',
      text: 'Deposit ${inr(amount, maxFraction: 2)} to the $_head cash ledger on ${ddMMMyyyy(_date)}? This credits the cash ledger and debits your bank. It does not reduce your GST liability.',
      confirmLabel: 'Deposit now',
      cancelLabel: 'Not now',
      danger: false,
    );
    if (!sure || !mounted) return;
    await widget.session.api.postJson(
      '/api/gst/cash-ledger/deposit',
      gstDepositBody(date: _date, head: _head, amount: amount, challan: _challan.text, branchId: widget.branchId),
    );
    if (mounted) Navigator.of(context).pop('Deposit recorded');
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Deposit to cash ledger',
      saveLabel: 'Review deposit',
      onSave: _save,
      canSave: gstTypedAmount(_amount.text) != null,
      dirty: _amount.text.isNotEmpty || _challan.text.isNotEmpty,
      children: [
        KDateField(label: 'Date', value: _date, onChanged: (d) => setState(() => _date = dateOnly(d))),
        KPickField<String>(label: 'GST head', value: _head, options: [for (final h in gstCashHeads) (h, h)], onChanged: (v) => setState(() => _head = v)),
        KAmountField(label: 'Amount', controller: _amount),
        KTextField(label: 'Challan number', controller: _challan),
      ],
    );
  }
}

/// Utilise the cash ledger against a liability (`POST /api/gst/cash-ledger/utilize`): Dr GST liability, Cr cash
/// ledger. The amount cannot be more than that head's cash balance (the server's figure from the ledger on screen).
class GstCashUtiliseScreen extends StatefulWidget {
  const GstCashUtiliseScreen({super.key, required this.session, required this.balances, this.branchId, this.pooledCash = 'IGST'});

  final AppSession session;
  final String? branchId;

  /// Cash balance per head (IGST, CGST, SGST, CESS), as the ledger showed.
  final Map<String, num> balances;

  /// The cash ledger pooled RCM is paid from when none is chosen.
  final String pooledCash;

  @override
  State<GstCashUtiliseScreen> createState() => _GstCashUtiliseScreenState();
}

class _GstCashUtiliseScreenState extends State<GstCashUtiliseScreen> {
  final _amount = TextEditingController();
  DateTime _date = dateOnly(DateTime.now());
  String _head = 'IGST';
  late String _cashHead = widget.pooledCash;

  @override
  void initState() {
    super.initState();
    _amount.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  String get _paidFrom => gstCashHeadFor(_head, _cashHead);
  num get _available => widget.balances[_paidFrom] ?? 0;
  num? get _typed => gstTypedAmount(_amount.text);
  bool get _tooHigh => _typed != null && _typed! > _available + 0.001;

  Future<void> _save() async {
    final amount = _typed;
    if (amount == null || _tooHigh) return;
    final sure = await askSheet(
      context,
      title: 'Utilise cash ledger?',
      text: 'Utilise ${inr(amount, maxFraction: 2)} from the $_paidFrom cash ledger against $_head liability on ${ddMMMyyyy(_date)}? This moves the balance onto your GST liability.',
      confirmLabel: 'Utilise now',
      cancelLabel: 'Not now',
      danger: false,
    );
    if (!sure || !mounted) return;
    await widget.session.api.postJson(
      '/api/gst/cash-ledger/utilize',
      gstUtilizeBody(date: _date, head: _head, amount: amount, cashHead: _cashHead, branchId: widget.branchId),
    );
    if (mounted) Navigator.of(context).pop('Utilisation recorded');
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Utilise cash ledger',
      saveLabel: 'Review utilisation',
      onSave: _save,
      canSave: _typed != null && !_tooHigh,
      dirty: _amount.text.isNotEmpty,
      children: [
        KDateField(label: 'Date', value: _date, onChanged: (d) => setState(() => _date = dateOnly(d))),
        KPickField<String>(label: 'Liability head', value: _head, options: [for (final h in gstLiabilityHeads) (h, h)], onChanged: (v) => setState(() => _head = v)),
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_head == 'RCM')
              KPickField<String>(
                label: 'Cash ledger for pooled RCM',
                value: _cashHead,
                options: const [('IGST', 'IGST (1130)'), ('CGST', 'CGST (1131)'), ('SGST', 'SGST (1132)')],
                onChanged: (v) => setState(() => _cashHead = v),
              ),
          ],
        ),
        Text('Available ${inr(_available, maxFraction: 2)} in the $_paidFrom cash ledger', style: AppText.caption),
        KAmountField(label: 'Amount', controller: _amount, error: _tooHigh ? 'Amount is greater than the available cash balance' : null),
      ],
    );
  }
}
