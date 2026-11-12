import 'package:dio/dio.dart' show DioException, DioExceptionType;
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
import '../pages/website_page_screen.dart';
import '../sales/doc_action_sheets.dart';
import 'bank_recon_logic.dart';

/// `app/(app)/bank/reconciliation/page.tsx`: pick a bank account and a statement, then match each
/// statement line to a ledger entry, post a missing bank charge or interest entry, ignore it, or undo.
/// `GET /api/bank/reconciliation?bank_statement_id=` answers the lines, the suggestions and the
/// server's `summary`; the phone shows those balances and never works one out. Importing a statement
/// needs a spreadsheet upload, so it stays on the website.
class BankReconciliationScreen extends StatefulWidget {
  const BankReconciliationScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<BankReconciliationScreen> createState() => _BankReconciliationScreenState();
}

enum _LineAction { match, pick, create, ignore, undo }

/// "Could not reach the server" only for a real network failure; anything else is "Something went wrong".
String _unexpected(Object e) {
  final down = e is DioException &&
      e.response == null &&
      const {DioExceptionType.connectionError, DioExceptionType.connectionTimeout, DioExceptionType.sendTimeout, DioExceptionType.receiveTimeout}.contains(e.type);
  return down ? 'Could not reach the server.' : 'Something went wrong. Try again.';
}

class _BankReconciliationScreenState extends State<BankReconciliationScreen> {
  List<Map<String, dynamic>> _accounts = const [];
  List<Map<String, dynamic>> _statements = const [];
  String _accountId = '';
  String _statementId = '';
  Map<String, dynamic>? _data;
  bool _loading = true;
  bool _loadingData = false;
  bool _acting = false;
  bool _notInPlan = false;
  bool _noAccess = false;
  String? _error;
  int _seq = 0;
  ReconFilter _filter = ReconFilter.all;
  final _search = TextEditingController();

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _fail(Object e, int seq) {
    if (!mounted || seq != _seq) return;
    final api = e is ApiException ? e : null;
    setState(() {
      _notInPlan = api?.code == 'FEATURE_NOT_IN_PLAN';
      _noAccess = !_notInPlan && api?.status == 403;
      _error = api?.message ?? _unexpected(e);
      _loading = false;
      _loadingData = false;
    });
  }

