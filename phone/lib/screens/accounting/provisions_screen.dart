import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import '../reports/report_period.dart';
import '../sales/doc_action_sheets.dart';
import 'assets_tds_logic.dart';
import 'assets_tds_widgets.dart';

/// `app/(app)/provisions/page.tsx`: provisions for one financial year, with their entries. Plan-gated
/// (`accounting_provisions`). `GET /api/provisions?financial_year=` answers `provisions`, each with the
/// server's `current_balance` and `entries_count`. The website adds those balances up on the page; the
/// phone does not, because the route sends no total.
class ProvisionsScreen extends StatefulWidget {
  const ProvisionsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ProvisionsScreen> createState() => _ProvisionsScreenState();
}

class _ProvisionsScreenState extends State<ProvisionsScreen> {
  FinancialYear _fy = FinancialYear.of(DateTime.now());
  List<Map<String, dynamic>> _provisions = const [];
  bool _loading = true;
  LoadProblem? _problem;
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
        _problem = null;
      });
    }
    try {
      final body = await widget.session.api.getData(provisionsPath(_fy.longCode));
      if (!mounted || seq != _seq) return;
      setState(() {
        _provisions = docRows(body, 'provisions');
        _loading = false;
        _problem = null;
      });
    } catch (e) {
      if (!mounted || seq != _seq) return;
      final problem = loadProblemOf(e);
      if (!spinner && _provisions.isNotEmpty) return showKToast(context, problem.message, tone: KTone.negative);
      setState(() {
        _problem = problem;
        _loading = false;
      });
    }
  }

  void _setYear(FinancialYear fy) {
    setState(() {
      _fy = fy;
      _provisions = const [];
    });
    _load();
  }

  Future<void> _new() async {
    final message = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => ProvisionFormScreen(session: widget.session)));
    if (message == null || !mounted) return;
    showKToast(context, message, tone: KTone.positive);
    _load(spinner: false);
  }

  Future<void> _open(Map<String, dynamic> p) async {
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => ProvisionDetailScreen(session: widget.session, provisionId: docText(p['id']), fy: _fy),
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
                const KBackBar('Provisions'),
                FinancialYearBar(period: _fy, onChanged: _setYear),
                const SizedBox(height: AppSpace.sm),
                Expanded(child: _body()),
              ],
            ),
            if (!_loading && _problem == null) Positioned(right: AppSpace.gutter, bottom: AppSpace.lg, child: KFab(label: 'New provision', onTap: _new)),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    final problem = _problem;
    if (problem != null) return LoadProblemView(problem: problem, what: 'provisions', onRetry: _load);
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: () => _load(spinner: false),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: 112),
        children: [
          if (_provisions.isEmpty)
            const KEmptyState(icon: LucideIcons.fileText, title: 'No provisions yet', body: 'Create a provision to track bad debts, warranty or gratuity.')
          else
            KCard(
              margin: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
              child: KDivided(children: [
                for (final p in _provisions)
                  KListRow(
                    title: provisionRowTitle(p),
                    subtitle: provisionRowSubtitle(p),
                    leading: const KAvatar(name: '', icon: LucideIcons.fileText, muted: true),
                    trailing: Text(assetsMoney(docNum(p['current_balance']) ?? 0), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
                    onTap: () => _open(p),
                  ),
              ]),
            ),
        ],
      ),
    );
  }
}

/// One provision and its entries for the year (`GET /api/provisions/[id]/entries?financial_year=`). The
/// balance is the server's `current_balance` from the list route (there is no single-provision balance), and
/// each entry shows the server's opening and closing balance. Edit, Delete and Add entry live here. Pops
/// `true` when something changed.
class ProvisionDetailScreen extends StatefulWidget {
  const ProvisionDetailScreen({super.key, required this.session, required this.provisionId, required this.fy});

  final AppSession session;
  final String provisionId;
  final FinancialYear fy;

  @override
  State<ProvisionDetailScreen> createState() => _ProvisionDetailScreenState();
}

