import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_detail_screen.dart';
import '../docs/doc_list_screen.dart' show DocAction;
import '../docs/doc_logic.dart';
import '../sales/doc_action_sheets.dart';
import 'advances_logic.dart';

/// `app/(app)/advances/page.tsx`: advances received from customers (receipt vouchers) and paid to
/// suppliers. `GET /api/advances?type=received|paid` answers `advances` (newest first, at most 500, so
/// no paging) and `accounts`, the cash and bank accounts for the money. `remaining` is the server's
/// unadjusted amount; the phone shows it and never works it out.
class AdvancesScreen extends StatefulWidget {
  const AdvancesScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<AdvancesScreen> createState() => _AdvancesScreenState();
}

class _AdvancesScreenState extends State<AdvancesScreen> {
  AdvanceSide _side = AdvanceSide.received;
  List<Map<String, dynamic>> _advances = const [];
  List<Map<String, dynamic>> _accounts = const [];
  bool _loading = true;
  bool _notInPlan = false;
  bool _noAccess = false;
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
        _noAccess = false;
      });
    }
    try {
      final body = await widget.session.api.getData(advancesPath(_side));
      if (!mounted || seq != _seq) return;
      setState(() {
        _advances = docRows(body, 'advances');
        _accounts = contraAccounts(body);
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (!mounted || seq != _seq) return;
      if (!spinner && _advances.isNotEmpty) return showKToast(context, e.message, tone: KTone.negative);
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _noAccess = !_notInPlan && e.status == 403;
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || seq != _seq) return;
      if (!spinner && _advances.isNotEmpty) return showKToast(context, 'Could not reach the server.', tone: KTone.negative);
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  void _setSide(AdvanceSide side) {
    if (side == _side) return;
    setState(() {
      _side = side;
      _advances = const [];
    });
    _load();
  }

  Future<void> _new() async {
    final message = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => AdvanceFormScreen(session: widget.session, side: _side, accounts: _accounts)));
    if (message == null || !mounted) return;
    showKToast(context, message, tone: KTone.positive);
    _load(spinner: false);
  }

  Future<void> _open(Map<String, dynamic> a) async {
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => AdvanceDetailScreen(session: widget.session, advanceId: docText(a['id']), accounts: _accounts),
    ));
    if (changed == true && mounted) _load(spinner: false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Stack(
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const KBackBar('Advances'),
                KChipBar<AdvanceSide>(
                  value: _side,
                  options: const [(AdvanceSide.received, 'From customers'), (AdvanceSide.paid, 'To suppliers')],
                  onChanged: _setSide,
                ),
                const SizedBox(height: AppSpace.sm),
                Expanded(child: _body()),
              ],
            ),
            if (!_loading && _error == null)
              Positioned(right: AppSpace.gutter, bottom: AppSpace.lg, child: KFab(label: 'New advance', onTap: _new)),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (_error != null) {
      return ListView(children: [
        if (_notInPlan)
          const KEmptyState(icon: LucideIcons.lock, title: 'Not included in your current plan')
        else if (_noAccess)
          const KEmptyState(icon: LucideIcons.lock, title: 'You do not have access to this')
        else
          KEmptyState(
            icon: LucideIcons.cloudOff,
            title: 'Could not load advances',
            body: _error,
            action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
          ),
      ]);
    }
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: () => _load(spinner: false),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: 112),
        children: [
          if (_advances.isEmpty)
            KEmptyState(
              icon: LucideIcons.wallet,
              title: 'No advances yet',
              body: _side == AdvanceSide.received ? 'Receipt vouchers for advances from customers show up here.' : 'Advances you pay to suppliers show up here.',
            )
          else
            KCard(
              margin: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
              child: KDivided(indent: 66, children: [for (final a in _advances) _row(a)]),
            ),
        ],
      ),
    );
  }

  Widget _row(Map<String, dynamic> a) {
    final left = docNum(a['remaining']);
    final status = docText(a['status']);
    return KListRow(
      title: advanceRowTitle(a),
      subtitle: advanceRowSubtitle(a),
      leading: const KAvatar(name: '', icon: LucideIcons.wallet, muted: true),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(inr(docNum(a['amount']) ?? 0, maxFraction: 2), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
          if (left != null && advanceIsOpen(a)) Text('Unadjusted ${inr(left, maxFraction: 2)}', style: AppText.caption),
          if (status.isNotEmpty) KStatusDot.status(status),
        ],
      ),
      onTap: () => _open(a),
    );
  }
}