  Future<void> _start({String keep = ''}) async {
    final seq = ++_seq;
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
      _noAccess = false;
    });
    try {
      final body = await widget.session.api.getData('/api/bank-accounts');
      if (!mounted || seq != _seq) return;
      final accounts = reconBankAccounts(body);
      setState(() {
        _accounts = accounts;
        _loading = false;
      });
      final pick = keep.isNotEmpty ? keep : (accounts.length == 1 ? docText(accounts.first['id']) : '');
      if (pick.isNotEmpty) await _selectAccount(pick);
    } catch (e) {
      _fail(e, seq);
    }
  }

  Future<void> _selectAccount(String id) async {
    final seq = ++_seq;
    setState(() {
      _accountId = id;
      _statements = const [];
      _statementId = '';
      _data = null;
      _loadingData = true;
      _error = null;
    });
    try {
      final body = await widget.session.api.getData(reconStatementsPath(id));
      if (!mounted || seq != _seq) return;
      final statements = docRows(body, 'statements');
      setState(() {
        _statements = statements;
        _loadingData = false;
      });
      if (statements.isNotEmpty) await _selectStatement(docText(statements.first['id']));
    } catch (e) {
      _fail(e, seq);
    }
  }

  Future<void> _selectStatement(String id) async {
    setState(() {
      _statementId = id;
      _data = null;
    });
    await _loadRec();
  }

  Future<void> _loadRec({bool spinner = true}) async {
    if (_statementId.isEmpty) return;
    final seq = ++_seq;
    if (spinner) setState(() => _loadingData = true);
    try {
      final body = await widget.session.api.getData(reconStatementPath(_statementId));
      if (!mounted || seq != _seq) return;
      setState(() {
        _data = body is Map ? Map<String, dynamic>.from(body) : null;
        _loadingData = false;
        _error = null;
      });
    } catch (e) {
      if (!spinner && _data != null && mounted && seq == _seq) {
        showKToast(context, e is ApiException ? e.message : _unexpected(e), tone: KTone.negative);
        return;
      }
      _fail(e, seq);
    }
  }

  /// One write, once: the server's refusal is shown and the screen reloads, since "already done" and
  /// "statement is reconciled" mean it was out of date.
  Future<void> _post(String path, Map<String, dynamic> body, String Function(Map<String, dynamic> reply) done) async {
    if (_acting) return;
    setState(() => _acting = true);
    try {
      final reply = await widget.session.api.postJson(path, body);
      if (!mounted) return;
      showKToast(context, done(reply), tone: KTone.positive);
      await _loadRec(spinner: false);
    } on ApiException catch (e) {
      if (!mounted) return;
      showKToast(context, e.message, tone: KTone.negative);
      await _loadRec(spinner: false);
    } catch (e) {
      if (mounted) showKToast(context, _unexpected(e), tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  List<Map<String, dynamic>> get _lines => docRows(_data, 'lines');

  Map<String, dynamic> get _summary {
    final s = _data?['summary'];
    return s is Map ? Map<String, dynamic>.from(s) : const {};
  }

  int get _unmatched => (docNum(_summary['unmatched_count']) ?? 0).toInt();

  Map<String, dynamic>? get _account {
    for (final a in _accounts) {
      if (docText(a['id']) == _accountId) return a;
    }
    return null;
  }

  Future<void> _autoMatch() async {
    final sure = await askSheet(
      context,
      title: 'Match automatically?',
      text: 'Every line with an exact or strong reference suggestion is matched at once. You can undo any match afterwards.',
      confirmLabel: 'Match now',
      cancelLabel: 'Not now',
      danger: false,
    );
    if (!sure || !mounted) return;
    await _post('/api/bank/reconciliation/auto-match', reconAutoMatchBody(_statementId), reconAutoMatchToast);
  }

  Future<void> _complete() async {
    final unmatched = _unmatched;
    final sure = await askSheet(
      context,
      title: 'Finish reconciliation?',
      text: reconCompleteQuestion(unmatched),
      confirmLabel: 'Mark reconciled',
      cancelLabel: 'Not now',
      danger: false,
    );
    if (!sure || !mounted) return;
    await _post('/api/bank/reconciliation/complete', reconCompleteBody(statementId: _statementId, force: unmatched > 0), (_) => 'Marked as reconciled');
  }

  Future<void> _openLine(Map<String, dynamic> line) async {
    if (_acting) return;
    final payload = _data;
    if (payload == null) return;
    final completed = reconIsCompleted(payload);
    final action = await showKSheet<_LineAction>(
      context,
      title: 'Statement line',
      builder: (_) => _LineSheet(line: line, payload: payload, completed: completed),
    );
    if (action == null || !mounted) return;
    final lineId = docText(line['id']);
    switch (action) {
      case _LineAction.match:
        final s = reconSuggestionFor(payload, lineId);
        if (s == null) return;
        await _post('/api/bank/reconciliation/match', reconMatchBody(statementId: _statementId, lineId: lineId, ledgerIds: reconSuggestionLedgerIds(s)), (_) => 'Line matched');
      case _LineAction.ignore:
        await _post('/api/bank/reconciliation/ignore', reconIgnoreBody(statementId: _statementId, lineId: lineId), (_) => 'Line ignored');
      case _LineAction.undo:
        await _post('/api/bank/reconciliation/undo', reconUndoBody(statementId: _statementId, lineId: lineId), (_) => 'Match undone');
      case _LineAction.pick:
        final ids = await showKSheet<List<String>>(
          context,
          title: 'Match to other entries',
          builder: (_) => _PickEntriesSheet(payload: payload, lineId: lineId),
        );
        if (ids == null || ids.isEmpty || !mounted) return;
        await _post('/api/bank/reconciliation/match', reconMatchBody(statementId: _statementId, lineId: lineId, ledgerIds: ids), (_) => 'Line matched');
      case _LineAction.create:
        await _createEntry(line);
    }
  }

  Future<void> _createEntry(Map<String, dynamic> line) async {
    final type = reconCreateType(line);
    if (type == null) return;
    final picked = await showKSheet<(String, String)>(
      context,
      title: 'Create entry',
      builder: (_) => _CreateEntrySheet(api: widget.session.api, type: type),
    );
    if (picked == null || !mounted) return;
    final bank = docText(_account?['ledger_account_name']);
    final sure = await askSheet(
      context,
      title: 'Post this entry?',
      text: reconCreateQuestion(line: line, type: type, accountName: picked.$2, bankName: bank.isEmpty ? 'the bank account' : bank),
      confirmLabel: 'Post and match',
      cancelLabel: 'Not now',
      danger: false,
    );
    if (!sure || !mounted) return;
    await _post(
      '/api/bank/reconciliation/create-entry',
      reconCreateEntryBody(statementId: _statementId, lineId: docText(line['id']), type: type, accountId: picked.$1),
      (reply) {
        final n = docText(reply['voucher_number']);
        return n.isEmpty ? 'Updated' : 'Posted journal $n';
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Bank reconciliation'),
            Expanded(child: _body()),
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
            title: 'Could not load bank reconciliation',
            body: _error,
            action: KButton.secondary(label: 'Try again', expand: false, onPressed: () => _start(keep: _accountId)),
          ),
      ]);
    }
    if (_accounts.isEmpty) {
      return ListView(children: const [
        KEmptyState(
          icon: LucideIcons.landmark,
          title: 'No bank account is linked to your books yet',
          body: 'Add a bank account on the website, then come back to reconcile its statements.',
        ),
      ]);
    }
    final data = _data;
    final completed = reconIsCompleted(data);
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: () => _statementId.isEmpty ? _start(keep: _accountId) : _loadRec(spinner: false),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
        children: [
          KPickField<String>(
            label: 'Bank account',
            value: _accountId.isEmpty ? null : _accountId,
            options: [for (final a in _accounts) (docText(a['id']), reconBankAccountLabel(a))],
            onChanged: (v) => _selectAccount(v),
          ),
          if (_accountId.isNotEmpty && !_loadingData && _statements.isEmpty) ...[
            KEmptyState(
              icon: LucideIcons.fileSpreadsheet,
              title: 'No statements for this account',
              body: 'Import a bank statement first, then match its lines here.',
              action: KButton.secondary(
                label: 'Import a statement on the website',
                expand: false,
                onPressed: () => openWebsiteInApp(context, widget.session, bankImportHref, 'Bank import'),
              ),
            ),
          ] else if (_statements.isNotEmpty) ...[
            const SizedBox(height: AppSpace.md),
            KPickField<String>(
              label: 'Statement',
              value: _statementId.isEmpty ? null : _statementId,
              options: [for (final s in _statements) (docText(s['id']), reconStatementLabel(s))],
              onChanged: (v) => _selectStatement(v),
            ),
          ],
          if (_loadingData) const KSpinner(padding: EdgeInsets.symmetric(vertical: 48)),
          if (data != null && !_loadingData) ..._statementView(data, completed),
        ],
      ),
    );
  }

  List<Widget> _statementView(Map<String, dynamic> data, bool completed) {
    final lines = _lines;
    final shown = reconFilterLines(lines, _filter, _search.text);
    return [
      const SizedBox(height: AppSpace.lg),
      KInfoCard(title: 'Summary', rows: reconSummaryRows(_summary)),
      const SizedBox(height: AppSpace.md),
      if (completed)
        const Align(alignment: Alignment.centerLeft, child: KPill(label: 'Reconciled', tone: KTone.positive, icon: LucideIcons.check))
      else
        Row(children: [
          Expanded(child: KButton.secondary(label: 'Match automatically', height: 44, onPressed: _acting ? null : _autoMatch)),
          const SizedBox(width: AppSpace.sm),
          Expanded(child: KButton(label: 'Mark as reconciled', height: 44, onPressed: _acting ? null : _complete)),
        ]),
      const SizedBox(height: AppSpace.lg),
      KSectionHeader('Statement lines'),
      KSearchField(controller: _search, hint: 'Search description or date', onChanged: (_) => setState(() {})),
      const SizedBox(height: AppSpace.sm),
      KChipBar<ReconFilter>(
        value: _filter,
        options: reconFilterOptions,
        padding: EdgeInsets.zero,
        onChanged: (v) => setState(() => _filter = v),
      ),
      const SizedBox(height: AppSpace.md),
      if (lines.isEmpty)
        const KEmptyState(icon: LucideIcons.fileX, title: 'No lines in this statement')
      else if (shown.isEmpty)
        const KEmptyState(icon: LucideIcons.searchX, title: 'No lines match', body: 'Change the search or the filter.')
      else
        KCard(child: KDivided(indent: 14, children: [for (final l in shown) _row(l, data)])),
    ];
  }

  Widget _row(Map<String, dynamic> line, Map<String, dynamic> data) {
    final status = docText(line['match_status']);
    final tone = switch (status) {
      'matched' => KTone.positive,
      'partial' => KTone.due,
      'ignored' => KTone.neutral,
      _ => KTone.negative,
    };
    final s = status == 'unmatched' ? reconSuggestionFor(data, docText(line['id'])) : null;
    final f = reconLineFlow(line);
    final day = docDate(line['transaction_date']);
    final age = docNum(line['age_days']);
    final notes = [
      if (day != null) ddMMMyyyy(day),
      if (line['is_duplicate'] == true) 'Possible duplicate',
      if (status == 'unmatched' && age != null && age > 0) '${age.toInt()}d old',
    ].join(' · ');
    return InkWell(
      onTap: _acting ? null : () => _openLine(line),
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
                  Text(docText(line['description']), maxLines: 2, overflow: TextOverflow.ellipsis, style: AppText.bodyStrong),
                  const SizedBox(height: 2),
                  Text(notes, style: AppText.caption),
                  if (s != null) ...[
                    const SizedBox(height: 4),
                    Text(reconSuggestionHeadline(s, line, reconLedgerById(data)), style: AppText.caption.copyWith(color: AppColors.brand)),
                  ],
                ],
              ),
            ),
            const SizedBox(width: AppSpace.md),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(reconLineAmountText(line), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular, color: f.inflow ? AppColors.positive : AppColors.ink)),
                const SizedBox(height: 4),
                KPill(label: reconStatusLabel(status), tone: tone),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// The line's details and what can be done with it. Pops the chosen [_LineAction]; a double tap pops once.