class _ProvisionDetailScreenState extends State<ProvisionDetailScreen> {
  Map<String, dynamic>? _provision;
  List<Map<String, dynamic>> _entries = const [];
  bool _loading = true;
  bool _changed = false;
  bool _deleting = false;
  LoadProblem? _problem;
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
        _problem = null;
      });
    }
    try {
      final api = widget.session.api;
      final list = await api.getData(provisionsPath(widget.fy.longCode));
      Map<String, dynamic>? found;
      for (final p in docRows(list, 'provisions')) {
        if (docText(p['id']) == widget.provisionId) found = p;
      }
      if (found == null) throw ApiException('Provision not found');
      final entries = await api.getData(provisionEntriesPath(widget.provisionId, widget.fy.longCode));
      if (!mounted || seq != _seq) return;
      setState(() {
        _provision = found;
        _entries = docRows(entries, 'entries');
        _loading = false;
        _problem = null;
      });
    } catch (e) {
      if (!mounted || seq != _seq) return;
      final problem = loadProblemOf(e);
      if (!spinner && _provision != null) return showKToast(context, problem.message, tone: KTone.negative);
      setState(() {
        _problem = problem;
        _loading = false;
      });
    }
  }

  Future<void> _addEntry() async {
    final p = _provision;
    if (p == null) return;
    final message = await Navigator.of(context).push<String>(MaterialPageRoute(
      builder: (_) => ProvisionEntryScreen(session: widget.session, provision: p, fy: widget.fy),
    ));
    if (message == null || !mounted) return;
    _changed = true;
    showKToast(context, message, tone: KTone.positive);
    _load(spinner: false);
  }

  Future<void> _edit() async {
    final p = _provision;
    if (p == null) return;
    final message = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => ProvisionFormScreen(session: widget.session, provision: p)));
    if (message == null || !mounted) return;
    _changed = true;
    showKToast(context, message, tone: KTone.positive);
    _load(spinner: false);
  }

  Future<void> _delete() async {
    final p = _provision;
    if (p == null || _deleting) return;
    final sure = await askSheet(
      context,
      title: 'Delete this provision?',
      text: 'Delete ${provisionRowTitle(p)}? It is removed from the list; its past entries stay in the books.',
      confirmLabel: 'Delete provision',
      cancelLabel: 'Keep it',
    );
    if (!sure || !mounted) return;
    setState(() => _deleting = true);
    try {
      await widget.session.api.deleteJson('/api/provisions/${widget.provisionId}');
      if (!mounted) return;
      showKToast(context, 'Provision deleted', tone: KTone.positive);
      Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        showKToast(context, actionProblemOf(e), tone: KTone.negative);
        setState(() => _deleting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _provision;
    return PopScope(
      canPop: !_changed,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(true);
      },
      child: Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              KBackBar(
                p == null ? 'Provision' : provisionRowTitle(p),
                trailing: p == null
                    ? null
                    : Row(mainAxisSize: MainAxisSize.min, children: [
                        Tooltip(message: 'Edit', child: KIconButton(icon: LucideIcons.pencil, tooltip: 'Edit', onTap: _edit)),
                        Tooltip(message: 'Delete', child: KIconButton(icon: LucideIcons.trash2, tooltip: 'Delete', onTap: _delete)),
                      ]),
              ),
              Expanded(child: _body(p)),
              if (p != null) KBottomBar(children: [Expanded(child: KButton(label: 'Add entry', icon: LucideIcons.plus, onPressed: _addEntry))]),
            ],
          ),
        ),
      ),
    );
  }

  Widget _body(Map<String, dynamic>? p) {
    if (p == null) {
      if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
      return LoadProblemView(problem: _problem ?? const LoadProblem('Could not reach the server.'), what: 'the provision', onRetry: _load);
    }
    final rate = docNum(p['calculation_rate']);
    final facts = <(String, String)>[
      ('Code', docText(p['provision_code'])),
      ('Type', provisionTypeLabel(docText(p['provision_type']))),
      ('Financial year', widget.fy.longCode),
      ('Method', docText(p['calculation_method'])),
      ('Rate', rate == null || rate == 0 ? '' : '${jsNumberString(rate)}%'),
      ('Notes', docText(p['description'])),
    ];
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: () => _load(spinner: false),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.xl),
        children: [
          KCard(
            padding: const EdgeInsets.all(AppSpace.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Balance', style: AppText.caption),
                const SizedBox(height: AppSpace.xs),
                KAmount(docNum(p['current_balance']) ?? 0, maxFraction: 2),
              ],
            ),
          ),
          const SizedBox(height: AppSpace.lg),
          KInfoCard(title: 'Details', rows: [for (final f in facts) if (f.$2.trim().isNotEmpty) f]),
          const SizedBox(height: AppSpace.lg),
          const KSectionHeader('Provision entries'),
          if (_entries.isEmpty)
            KCard(padding: const EdgeInsets.all(AppSpace.lg), child: Text('No entries for this year.', style: AppText.body.copyWith(color: AppColors.ink2)))
          else
            KCard(
              child: KDivided(children: [
                for (final e in _entries)
                  KListRow(
                    title: entryRowTitle(e),
                    subtitle: entryRowSubtitle(e),
                    trailing: Text(
                      '${entryIsAddition(e) ? '+' : '-'}${assetsMoney(docNum(e['amount']) ?? 0)}',
                      style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular, color: entryIsAddition(e) ? AppColors.negative : AppColors.positive),
                    ),
                  ),
              ]),
            ),
        ],
      ),
    );
  }
}

