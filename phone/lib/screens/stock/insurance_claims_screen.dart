import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_detail_screen.dart';
import '../docs/doc_list_screen.dart';
import '../docs/doc_logic.dart';
import '../sales/doc_action_sheets.dart';
import 'stock_misc_logic.dart';
import 'stock_misc_sheets.dart';

/// `app/(app)/insurance-claims/page.tsx`: stock lost to theft, fire, flood or in transit, claimed from the insurer.
/// `GET /api/insurance-claims` replies `{ claims }` in one piece (so the status chips filter on the phone);
/// `POST /api/insurance-claims` lodges one; `PATCH /api/insurance-claims/[id]` admits, settles or rejects it. A status
/// change posts ledger entries, so each asks first, naming the amount and what the books do.
class InsuranceClaimsScreen extends StatelessWidget {
  const InsuranceClaimsScreen({super.key, required this.session});

  final AppSession session;

  @override
  Widget build(BuildContext context) {
    return DocListScreen(
      session: session,
      spec: DocListSpec(
        title: 'Insurance claims',
        href: '/insurance-claims',
        path: '/api/insurance-claims',
        listKey: 'claims',
        titleOf: claimTitle,
        subtitleOf: claimSubtitle,
        amountOf: claimClaimed,
        statusOf: (c) => docText(c['status']),
        searchKeys: const ['claim_number', 'insurer', 'fir_number'],
        filters: kClaimFilters,
        filterRow: claimMatchesFilter,
        icon: LucideIcons.shieldCheck,
        emptyTitle: 'No claims yet',
        emptyBody: 'Stock lost to theft, fire, flood or in transit can be claimed from the insurer.',
        createLabel: 'Lodge claim',
        onCreate: (ctx) => Navigator.of(ctx).push<bool>(MaterialPageRoute(builder: (_) => ClaimFormScreen(session: session))),
        onOpen: (ctx, row) async {
          final changed = await Navigator.of(ctx).push<bool>(MaterialPageRoute(builder: (_) => ClaimDetailScreen(session: session, seed: row)));
          return changed == true;
        },
      ),
    );
  }
}

/// One claim with its facts, the write-offs it covers and the actions its status allows. There is no single-claim
/// route, so it is read from the list. Pops with true when an action changed it.
class ClaimDetailScreen extends StatelessWidget {
  const ClaimDetailScreen({super.key, required this.session, required this.seed});

  final AppSession session;
  final Map<String, dynamic> seed;

  Future<Map<String, dynamic>> _load(KhatarioApi api) async {
    final id = docText(seed['id']);
    final body = await api.getData('/api/insurance-claims');
    for (final c in docRows(body, 'claims')) {
      if (docText(c['id']) == id) return c;
    }
    throw ApiException('Claim not found');
  }

  String _money(dynamic v) {
    final n = docNum(v);
    return n == null ? '' : inr(n, maxFraction: 2);
  }

  Future<bool?> _write(BuildContext ctx, Map<String, dynamic> c, Map<String, dynamic> body, String success) {
    final id = docText(c['id']);
    return guardedWrite(
      ctx,
      'claim-$id',
      () => session.api.patchJson('/api/insurance-claims/$id', body),
      success: success,
      alreadyChanged: claimAlreadyChanged,
      alreadyText: kClaimChangedText,
    );
  }

  Future<bool?> _admit(BuildContext ctx, Map<String, dynamic> c) async {
    final claimed = claimClaimed(c) ?? 0;
    final a = await askValueSheet(
      ctx,
      title: 'Admitted',
      label: 'Amount the insurer admitted',
      help: 'Claimed ${inr(claimed, maxFraction: 2)}.',
      initial: jsNumberString(claimed),
      confirmLabel: 'Continue',
    );
    if (a == null || !ctx.mounted) return null;
    final amount = positiveQty(a.value);
    if (amount == null) {
      showKToast(ctx, 'Enter the amount admitted', tone: KTone.negative);
      return null;
    }
    final ok = await askSheet(ctx, title: 'Record this admission?', text: admitText(c, amount), confirmLabel: 'Admit', cancelLabel: 'Not yet', danger: false);
    if (!ok || !ctx.mounted) return null;
    return _write(ctx, c, admitBody(amount, dateOnly(DateTime.now())), 'Claim admitted');
  }