class _LineSheet extends StatefulWidget {
  const _LineSheet({required this.line, required this.payload, required this.completed});

  final Map<String, dynamic> line;
  final Map<String, dynamic> payload;
  final bool completed;

  @override
  State<_LineSheet> createState() => _LineSheetState();
}

class _LineSheetState extends State<_LineSheet> {
  bool _tapped = false;

  void _done(_LineAction a) {
    if (_tapped) return;
    _tapped = true;
    Navigator.of(context).pop(a);
  }

  @override
  Widget build(BuildContext context) {
    final line = widget.line;
    final status = docText(line['match_status']);
    final unmatched = status == 'unmatched';
    final ledger = reconLedgerById(widget.payload);
    final suggestion = unmatched ? reconSuggestionFor(widget.payload, docText(line['id'])) : null;
    final matched = status == 'matched' || status == 'partial' ? line['matched_ledger_ids'] : null;
    final day = docDate(line['transaction_date']);
    final canCreate = unmatched && !widget.completed && reconCreateType(line) != null;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(docText(line['description']), style: AppText.bodyStrong),
          const SizedBox(height: 4),
          Text('${day == null ? '' : '${ddMMMyyyy(day)} · '}${reconLineAmountText(line)} · ${reconStatusLabel(status)}', style: AppText.caption),
          if (suggestion != null) ...[
            const SizedBox(height: AppSpace.md),
            Text(reconSuggestionHeadline(suggestion, line, ledger), style: AppText.body.copyWith(color: AppColors.brand)),
            for (final id in reconSuggestionLedgerIds(suggestion)) Text(ledger[id] == null ? 'Ledger entry (not in the loaded window)' : reconLedgerLabel(ledger[id]!), style: AppText.caption),
          ],
          if (matched is List && matched.isNotEmpty) ...[
            const SizedBox(height: AppSpace.md),
            Text('Matched with', style: AppText.caption.copyWith(color: AppColors.ink2)),
            for (final raw in matched)
              Text(ledger[docText(raw)] == null ? 'Ledger entry (not in the loaded window)' : reconLedgerLabel(ledger[docText(raw)]!), style: AppText.caption),
          ],
          const SizedBox(height: AppSpace.lg),
          if (suggestion != null && !widget.completed) ...[
            KButton(label: 'Match to suggested entry', onPressed: () => _done(_LineAction.match)),
            const SizedBox(height: AppSpace.sm),
          ],
          if (canCreate) ...[
            KButton.secondary(label: 'Create entry', onPressed: () => _done(_LineAction.create)),
            const SizedBox(height: AppSpace.sm),
          ],
          if (unmatched && !widget.completed) ...[
            KButton.secondary(label: 'Match to other entries', onPressed: () => _done(_LineAction.pick)),
            const SizedBox(height: AppSpace.sm),
          ],
          if (unmatched && !widget.completed) KButton.secondary(label: 'Ignore this line', onPressed: () => _done(_LineAction.ignore)),
          if (!unmatched) KButton.secondary(label: 'Undo', onPressed: () => _done(_LineAction.undo)),
        ],
      ),
    );
  }
}