/// Add or edit a provision. Add is `POST /api/provisions`; edit is `PATCH /api/provisions/[id]`, which only
/// updates the name, type, method, rate and notes (the website's edit form shows the code and accounts but the
/// route ignores them, so the phone does not offer them on edit). The provision and expense accounts are
/// optional: blank uses the server's default accounts. Pops the toast text on success.
class ProvisionFormScreen extends StatefulWidget {
  const ProvisionFormScreen({super.key, required this.session, this.provision});

  final AppSession session;
  final Map<String, dynamic>? provision;

  @override
  State<ProvisionFormScreen> createState() => _ProvisionFormScreenState();
}

class _ProvisionFormScreenState extends State<ProvisionFormScreen> {
  late final _code = TextEditingController(text: docText(widget.provision?['provision_code']));
  late final _name = TextEditingController(text: docText(widget.provision?['provision_name']));
  late final _method = TextEditingController(text: docText(widget.provision?['calculation_method']));
  late final _rate = TextEditingController(text: _initialRate());
  late final _description = TextEditingController(text: docText(widget.provision?['description']));
  late String _type = docText(widget.provision?['provision_type']).isEmpty ? 'bad_debts' : docText(widget.provision?['provision_type']);
  String _provisionAccountId = '';
  String _provisionAccountLabel = '';
  String _expenseAccountId = '';
  String _expenseAccountLabel = '';
  String? _problem;
  bool _dirty = false;

  bool get _editing => widget.provision != null;

  String _initialRate() {
    final n = docNum(widget.provision?['calculation_rate']);
    return n == null || n == 0 ? '' : jsNumberString(n);
  }

  List<TextEditingController> get _controllers => [_code, _name, _method, _rate, _description];

  @override
  void initState() {
    super.initState();
    for (final c in _controllers) {
      c.addListener(_refresh);
    }
  }

  @override
  void dispose() {
    for (final c in _controllers) {
      c.dispose();
    }
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() => _dirty = true);
  }

  Future<void> _save() async {
    final problem = provisionProblem(code: _code.text, name: _name.text, rateText: _rate.text);
    setState(() => _problem = problem);
    if (problem != null) return;
    final api = widget.session.api;
    if (_editing) {
      await api.patchJson(
        '/api/provisions/${docText(widget.provision!['id'])}',
        provisionUpdateBody(name: _name.text, type: _type, method: _method.text, rateText: _rate.text, description: _description.text),
      );
      if (mounted) Navigator.of(context).pop('Provision updated');
      return;
    }
    await api.postJson(
      '/api/provisions',
      provisionCreateBody(
        code: _code.text,
        name: _name.text,
        type: _type,
        provisionAccountId: _provisionAccountId,
        expenseAccountId: _expenseAccountId,
        method: _method.text,
        rateText: _rate.text,
        description: _description.text,
      ),
    );
    if (mounted) Navigator.of(context).pop('Provision created');
  }

  @override
  Widget build(BuildContext context) {
    final api = widget.session.api;
    return KFormScaffold(
      title: _editing ? 'Edit provision' : 'New provision',
      saveLabel: _editing ? 'Save changes' : 'Create provision',
      onSave: _save,
      dirty: _dirty,
      children: [
        KTextField(label: 'Provision code', controller: _code, enabled: !_editing, hint: 'e.g. PROV-001'),
        KTextField(label: 'Provision name', controller: _name, hint: 'e.g. Provision for bad debts'),
        KPickField<String>(label: 'Provision type', value: _type, options: kProvisionTypes, onChanged: (v) => setState(() {
          _type = v;
          _dirty = true;
        })),
        if (!_editing) ...[
          KAsyncPickField(
            label: 'Provision account (liability)',
            valueLabel: _provisionAccountId.isEmpty ? null : _provisionAccountLabel,
            search: (q) => searchAccounts(api, q),
            onPicked: (id, label) => setState(() {
              _provisionAccountId = id;
              _provisionAccountLabel = label;
            }),
          ),
          KAsyncPickField(
            label: 'Expense account',
            valueLabel: _expenseAccountId.isEmpty ? null : _expenseAccountLabel,
            search: (q) => searchAccounts(api, q),
            onPicked: (id, label) => setState(() {
              _expenseAccountId = id;
              _expenseAccountLabel = label;
            }),
          ),
          Text('Leave both blank to use your default provision and expense accounts.', style: AppText.caption),
        ],
        KTextField(label: 'Calculation method', controller: _method, hint: 'e.g. percentage, aging'),
        KAmountField(label: 'Calculation rate (%)', controller: _rate),
        KTextField(label: 'Description', controller: _description, maxLines: 3, minLines: 2),
        if (_problem != null) Text(_problem!, style: AppText.body.copyWith(color: AppColors.negative)),
      ],
    );
  }
}

