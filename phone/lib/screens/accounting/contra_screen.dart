import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import 'advances_logic.dart';
import '../../format.dart';

/// `app/(app)/contra/page.tsx`: cash deposits, cash withdrawals and transfers between your own bank
/// accounts. `GET /api/contra` answers `vouchers` (newest first, at most 500, so no paging) and
/// `accounts`, the cash and bank accounts a contra may use. A contra has no detail page on the website,
/// and none here.
class ContraScreen extends StatefulWidget {
  const ContraScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ContraScreen> createState() => _ContraScreenState();
}

class _ContraScreenState extends State<ContraScreen> {
  List<Map<String, dynamic>> _vouchers = const [];
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
      final body = await widget.session.api.getData('/api/contra');
      if (!mounted || seq != _seq) return;
      setState(() {
        _vouchers = docRows(body, 'vouchers');
        _accounts = contraAccounts(body);
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (!mounted || seq != _seq) return;
      if (!spinner && _vouchers.isNotEmpty) return showKToast(context, e.message, tone: KTone.negative);
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _noAccess = !_notInPlan && e.status == 403;
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || seq != _seq) return;
      if (!spinner && _vouchers.isNotEmpty) return showKToast(context, 'Could not reach the server.', tone: KTone.negative);
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  Future<void> _new() async {
    final number = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => ContraFormScreen(session: widget.session, accounts: _accounts)));
    if (number == null || !mounted) return;
    showKToast(context, number.isEmpty ? 'Contra posted' : 'Contra $number posted', tone: KTone.positive);
    _load(spinner: false);
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
                const KBackBar('Contra'),
                Expanded(child: _body()),
              ],
            ),
            if (!_loading && _error == null)
              Positioned(right: AppSpace.gutter, bottom: AppSpace.lg, child: KFab(label: 'New contra', onTap: _new)),
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
            title: 'Could not load contra entries',
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
        padding: const EdgeInsets.only(bottom: 112, top: AppSpace.xs),
        children: [
          if (_vouchers.isEmpty)
            const KEmptyState(icon: LucideIcons.arrowRightLeft, title: 'No contra entries yet', body: 'Record a cash deposit, a withdrawal or a bank transfer.')
          else
            KCard(
              margin: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
              child: KDivided(indent: 66, children: [for (final v in _vouchers) _row(v)]),
            ),
        ],
      ),
    );
  }

  Widget _row(Map<String, dynamic> v) {
    final day = docDate(v['entry_date']);
    return KListRow(
      title: contraRowTitle(v),
      subtitle: contraRowSubtitle(v),
      leading: const KAvatar(name: '', icon: LucideIcons.arrowRightLeft, muted: true),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(advanceMoney(docNum(v['amount']) ?? 0), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
          if (day != null) Text(ddMMMyyyy(day), style: AppText.caption),
        ],
      ),
    );
  }
}

/// The contra form: from and to accounts (only the cash and bank accounts the server sent), amount,
/// date, reference and narration. `POST /api/contra`; pops the new voucher number.
class ContraFormScreen extends StatefulWidget {
  const ContraFormScreen({super.key, required this.session, required this.accounts});

  final AppSession session;
  final List<Map<String, dynamic>> accounts;

  @override
  State<ContraFormScreen> createState() => _ContraFormScreenState();
}

class _ContraFormScreenState extends State<ContraFormScreen> {
  final _amount = TextEditingController();
  final _reference = TextEditingController();
  final _narration = TextEditingController();
  DateTime _date = DateTime.now();
  String _fromId = '';
  String _toId = '';

  @override
  void initState() {
    super.initState();
    for (final c in [_amount, _reference, _narration]) {
      c.addListener(_refresh);
    }
  }

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    _narration.dispose();
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  Map<String, dynamic>? _account(String id) {
    for (final a in widget.accounts) {
      if (docText(a['id']) == id) return a;
    }
    return null;
  }

  String? get _problem => contraProblem(from: _account(_fromId), to: _account(_toId), amountText: _amount.text);

  Future<void> _save() async {
    if (_problem != null) return;
    final reply = await widget.session.api.postJson(
      '/api/contra',
      contraBody(date: _date, fromId: _fromId, toId: _toId, amountText: _amount.text, reference: _reference.text, narration: _narration.text),
    );
    if (mounted) Navigator.of(context).pop(docText(reply['voucher_number']));
  }

  @override
  Widget build(BuildContext context) {
    final from = _account(_fromId);
    final to = _account(_toId);
    final kind = contraKindLabel(from, to);
    return KFormScaffold(
      title: 'New contra entry',
      saveLabel: 'Post contra',
      onSave: _save,
      canSave: _problem == null,
      dirty: _fromId.isNotEmpty || _toId.isNotEmpty || _amount.text.isNotEmpty || _reference.text.isNotEmpty || _narration.text.isNotEmpty,
      children: [
        if (widget.accounts.length < 2)
          Text('A contra needs two cash or bank accounts. Add a bank account on the website first.', style: AppText.body.copyWith(color: AppColors.negative)),
        KDateField(label: 'Date', value: _date, onChanged: (d) => setState(() => _date = d)),
        KPickField<String>(
          label: 'From (money leaves)',
          value: _fromId.isEmpty ? null : _fromId,
          options: [for (final a in widget.accounts) (docText(a['id']), contraAccountLabel(a))],
          onChanged: (v) => setState(() {
            _fromId = v;
            if (_toId == v) _toId = '';
          }),
        ),
        KPickField<String>(
          label: 'To (money arrives)',
          value: _toId.isEmpty ? null : _toId,
          options: [for (final a in contraToChoices(widget.accounts, _fromId)) (docText(a['id']), contraAccountLabel(a))],
          onChanged: (v) => setState(() => _toId = v),
        ),
        if (kind.isNotEmpty) Text(kind, style: AppText.caption),
        KAmountField(label: 'Amount', controller: _amount),
        KTextField(label: 'Reference (cheque / UTR)', controller: _reference),
        KTextField(label: 'Narration', controller: _narration),
      ],
    );
  }
}