  Future<bool?> _settle(BuildContext ctx, Map<String, dynamic> c) async {
    List<(String, String)> accounts;
    try {
      final body = await session.api.getData('/api/accounts?account_type=asset&limit=500');
      accounts = bankAccountOptions(docRows(body, 'accounts'));
    } on ApiException catch (e) {
      if (ctx.mounted) showKToast(ctx, e.message, tone: KTone.negative);
      return null;
    } catch (_) {
      if (ctx.mounted) showKToast(ctx, 'Could not reach the server. Try again.', tone: KTone.negative);
      return null;
    }
    if (!ctx.mounted) return null;
    if (accounts.isEmpty) {
      showKToast(ctx, 'No bank or cash account found', tone: KTone.negative);
      return null;
    }
    final admitted = docNum(c['admitted_amount']) ?? 0;
    final a = await askValueSheet(
      ctx,
      title: 'Received',
      label: 'Amount received',
      help: 'Admitted ${inr(admitted, maxFraction: 2)}.',
      initial: jsNumberString(admitted),
      confirmLabel: 'Continue',
      pickLabel: 'Received into',
      pickOptions: accounts,
      pickInitial: defaultBankAccount(accounts),
    );
    if (a == null || !ctx.mounted) return null;
    final amount = num.tryParse(a.value);
    if (amount == null || !amount.isFinite || amount < 0) {
      showKToast(ctx, 'Enter the amount received', tone: KTone.negative);
      return null;
    }
    final label = accounts.firstWhere((o) => o.$1 == a.pick, orElse: () => accounts.first).$2;
    final ok = await askSheet(ctx, title: 'Record the settlement?', text: settleText(c, amount, label), confirmLabel: 'Record received', cancelLabel: 'Not yet', danger: false);
    if (!ok || !ctx.mounted) return null;
    return _write(ctx, c, settleClaimBody(amount, dateOnly(DateTime.now()), a.pick), 'Settlement recorded');
  }

  Future<bool?> _reject(BuildContext ctx, Map<String, dynamic> c) async {
    final ok = await askSheet(ctx, title: 'Reject this claim?', text: rejectText(c), confirmLabel: 'Reject claim', cancelLabel: 'Keep claim');
    if (!ok || !ctx.mounted) return null;
    return _write(ctx, c, rejectBody(dateOnly(DateTime.now())), 'Claim rejected');
  }

  DocAction _action(Map<String, dynamic> c, ClaimAction a) => switch (a) {
        ClaimAction.admit => DocAction('Admitted', LucideIcons.circleCheck, (ctx) => _admit(ctx, c)),
        ClaimAction.settle => DocAction('Received', LucideIcons.landmark, (ctx) => _settle(ctx, c)),
        ClaimAction.reject => DocAction('Rejected', LucideIcons.circleX, (ctx) => _reject(ctx, c), danger: true),
      };

  @override
  Widget build(BuildContext context) {
    return DocDetailScreen(
      session: session,
      seed: seed,
      spec: DocDetailSpec(
        title: 'Insurance claim',
        load: _load,
        numberOf: claimTitle,
        statusOf: (c) => docText(c['status']),
        partyOf: (c) => docText(c['insurer']),
        amountOf: claimClaimed,
        facts: (c) {
          final loss = docDate(c['loss_date']);
          final firDate = docDate(c['fir_date']);
          return [
            ('Date of loss', loss == null ? '' : ddMMMyyyy(loss)),
            ('Cause', claimCauseLabel(docText(c['cause']))),
            ('Policy number', docText(c['policy_number'])),
            ('FIR number', docText(c['fir_number'])),
            ('FIR date', firDate == null ? '' : ddMMMyyyy(firDate)),
            ('Surveyor', docText(c['surveyor'])),
            ('Written off', _money(c['loss_value'])),
            ('Admitted', _money(c['admitted_amount'])),
            ('Received', _money(c['settled_amount'])),
          ];
        },
        lines: (c) => [
          for (final w in docRows(c, 'write_offs'))
            DocLine('${docText(w['number'])} · ${docText(w['item'])}', subtitle: 'Quantity ${enIn(docNum(w['qty']) ?? 0)}', amount: docNum(w['value'])),
        ],
        primary: (c) {
          final actions = claimActions(docText(c['status']));
          return actions.isEmpty ? null : _action(c, actions.first);
        },
        actions: (c) => [for (final a in claimActions(docText(c['status'])).skip(1)) _action(c, a)],
      ),
    );
  }
}