/// A provision entry (`POST /api/provisions/[id]/entries`): an addition, a reversal or a utilization. It
/// posts to the books, so it asks first, naming the provision, the type and the amount typed. The server
/// works out the opening and closing balance, which the entries list then shows. A utilization names the
/// account the cost is settled against (the server needs it unless the provision is bad debts). Pops the
/// toast text on success.
class ProvisionEntryScreen extends StatefulWidget {
  const ProvisionEntryScreen({super.key, required this.session, required this.provision, required this.fy});

  final AppSession session;
  final Map<String, dynamic> provision;
  final FinancialYear fy;

  @override
  State<ProvisionEntryScreen> createState() => _ProvisionEntryScreenState();
}

class _ProvisionEntryScreenState extends State<ProvisionEntryScreen> {
  final _amount = TextEditingController();
  final _narration = TextEditingController();
  DateTime _date = dateOnly(DateTime.now());
  String _type = 'addition';
  String _counterId = '';
  String _counterLabel = '';
  String? _problem;

  @override
  void initState() {
    super.initState();
    _amount.addListener(_refresh);
    _narration.addListener(_refresh);
  }

  @override
  void dispose() {
    _amount.dispose();
    _narration.dispose();
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  Future<void> _save() async {
    final provisionType = docText(widget.provision['provision_type']);
    final problem = provisionEntryProblem(type: _type, amountText: _amount.text, counterAccountId: _counterId, provisionType: provisionType);
    setState(() => _problem = problem);
    if (problem != null) return;
    final amount = assetsMoney(docNum(_amount.text.replaceAll(',', '').trim()) ?? 0);
    final sure = await askSheet(
      context,
      title: 'Post this entry?',
      text: 'Post ${entryTypeLabel(_type).toLowerCase()} of $amount to ${provisionRowTitle(widget.provision)} on ${ddMMMyyyy(_date)}? It posts to the books. The server works out the new balance.',
      confirmLabel: 'Post entry',
      cancelLabel: 'Not now',
      danger: false,
    );
    if (!sure || !mounted) return;
    await widget.session.api.postJson(
      '/api/provisions/${docText(widget.provision['id'])}/entries',
      provisionEntryBody(financialYear: widget.fy.longCode, date: _date, type: _type, amountText: _amount.text, narration: _narration.text, counterAccountId: _counterId),
    );
    if (mounted) Navigator.of(context).pop('${entryTypeLabel(_type)} of $amount posted');
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Add provision entry',
      saveLabel: 'Post entry',
      onSave: _save,
      dirty: _amount.text.isNotEmpty || _narration.text.isNotEmpty,
      children: [
        Text('${provisionRowTitle(widget.provision)} · ${widget.fy.longCode}', style: AppText.body.copyWith(color: AppColors.ink2)),
        KPickField<String>(label: 'Entry type', value: _type, options: kEntryTypes, onChanged: (v) => setState(() => _type = v)),
        KDateField(label: 'Date', value: _date, onChanged: (d) => setState(() => _date = dateOnly(d))),
        FieldGroup(children: [
          KAmountField(label: 'Amount', controller: _amount),
          if (_type == 'utilization')
            KAsyncPickField(
              label: 'Settled against (account)',
              valueLabel: _counterId.isEmpty ? null : _counterLabel,
              search: (q) => searchAccounts(widget.session.api, q),
              onPicked: (id, label) => setState(() {
                _counterId = id;
                _counterLabel = label;
              }),
            ),
        ]),
        KTextField(label: 'Narration', controller: _narration),
        if (_problem != null) Text(_problem!, style: AppText.body.copyWith(color: AppColors.negative)),
      ],
    );
  }
}