/// Picks the offset account for a new bank charge (an expense account) or interest entry (an income
/// account), as the website's "Post missing ledger entry" dialog does. Pops (account id, name).
class _CreateEntrySheet extends StatefulWidget {
  const _CreateEntrySheet({required this.api, required this.type});

  final KhatarioApi api;
  final String type;

  @override
  State<_CreateEntrySheet> createState() => _CreateEntrySheetState();
}

class _CreateEntrySheetState extends State<_CreateEntrySheet> {
  String _id = '';
  String _name = '';
  bool _tapped = false;

  bool get _charge => widget.type != 'interest';

  /// `GET /api/accounts?search=`, keeping only the account type the route accepts for this entry.
  Future<List<(String, String, String)>> _search(String q) async {
    final text = q.trim();
    final path = Uri(path: '/api/accounts', queryParameters: {'is_active': 'true', if (text.isNotEmpty) 'search': text}).toString();
    final body = await widget.api.getData(path);
    final want = reconOffsetAccountType(widget.type);
    return [
      for (final r in docRows(body, 'accounts'))
        if (docText(r['account_type']) == want && docText(r['id']).isNotEmpty) (docText(r['id']), docText(r['account_name']), docText(r['account_code'])),
    ];
  }

  void _go() {
    if (_tapped || _id.isEmpty) return;
    _tapped = true;
    Navigator.of(context).pop((_id, _name));
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            _charge
                ? 'Bank charge: debit the expense account, credit the bank. The statement line is matched to the new bank entry.'
                : 'Interest: debit the bank, credit the income account. The statement line is matched to the new bank entry.',
            style: AppText.body,
          ),
          const SizedBox(height: AppSpace.md),
          KAsyncPickField(
            label: 'Offset account',
            valueLabel: _name.isEmpty ? null : _name,
            search: _search,
            onPicked: (id, label) => setState(() {
              _id = id;
              _name = label;
            }),
          ),
          const SizedBox(height: AppSpace.lg),
          KButton(label: 'Review and post', onPressed: _id.isEmpty ? null : _go),
        ],
      ),
    );
  }
}