/// One advance: `GET /api/advances/[id]` answers `advance`, its `adjustments` (adjustments and refunds)
/// and `open_documents` (the party's open invoices or bills, which Adjust offers). Adjust and Refund show
/// only while the server's `remaining` is above zero. [accounts] are the cash and bank accounts the list
/// received, for Refund.
class AdvanceDetailScreen extends StatelessWidget {
  const AdvanceDetailScreen({super.key, required this.session, required this.advanceId, required this.accounts});

  final AppSession session;
  final String advanceId;
  final List<Map<String, dynamic>> accounts;

  static String _money(num v) => inr(v, maxFraction: 2);

  Future<Map<String, dynamic>> _load(KhatarioApi api) async {
    final body = await api.getData('/api/advances/$advanceId');
    final advance = body is Map ? body['advance'] : null;
    if (advance is! Map) throw ApiException('Advance not found');
    return {
      ...Map<String, dynamic>.from(advance),
      'adjustments': docRows(body, 'adjustments'),
      'open_documents': docRows(body, 'open_documents'),
    };
  }

  static AdvanceSide _side(Map<String, dynamic> d) => docText(d['type']) == 'paid' ? AdvanceSide.paid : AdvanceSide.received;

  Future<bool?> _act(BuildContext context, Map<String, dynamic> d, {required bool refund}) async {
    final message = await Navigator.of(context).push<String>(MaterialPageRoute(
      builder: (_) => AdvanceActionScreen(
        session: session,
        advance: d,
        openDocuments: docRows(d, 'open_documents'),
        accounts: accounts,
        refund: refund,
      ),
    ));
    if (message == null) return null;
    if (context.mounted) showKToast(context, message, tone: KTone.positive);
    return true;
  }

  @override
  Widget build(BuildContext context) {
    return DocDetailScreen(
      session: session,
      spec: DocDetailSpec(
        title: 'Advance',
        load: _load,
        numberOf: (d) => docText(d['voucher_number']).isEmpty ? 'Advance' : docText(d['voucher_number']),
        statusOf: (d) => docText(d['status']),
        partyOf: (d) => docText(d['party_name']),
        amountOf: (d) => docNum(d['amount']),
        facts: (d) {
          final received = _side(d) == AdvanceSide.received;
          final services = received && docText(d['supply_type']) == 'services';
          String money(String key) {
            final n = docNum(d[key]);
            return n == null || n <= 0 ? '' : _money(n);
          }

          final rate = docNum(d['tax_rate']);
          return [
            ('Type', received ? 'Advance from customer' : 'Advance to supplier'),
            ('Date', docDate(d['payment_date']) == null ? '' : ddMMMyyyy(docDate(d['payment_date'])!)),
            ('Reference', docText(d['reference_number'])),
            if (received) ('Against supply of', services ? 'Services' : 'Goods'),
            if (services && rate != null && rate > 0) ('GST rate', '${jsNumberString(rate)}%'),
            ('Taxable value', money('taxable_value')),
            ('CGST', money('cgst')),
            ('SGST', money('sgst')),
            ('IGST', money('igst')),
            ('Cess', money('cess')),
            ('Adjusted so far', money('adjusted_amount')),
            ('Refunded so far', money('refunded_amount')),
            ('Notes', docText(d['notes'])),
          ];
        },
        lines: (d) => [
          for (final a in docRows(d, 'adjustments'))
            DocLine(advanceAdjustmentTitle(a), subtitle: advanceAdjustmentSubtitle(a), amount: docNum(a['amount'])),
        ],
        totals: (d) => [('Unadjusted', docNum(d['remaining']))],
        primary: (d) => advanceIsOpen(d) ? DocAction('Adjust', LucideIcons.arrowLeftRight, (ctx) => _act(ctx, d, refund: false)) : null,
        actions: (d) => advanceIsOpen(d) ? [DocAction('Refund', LucideIcons.undo2, (ctx) => _act(ctx, d, refund: true))] : const [],
      ),
    );
  }
}

/// Adjust an advance against an invoice or bill, or refund part of it. Pops the toast text on success.
///
/// Adjust (`POST /api/advances/[id]/adjust`) offers the invoices (customer advance) or bills (supplier
/// advance) the server listed as open for the party, and fills the amount as the website does. Refund
/// (`POST /api/advances/[id]/refund`) asks first, naming the amount and the account. The server checks the
/// amount and date; its refusal is shown and the form stays filled.
class AdvanceActionScreen extends StatefulWidget {
  const AdvanceActionScreen({
    super.key,
    required this.session,
    required this.advance,
    required this.openDocuments,
    required this.accounts,
    required this.refund,
  });