/// "Lodge a claim" (`POST /api/insurance-claims`). A theft claim needs the FIR number. Write-offs it covers are picked
/// from the stock write-offs of the loss kinds (`GET /api/inventory-adjustments`).
class ClaimFormScreen extends StatefulWidget {
  const ClaimFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ClaimFormScreen> createState() => _ClaimFormScreenState();
}

class _ClaimFormScreenState extends State<ClaimFormScreen> {
  final _insurer = TextEditingController();
  final _policy = TextEditingController();
  final _fir = TextEditingController();
  final _surveyor = TextEditingController();
  final _amount = TextEditingController();
  DateTime _loss = dateOnly(DateTime.now());
  DateTime? _firDate;
  String _cause = 'theft';
  List<Map<String, dynamic>> _writeOffs = const [];
  final _picked = <String>{};

  @override
  void initState() {
    super.initState();
    _loadWriteOffs();
  }

  @override
  void dispose() {
    for (final c in [_insurer, _policy, _fir, _surveyor, _amount]) {
      c.dispose();
    }
    super.dispose();
  }

  /// A failure only leaves the write-off list empty; the claim can still be lodged.
  Future<void> _loadWriteOffs() async {
    try {
      final body = await widget.session.api.getData('/api/inventory-adjustments?limit=100');
      if (mounted) setState(() => _writeOffs = claimWriteOffs(docRows(body, 'adjustments')).take(20).toList());
    } catch (_) {}
  }

  Future<void> _save() async {
    final claimed = num.tryParse(_amount.text.trim()) ?? 0;
    final refusal = claimRefusal(cause: _cause, insurer: _insurer.text, claimed: claimed, firNumber: _fir.text);
    if (refusal != null) throw ApiException(refusal);
    final done = await guardedWrite(
      context,
      'claim-new',
      () => widget.session.api.postJson(
        '/api/insurance-claims',
        claimBody(
          lossDate: _loss,
          cause: _cause,
          insurer: _insurer.text,
          policy: _policy.text,
          firNumber: _fir.text,
          firDate: _firDate,
          surveyor: _surveyor.text,
          claimed: claimed,
          adjustmentIds: [for (final a in _writeOffs) if (_picked.contains(docText(a['id']))) docText(a['id'])],
        ),
      ),
      success: 'Claim lodged',
    );
    if (done == true && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Lodge a claim',
      saveLabel: 'Lodge claim',
      onSave: _save,
      children: [
        KDateField(label: 'Date of loss', value: _loss, onChanged: (d) => setState(() => _loss = dateOnly(d))),
        KPickField<String>(label: 'Cause', value: _cause, options: kClaimCauses, onChanged: (v) => setState(() => _cause = v)),
        KTextField(label: 'Insurer', controller: _insurer),
        KTextField(label: 'Policy number', controller: _policy),
        KTextField(label: _cause == 'theft' ? 'FIR number (required)' : 'FIR number', controller: _fir),
        KDateField(label: 'FIR date', value: _firDate, onChanged: (d) => setState(() => _firDate = dateOnly(d))),
        KTextField(label: 'Surveyor', controller: _surveyor),
        KTextField(label: 'Amount claimed', controller: _amount, hint: '0', keyboard: const TextInputType.numberWithOptions(decimal: true)),
        if (_writeOffs.isNotEmpty)
          KFormSection(
            title: 'Write-offs this claim covers',
            children: [
              for (final a in _writeOffs)
                KToggleField(
                  label: claimWriteOffLabel(a),
                  value: _picked.contains(docText(a['id'])),
                  onChanged: (v) => setState(() => v ? _picked.add(docText(a['id'])) : _picked.remove(docText(a['id']))),
                ),
            ],
          ),
      ],
    );
  }
}