/// The website's ledger column as a multi-select: every `ledger_lines` entry of the reconciliation
/// reply, ticked or not, and "Match selected". The server's suggestion starts ticked, as on the website.
/// Pops the ticked ids in list order; Match is off until one is ticked.
class _PickEntriesSheet extends StatefulWidget {
  const _PickEntriesSheet({required this.payload, required this.lineId});

  final Map<String, dynamic> payload;
  final String lineId;

  @override
  State<_PickEntriesSheet> createState() => _PickEntriesSheetState();
}

class _PickEntriesSheetState extends State<_PickEntriesSheet> {
  late final Set<String> _ticked;
  bool _tapped = false;

  @override
  void initState() {
    super.initState();
    final s = reconSuggestionFor(widget.payload, widget.lineId);
    _ticked = {if (s != null) ...reconSuggestionLedgerIds(s)};
  }

  void _go(List<String> order) {
    if (_tapped || _ticked.isEmpty) return;
    _tapped = true;
    Navigator.of(context).pop([for (final id in order) if (_ticked.contains(id)) id]);
  }

  @override
  Widget build(BuildContext context) {
    final entries = docRows(widget.payload, 'ledger_lines');
    final order = [for (final l in entries) docText(l['id'])];
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Ledger (bank account)', style: AppText.caption.copyWith(color: AppColors.ink2)),
          const SizedBox(height: AppSpace.sm),
          if (entries.isEmpty)
            const KEmptyState(icon: LucideIcons.fileX, title: 'No ledger entries around this statement')
          else
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final l in entries)
                    InkWell(
                      onTap: () => setState(() {
                        final id = docText(l['id']);
                        if (!_ticked.remove(id)) _ticked.add(id);
                      }),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        child: Row(children: [
                          Icon(_ticked.contains(docText(l['id'])) ? LucideIcons.squareCheck : LucideIcons.square, size: 22, color: _ticked.contains(docText(l['id'])) ? AppColors.brand : AppColors.ink3),
                          const SizedBox(width: AppSpace.md),
                          Expanded(child: Text(reconLedgerLabel(l), style: AppText.body)),
                        ]),
                      ),
                    ),
                ],
              ),
            ),
          const SizedBox(height: AppSpace.lg),
          KButton(label: 'Match selected', onPressed: _ticked.isEmpty ? null : () => _go(order)),
        ],
      ),
    );
  }
}