  final AppSession session;
  final Map<String, dynamic> advance;
  final List<Map<String, dynamic>> openDocuments;
  final List<Map<String, dynamic>> accounts;
  final bool refund;

  @override
  State<AdvanceActionScreen> createState() => _AdvanceActionScreenState();
}

class _AdvanceActionScreenState extends State<AdvanceActionScreen> {
  late final _amount = TextEditingController(text: jsNumberString(docNum(widget.advance['remaining']) ?? 0))..addListener(_refresh);
  DateTime _date = DateTime.now();
  String _documentId = '';
  String _accountId = '';

  AdvanceSide get _side => docText(widget.advance['type']) == 'paid' ? AdvanceSide.paid : AdvanceSide.received;

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  Map<String, dynamic>? get _document {
    for (final d in widget.openDocuments) {
      if (docText(d['id']) == _documentId) return d;
    }
    return null;
  }

  Map<String, dynamic>? get _account {
    for (final a in widget.accounts) {
      if (docText(a['id']) == _accountId) return a;
    }
    return null;
  }

  num? get _amountValue {
    final n = docNum(_amount.text.trim());
    return n == null || n <= 0 ? null : n;
  }

  bool get _ready => _amountValue != null && (widget.refund ? _accountId.isNotEmpty : _documentId.isNotEmpty);

  String get _accountLabel {
    final a = _account;
    return a == null ? '' : '${docText(a['code'])} · ${docText(a['name'])}';
  }

  Future<void> _save() async {
    if (!_ready) return;
    final api = widget.session.api;
    final id = docText(widget.advance['id']);
    if (!widget.refund) {
      final reply = await api.postJson('/api/advances/$id/adjust', adjustBody(side: _side, documentId: _documentId, amountText: _amount.text, date: _date));
      if (mounted) Navigator.of(context).pop('Adjusted ${docText(reply['voucher_number'])}'.trim());
      return;
    }
    final money = advanceMoney(_amountValue ?? 0);
    final paidFrom = _side == AdvanceSide.received;
    final sure = await askSheet(
      context,
      title: 'Issue refund?',
      text: paidFrom
          ? 'Refund $money paid from $_accountLabel against ${docText(widget.advance['voucher_number'])}? A refund voucher is issued and the advance is reduced.'
          : 'Refund of $money received into $_accountLabel against ${docText(widget.advance['voucher_number'])}? A refund voucher is issued and the advance is reduced.',
      confirmLabel: 'Issue refund voucher',
      cancelLabel: 'Keep it',
      danger: false,
    );
    if (!sure || !mounted) return;
    final reply = await api.postJson('/api/advances/$id/refund', refundBody(amountText: _amount.text, date: _date, accountId: _accountId));
    if (mounted) Navigator.of(context).pop('Refund voucher ${docText(reply['voucher_number'])}'.trim());
  }

  @override
  Widget build(BuildContext context) {
    final voucher = docText(widget.advance['voucher_number']);
    final received = _side == AdvanceSide.received;
    final docs = advanceDocOptions(widget.openDocuments);
    return KFormScaffold(
      title: widget.refund ? 'Refund advance $voucher' : 'Adjust advance $voucher',
      saveLabel: widget.refund ? 'Issue refund voucher' : 'Adjust',
      onSave: _save,
      canSave: _ready,
      dirty: false,
      children: [
        Text('Unadjusted: ${advanceMoney(docNum(widget.advance['remaining']) ?? 0)}', style: AppText.body.copyWith(color: AppColors.ink2)),
        if (!widget.refund) ...[
          KPickField<String>(
            label: received ? 'Invoice' : 'Purchase bill',
            value: _documentId.isEmpty ? null : _documentId,
            options: docs,
            searchable: docs.length > 8,
            onChanged: (v) => setState(() {
              _documentId = v;
              _amount.text = adjustDefaultAmount(widget.advance, _document);
            }),
          ),
          if (docs.isEmpty) Text('No open ${received ? 'invoices' : 'bills'} for this party.', style: AppText.caption),
          if (_document != null) Text('Balance due ${advanceMoney(docNum(_document!['balance_amount']) ?? 0)}', style: AppText.caption),
        ] else
          KPickField<String>(
            label: received ? 'Refund paid from' : 'Refund received into',
            value: _accountId.isEmpty ? null : _accountId,
            options: [for (final a in widget.accounts) (docText(a['id']), '${docText(a['code'])} · ${docText(a['name'])}')],
            onChanged: (v) => setState(() => _accountId = v),
          ),
        KAmountField(label: 'Amount', controller: _amount),
        KDateField(label: 'Date', value: _date, onChanged: (d) => setState(() => _date = d)),
      ],
    );
  }
}

/// A new advance (`POST /api/advances`): a receipt voucher for a customer, or an advance paid to a
/// supplier. Pops the toast text on success. Only a customer advance for services has a GST rate.
class AdvanceFormScreen extends StatefulWidget {
  const AdvanceFormScreen({super.key, required this.session, required this.side, required this.accounts});

  final AppSession session;
  final AdvanceSide side;
  final List<Map<String, dynamic>> accounts;

  @override
  State<AdvanceFormScreen> createState() => _AdvanceFormScreenState();
}

class _AdvanceFormScreenState extends State<AdvanceFormScreen> {
  final _amount = TextEditingController();
  final _reference = TextEditingController();
  final _notes = TextEditingController();
  DateTime _date = DateTime.now();
  String _partyId = '';
  String _partyLabel = '';
  String _accountId = '';
  String _supply = 'services';
  num _rate = 18;
  String? _problem;

  bool get _received => widget.side == AdvanceSide.received;

  @override
  void initState() {
    super.initState();
    for (final c in [_amount, _reference, _notes]) {
      c.addListener(_refresh);
    }
  }

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    _notes.dispose();
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  Future<void> _save() async {
    final problem = advanceProblem(side: widget.side, partyId: _partyId, amountText: _amount.text, accountId: _accountId);
    setState(() => _problem = problem);
    if (problem != null) return;
    final reply = await widget.session.api.postJson(
      '/api/advances',
      advanceBody(
        side: widget.side,
        partyId: _partyId,
        amountText: _amount.text,
        date: _date,
        supplyType: _supply,
        taxRate: _rate,
        accountId: _accountId,
        reference: _reference.text,
        notes: _notes.text,
      ),
    );
    final n = docText(reply['voucher_number']);
    if (mounted) Navigator.of(context).pop('${_received ? 'Receipt voucher' : 'Advance'} $n recorded');
  }

  @override
  Widget build(BuildContext context) {
    final api = widget.session.api;
    final gst = _received && _supply == 'services';
    return KFormScaffold(
      title: 'New advance',
      saveLabel: _received ? 'Issue receipt voucher' : 'Record advance paid',
      onSave: _save,
      dirty: _partyId.isNotEmpty || _amount.text.isNotEmpty || _accountId.isNotEmpty || _reference.text.isNotEmpty || _notes.text.isNotEmpty,
      children: [
        KAsyncPickField(
          label: _received ? 'Customer' : 'Supplier',
          valueLabel: _partyId.isEmpty ? null : _partyLabel,
          search: (q) => _received ? searchCustomers(api, q) : searchSuppliers(api, q),
          onPicked: (id, label) => setState(() {
            _partyId = id;
            _partyLabel = label;
            _problem = null;
          }),
        ),
        KDateField(label: 'Date', value: _date, onChanged: (d) => setState(() => _date = d)),
        KAmountField(label: 'Amount (incl. GST)', controller: _amount),
        KPickField<String>(
          label: _received ? 'Received into' : 'Paid from',
          value: _accountId.isEmpty ? null : _accountId,
          options: [for (final a in widget.accounts) (docText(a['id']), '${docText(a['code'])} · ${docText(a['name'])}')],
          onChanged: (v) => setState(() {
            _accountId = v;
            _problem = null;
          }),
        ),
        if (_received)
          KPickField<String>(
            label: 'Against supply of',
            value: _supply,
            options: const [('services', 'Services (GST payable on advance)'), ('goods', 'Goods (no GST on advance)')],
            onChanged: (v) => setState(() => _supply = v),
          ),
        if (gst)
          KPickField<num>(
            label: 'GST rate %',
            value: _rate,
            options: [for (final r in kAdvanceGstRates) (r, '${jsNumberString(r)}%')],
            onChanged: (v) => setState(() => _rate = v),
          ),
        KTextField(label: 'Reference (UTR / cheque)', controller: _reference),
        KTextField(label: 'Notes', controller: _notes),
        if (_problem != null) Text(_problem!, style: AppText.body.copyWith(color: AppColors.negative)),
      ],
    );
  }
}
