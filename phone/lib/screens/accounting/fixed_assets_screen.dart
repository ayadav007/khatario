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

/// `app/(app)/fixed-assets/page.tsx`: the asset register (add, depreciate, dispose) and the Income-tax
/// block depreciation. `GET /api/fixed-assets` answers `assets`. Cost, accumulated depreciation, book value
/// and every depreciation figure are the server's; the phone shows them and never works one out.
class FixedAssetsScreen extends StatefulWidget {
  const FixedAssetsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<FixedAssetsScreen> createState() => _FixedAssetsScreenState();
}

enum _AssetsTab { register, tax }

class _FixedAssetsScreenState extends State<FixedAssetsScreen> {
  _AssetsTab _tab = _AssetsTab.register;
  List<Map<String, dynamic>> _assets = const [];
  bool _loading = true;
  LoadProblem? _problem;
  int _seq = 0;

  FinancialYear _fy = FinancialYear.of(DateTime.now());
  List<Map<String, dynamic>> _taxRows = const [];
  int _unclassified = 0;
  bool _taxLoading = false;
  LoadProblem? _taxProblem;
  int _taxSeq = 0;

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
      final body = await widget.session.api.getData('/api/fixed-assets');
      if (!mounted || seq != _seq) return;
      setState(() {
        _assets = docRows(body, 'assets');
        _loading = false;
        _problem = null;
      });
    } catch (e) {
      if (!mounted || seq != _seq) return;
      final problem = loadProblemOf(e);
      if (!spinner && _assets.isNotEmpty) return showKToast(context, problem.message, tone: KTone.negative);
      setState(() {
        _problem = problem;
        _loading = false;
      });
    }
  }

  Future<void> _loadTax() async {
    final seq = ++_taxSeq;
    setState(() {
      _taxLoading = true;
      _taxProblem = null;
    });
    try {
      final body = await widget.session.api.getData('/api/fixed-assets/it-depreciation?fy=${_fy.code}');
      if (!mounted || seq != _taxSeq) return;
      setState(() {
        _taxRows = docRows(body, 'rows');
        _unclassified = body is Map ? (docNum(body['unclassified'])?.toInt() ?? 0) : 0;
        _taxLoading = false;
      });
    } catch (e) {
      if (!mounted || seq != _taxSeq) return;
      setState(() {
        _taxProblem = loadProblemOf(e);
        _taxLoading = false;
      });
    }
  }

  void _setTab(_AssetsTab tab) {
    if (tab == _tab) return;
    setState(() => _tab = tab);
    if (tab == _AssetsTab.tax && _taxRows.isEmpty && !_taxLoading) _loadTax();
  }

  Future<void> _add() async {
    final message = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => AssetFormScreen(session: widget.session)));
    if (message == null || !mounted) return;
    showKToast(context, message, tone: KTone.positive);
    _load(spinner: false);
  }

  Future<void> _open(Map<String, dynamic> a) async {
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => AssetDetailScreen(session: widget.session, assetId: docText(a['id']))));
    if (changed == true && mounted) _load(spinner: false);
  }

  @override
  Widget build(BuildContext context) {
    final register = _tab == _AssetsTab.register;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Stack(
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const KBackBar('Fixed assets'),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
                  child: KSegmented<_AssetsTab>(
                    value: _tab,
                    options: const [(_AssetsTab.register, 'Asset register'), (_AssetsTab.tax, 'Income-tax depreciation')],
                    onChanged: _setTab,
                  ),
                ),
                const SizedBox(height: AppSpace.sm),
                Expanded(child: register ? _registerBody() : _taxBody()),
              ],
            ),
            if (register && !_loading && _problem == null) Positioned(right: AppSpace.gutter, bottom: AppSpace.lg, child: KFab(label: 'Add asset', onTap: _add)),
          ],
        ),
      ),
    );
  }

  Widget _registerBody() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    final problem = _problem;
    if (problem != null) return LoadProblemView(problem: problem, what: 'fixed assets', onRetry: _load);
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: () => _load(spinner: false),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: 112),
        children: [
          if (_assets.isEmpty)
            const KEmptyState(icon: LucideIcons.building2, title: 'No fixed assets yet', body: 'Capitalise an asset to start its depreciation.')
          else
            KCard(
              margin: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
              child: KDivided(children: [for (final a in _assets) _row(a)]),
            ),
        ],
      ),
    );
  }

  Widget _row(Map<String, dynamic> a) {
    final disposed = !assetCanAct(a);
    final when = assetDepreciatedTo(a);
    final note = disposed ? when : (when == 'Not yet' ? 'Not yet depreciated' : 'Depreciated to $when');
    return KListRow(
      title: assetRowTitle(a),
      subtitle: assetRowSubtitle(a),
      leading: const KAvatar(name: '', icon: LucideIcons.building2, muted: true),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(assetsMoney(docNum(a['current_book_value']) ?? 0), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
          Text(note, style: AppText.caption),
        ],
      ),
      onTap: () => _open(a),
    );
  }

  Widget _taxBody() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FinancialYearBar(period: _fy, onChanged: (v) {
          setState(() => _fy = v);
          _loadTax();
        }),
        Expanded(
          child: _taxLoading
              ? const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
              : _taxProblem != null
                  ? LoadProblemView(problem: _taxProblem!, what: 'Income-tax depreciation', onRetry: _loadTax)
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.xl),
                      children: [
                        Text(
                          'Section 32 block WDV. Assets put to use for fewer than 180 days in their first year get half the rate. Sale proceeds reduce the block; an excess over the block is a short-term capital gain under section 50. Additional depreciation under section 32(1)(iia) is not included.',
                          style: AppText.caption,
                        ),
                        if (_unclassified > 0) ...[
                          const SizedBox(height: AppSpace.md),
                          Text('$_unclassified asset(s) have no Income-tax block and are excluded.', style: AppText.body.copyWith(color: AppColors.due)),
                        ],
                        const SizedBox(height: AppSpace.md),
                        if (_taxRows.isEmpty)
                          const KEmptyState(icon: LucideIcons.fileSpreadsheet, title: 'No classified assets for this year')
                        else
                          for (final r in _taxRows) ...[_taxCard(r), const SizedBox(height: AppSpace.md)],
                      ],
                    ),
        ),
      ],
    );
  }

  Widget _taxCard(Map<String, dynamic> r) {
    String money(String key) => assetsMoney(docNum(r[key]) ?? 0);
    final gain = docNum(r['shortTermCapitalGain']) ?? 0;
    final rate = docNum(r['rate']);
    return KInfoCard(
      title: docText(r['label']),
      rows: [
        ('Rate', rate == null ? '' : '${jsNumberString(rate)}%'),
        ('Opening WDV', money('openingWdv')),
        ('Additions (180+ days)', money('additionsFullRate')),
        ('Additions (<180 days)', money('additionsHalfRate')),
        ('Sales', money('sales')),
        ('Depreciation', money('depreciation')),
        ('Closing WDV', money('closingWdv')),
        ('STCG / (STCL)', gain == 0 ? '-' : (gain > 0 ? assetsMoney(gain) : '(${assetsMoney(-gain)})')),
      ],
    );
  }
}

/// Loads the two account lists the website's forms use: `GET /api/accounts?account_type=asset|expense`.
/// The shared account search cannot filter by type, and posting the cost to the wrong kind of account would
/// misstate the books.
Future<({dynamic assets, dynamic expenses})> _loadAssetAccounts(KhatarioApi api, {bool expenses = true}) async {
  final assets = await api.getData('/api/accounts?account_type=asset&is_active=true&limit=500');
  final exp = expenses ? await api.getData('/api/accounts?account_type=expense&is_active=true&limit=500') : null;
  return (assets: assets, expenses: exp);
}

/// One asset: the details, the server's depreciation schedule for it, and Depreciate and Dispose while it is
/// not disposed. `GET /api/fixed-assets` has no single-asset route, so this picks the asset out of the list
/// and reads `GET /api/fixed-assets/depreciation-schedule?asset_id=`. Pops `true` when an action changed it.
class AssetDetailScreen extends StatefulWidget {
  const AssetDetailScreen({super.key, required this.session, required this.assetId});

  final AppSession session;
  final String assetId;

  @override
  State<AssetDetailScreen> createState() => _AssetDetailScreenState();
}

class _AssetDetailScreenState extends State<AssetDetailScreen> {
  Map<String, dynamic>? _asset;
  List<Map<String, dynamic>> _schedule = const [];
  bool _loading = true;
  bool _changed = false;
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
      final list = await api.getData('/api/fixed-assets');
      Map<String, dynamic>? found;
      for (final a in docRows(list, 'assets')) {
        if (docText(a['id']) == widget.assetId) found = a;
      }
      if (found == null) throw ApiException('Asset not found');
      final schedule = await api.getData('/api/fixed-assets/depreciation-schedule?asset_id=${widget.assetId}');
      if (!mounted || seq != _seq) return;
      setState(() {
        _asset = found;
        _schedule = docRows(schedule, 'schedule');
        _loading = false;
        _problem = null;
      });
    } catch (e) {
      if (!mounted || seq != _seq) return;
      final problem = loadProblemOf(e);
      if (!spinner && _asset != null) return showKToast(context, problem.message, tone: KTone.negative);
      setState(() {
        _problem = problem;
        _loading = false;
      });
    }
  }

  Future<void> _act({required bool dispose}) async {
    final asset = _asset;
    if (asset == null) return;
    final message = await Navigator.of(context).push<String>(MaterialPageRoute(
      builder: (_) => dispose ? AssetDisposeScreen(session: widget.session, asset: asset) : AssetDepreciateScreen(session: widget.session, asset: asset),
    ));
    if (message == null || !mounted) return;
    _changed = true;
    showKToast(context, message, tone: KTone.positive);
    _load(spinner: false);
  }

  @override
  Widget build(BuildContext context) {
    final a = _asset;
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
              KBackBar(a == null ? 'Fixed asset' : assetRowTitle(a)),
              Expanded(child: _body(a)),
              if (a != null && assetCanAct(a))
                KBottomBar(children: [
                  Expanded(child: KButton.secondary(label: 'Dispose', icon: LucideIcons.trash2, onPressed: () => _act(dispose: true))),
                  Expanded(child: KButton(label: 'Depreciate', icon: LucideIcons.trendingDown, onPressed: () => _act(dispose: false))),
                ]),
            ],
          ),
        ),
      ),
    );
  }

  Widget _body(Map<String, dynamic>? a) {
    if (a == null) {
      if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
      return LoadProblemView(problem: _problem ?? const LoadProblem('Could not reach the server.'), what: 'the asset', onRetry: _load);
    }
    String money(String key) {
      final n = docNum(a[key]);
      return n == null ? '' : assetsMoney(n);
    }

    String day(String key) {
      final d = docDate(a[key]);
      return d == null ? '' : ddMMMyyyy(d);
    }

    final block = docText(a['it_block']);
    final category = docText(a['schedule_ii_category']);
    final disposed = !assetCanAct(a);
    final accountCode = docText(a['asset_account_code']);
    final depCode = docText(a['depreciation_account_code']);
    final facts = <(String, String)>[
      ('Code', docText(a['asset_code'])),
      ('Put to use', day('put_to_use_on')),
      ('Method', assetMethodLabel(a)),
      ('Cost', money('purchase_cost')),
      if ((docNum(a['residual_value']) ?? 0) > 0) ('Residual value', money('residual_value')),
      ('Accumulated depreciation', money('accumulated_depreciation')),
      ('Depreciated to', assetDepreciatedTo(a)),
      if (category.isNotEmpty) ('Schedule II category', scheduleIiLabel(category)),
      if (block.isNotEmpty) ('Income-tax block', itBlockLabel(block)),
      if (accountCode.isNotEmpty) ('Asset account', '$accountCode · ${docText(a['asset_account_name'])}'),
      if (depCode.isNotEmpty) ('Depreciation account', '$depCode · ${docText(a['depreciation_account_name'])}'),
      ('Vendor', docText(a['vendor_name'])),
      ('Invoice number', docText(a['invoice_number'])),
      if (disposed) ('Sale proceeds', money('disposal_amount')),
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
                Row(children: [
                  Expanded(child: Text('Book value', style: AppText.caption)),
                  if (disposed) const KPill(label: 'Disposed', tone: KTone.neutral),
                ]),
                const SizedBox(height: AppSpace.xs),
                KAmount(docNum(a['current_book_value']) ?? 0, maxFraction: 2),
              ],
            ),
          ),
          const SizedBox(height: AppSpace.lg),
          KInfoCard(title: 'Details', rows: [for (final f in facts) if (f.$2.trim().isNotEmpty) f]),
          const SizedBox(height: AppSpace.lg),
          const KSectionHeader('Depreciation schedule'),
          if (_schedule.isEmpty)
            KCard(padding: const EdgeInsets.all(AppSpace.lg), child: Text('No depreciation posted yet.', style: AppText.body.copyWith(color: AppColors.ink2)))
          else
            KCard(
              child: KDivided(children: [
                for (final r in _schedule)
                  KListRow(
                    title: scheduleRowTitle(r),
                    subtitle: scheduleRowSubtitle(r),
                    trailing: Text(assetsMoney(docNum(r['depreciation_amount']) ?? 0), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
                  ),
              ]),
            ),
        ],
      ),
    );
  }
}

/// Post depreciation up to a date (`POST /api/fixed-assets/[id]/depreciate`). The route has no preview, so
/// the question names the asset, its book value from the server and the date; the amount is worked out and
/// posted by the server and shown in the toast it returns. Pops the toast text on success.
class AssetDepreciateScreen extends StatefulWidget {
  const AssetDepreciateScreen({super.key, required this.session, required this.asset});

  final AppSession session;
  final Map<String, dynamic> asset;

  @override
  State<AssetDepreciateScreen> createState() => _AssetDepreciateScreenState();
}

class _AssetDepreciateScreenState extends State<AssetDepreciateScreen> {
  DateTime _date = dateOnly(DateTime.now());

  String get _label => '${assetRowTitle(widget.asset)} (${docText(widget.asset['asset_code'])})';

  Future<void> _save() async {
    final book = assetsMoney(docNum(widget.asset['current_book_value']) ?? 0);
    final sure = await askSheet(
      context,
      title: 'Post depreciation?',
      text: 'Post depreciation on $_label up to ${ddMMMyyyy(_date)}? Its book value is $book now. The server works out the amount and posts it to the books.',
      confirmLabel: 'Post depreciation',
      cancelLabel: 'Not now',
      danger: false,
    );
    if (!sure || !mounted) return;
    final reply = await widget.session.api.postJson('/api/fixed-assets/${docText(widget.asset['id'])}/depreciate', depreciateBody(_date));
    if (mounted) Navigator.of(context).pop(depreciationDoneMessage(reply));
  }

  @override
  Widget build(BuildContext context) {
    final last = docDate(widget.asset['last_depreciated_to']);
    final start = docDate(widget.asset['put_to_use_on']);
    final from = last != null ? 'the day after ${ddMMMyyyy(last)}' : 'the put-to-use date${start == null ? '' : ' (${ddMMMyyyy(start)})'}';
    return KFormScaffold(
      title: 'Depreciate asset',
      saveLabel: 'Post depreciation',
      onSave: _save,
      dirty: false,
      children: [
        Text('$_label · book value ${assetsMoney(docNum(widget.asset['current_book_value']) ?? 0)}', style: AppText.body.copyWith(color: AppColors.ink2)),
        Text('Depreciation runs from $from to the date below, pro rata by days. One run cannot cross 31 March.', style: AppText.caption),
        KDateField(label: 'Depreciate up to', value: _date, onChanged: (d) => setState(() => _date = dateOnly(d))),
      ],
    );
  }
}

/// Dispose of an asset (`POST /api/fixed-assets/[id]/dispose`). Asks first with the asset, its book value
/// from the server and the proceeds typed; the server posts the entry and works out the profit or loss,
/// which the toast shows. Pops the toast text on success.
class AssetDisposeScreen extends StatefulWidget {
  const AssetDisposeScreen({super.key, required this.session, required this.asset});

  final AppSession session;
  final Map<String, dynamic> asset;

  @override
  State<AssetDisposeScreen> createState() => _AssetDisposeScreenState();
}

class _AssetDisposeScreenState extends State<AssetDisposeScreen> {
  final _amount = TextEditingController();
  final _buyer = TextEditingController();
  final _reason = TextEditingController();
  DateTime _date = dateOnly(DateTime.now());
  String _accountId = '';
  bool _charge = true;
  List<Map<String, dynamic>> _accounts = const [];

  @override
  void initState() {
    super.initState();
    for (final c in [_amount, _buyer, _reason]) {
      c.addListener(_refresh);
    }
    _loadAccounts();
  }

  @override
  void dispose() {
    _amount.dispose();
    _buyer.dispose();
    _reason.dispose();
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  /// A failing list only leaves the server's default (bank) as the one choice.
  Future<void> _loadAccounts() async {
    try {
      final r = await _loadAssetAccounts(widget.session.api, expenses: false);
      if (mounted) setState(() => _accounts = proceedsAccounts(r.assets));
    } catch (_) {}
  }

  num get _proceeds => docNum(_amount.text.replaceAll(',', '').trim()) ?? 0;

  Future<void> _save() async {
    final problem = disposeProblem(_amount.text);
    if (problem != null) throw ApiException(problem);
    final name = '${assetRowTitle(widget.asset)} (${docText(widget.asset['asset_code'])})';
    final book = assetsMoney(docNum(widget.asset['current_book_value']) ?? 0);
    final sale = _proceeds > 0 ? 'for ${assetsMoney(_proceeds)} sale proceeds' : 'with no sale proceeds (scrapped)';
    final upTo = _charge ? ' Depreciation up to ${ddMMMyyyy(_date)} is posted first.' : '';
    final sure = await askSheet(
      context,
      title: 'Dispose of this asset?',
      text: 'Dispose of $name on ${ddMMMyyyy(_date)} $sale? Its book value is $book now.$upTo The server posts the disposal to the books and works out the profit or loss. This cannot be undone.',
      confirmLabel: 'Dispose asset',
      cancelLabel: 'Keep it',
    );
    if (!sure || !mounted) return;
    final reply = await widget.session.api.postJson(
      '/api/fixed-assets/${docText(widget.asset['id'])}/dispose',
      disposeBody(date: _date, amountText: _amount.text, proceedsAccountId: _proceeds > 0 ? _accountId : '', buyer: _buyer.text, reason: _reason.text, chargeDepreciation: _charge),
    );
    if (mounted) Navigator.of(context).pop(disposalDoneMessage(reply));
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Dispose of asset',
      saveLabel: 'Dispose asset',
      onSave: _save,
      dirty: _amount.text.isNotEmpty || _buyer.text.isNotEmpty || _reason.text.isNotEmpty,
      children: [
        Text('${assetRowTitle(widget.asset)} · book value ${assetsMoney(docNum(widget.asset['current_book_value']) ?? 0)}', style: AppText.body.copyWith(color: AppColors.ink2)),
        KDateField(label: 'Disposal date', value: _date, onChanged: (d) => setState(() => _date = dateOnly(d))),
        FieldGroup(children: [
          KAmountField(label: 'Sale proceeds excluding GST (0 if scrapped)', controller: _amount),
          if (_proceeds > 0)
            KPickField<String>(
              label: 'Proceeds received in',
              value: _accountId,
              options: [('', 'Bank (1102)'), for (final a in _accounts) (docText(a['id']), accountOptionLabel(a))],
              onChanged: (v) => setState(() => _accountId = v),
            ),
        ]),
        KTextField(label: 'Buyer', controller: _buyer),
        KTextField(label: 'Reason', controller: _reason),
        KToggleField(label: 'Charge depreciation up to the disposal date first', value: _charge, onChanged: (v) => setState(() => _charge = v)),
        Text('If GST applies to the sale, raise a tax invoice for the output tax (section 18(6) where ITC was claimed).', style: AppText.caption),
      ],
    );
  }
}

/// Capitalise an asset (`POST /api/fixed-assets`): the website's add form. Picking a Schedule II category
/// fills the useful life as the website does. The asset and depreciation expense accounts come from the same
/// two account lists the website loads, preselecting 1201 and 5204. Pops the toast text on success.
class AssetFormScreen extends StatefulWidget {
  const AssetFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<AssetFormScreen> createState() => _AssetFormScreenState();
}

class _AssetFormScreenState extends State<AssetFormScreen> {
  final _code = TextEditingController();
  final _name = TextEditingController();
  final _cost = TextEditingController();
  final _life = TextEditingController();
  final _residual = TextEditingController();
  final _rate = TextEditingController();
  final _vendor = TextEditingController();
  final _invoice = TextEditingController();
  DateTime _purchase = dateOnly(DateTime.now());
  DateTime _putToUse = dateOnly(DateTime.now());
  String _category = '';
  String _itBlock = '';
  String _method = 'SLM';
  String _accountId = '';
  String _depAccountId = '';
  String _funding = 'bank';
  List<Map<String, dynamic>> _assetAccounts = const [];
  List<Map<String, dynamic>> _expenseAccounts = const [];
  bool _loading = true;
  LoadProblem? _problem;
  String? _formProblem;

  List<TextEditingController> get _controllers => [_code, _name, _cost, _life, _residual, _rate, _vendor, _invoice];

  @override
  void initState() {
    super.initState();
    for (final c in _controllers) {
      c.addListener(_refresh);
    }
    _loadAccounts();
  }

  @override
  void dispose() {
    for (final c in _controllers) {
      c.dispose();
    }
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  Future<void> _loadAccounts() async {
    setState(() {
      _loading = true;
      _problem = null;
    });
    try {
      final r = await _loadAssetAccounts(widget.session.api);
      if (!mounted) return;
      setState(() {
        _assetAccounts = fixedAssetAccounts(r.assets);
        _expenseAccounts = expenseAccounts(r.expenses);
        if (_accountId.isEmpty) _accountId = accountDefaultId(_assetAccounts, '1201');
        if (_depAccountId.isEmpty) _depAccountId = accountDefaultId(_expenseAccounts, '5204');
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _problem = loadProblemOf(e);
        _loading = false;
      });
    }
  }

  Future<void> _save() async {
    final problem = fixedAssetProblem(
      code: _code.text,
      name: _name.text,
      costText: _cost.text,
      lifeText: _life.text,
      residualText: _residual.text,
      purchaseDate: _purchase,
      putToUseDate: _putToUse,
      accountId: _accountId,
      depreciationAccountId: _depAccountId,
    );
    setState(() => _formProblem = problem);
    if (problem != null) return;
    final reply = await widget.session.api.postJson(
      '/api/fixed-assets',
      fixedAssetBody(
        code: _code.text,
        name: _name.text,
        scheduleIiCategory: _category,
        itBlock: _itBlock,
        purchaseDate: _purchase,
        putToUseDate: _putToUse,
        costText: _cost.text,
        residualText: _residual.text,
        method: _method,
        lifeText: _life.text,
        rateText: _rate.text,
        accountId: _accountId,
        depreciationAccountId: _depAccountId,
        funding: _funding,
        vendor: _vendor.text,
        invoiceNumber: _invoice.text,
      ),
    );
    final asset = reply['asset'];
    final code = asset is Map ? docText(asset['asset_code']) : _code.text.trim();
    if (mounted) Navigator.of(context).pop('Asset $code capitalised');
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || _problem != null) {
      return KFormScaffold(
        title: 'Add fixed asset',
        saveLabel: 'Capitalise asset',
        onSave: _save,
        canSave: false,
        children: [
          if (_loading)
            const KSpinner()
          else
            KEmptyState(
              icon: LucideIcons.cloudOff,
              title: 'Could not load the accounts',
              body: _problem!.message,
              action: KButton.secondary(label: 'Try again', expand: false, onPressed: _loadAccounts),
            ),
        ],
      );
    }
    return KFormScaffold(
      title: 'Add fixed asset',
      saveLabel: 'Capitalise asset',
      onSave: _save,
      dirty: _controllers.any((c) => c.text.isNotEmpty),
      children: [
        KTextField(label: 'Asset code', controller: _code),
        KTextField(label: 'Asset name', controller: _name),
        KPickField<String>(
          label: 'Schedule II category',
          value: _category,
          searchable: true,
          options: [('', 'Select category'), for (final c in kScheduleIi) (c.$1, scheduleIiOptionLabel(c))],
          onChanged: (v) => setState(() {
            _category = v;
            final years = scheduleIiYears(v);
            if (years != null) _life.text = '$years';
          }),
        ),
        KDateField(
          label: 'Purchase date',
          value: _purchase,
          onChanged: (d) => setState(() {
            _purchase = dateOnly(d);
            if (_putToUse.isBefore(_purchase)) _putToUse = _purchase;
          }),
        ),
        KDateField(label: 'Put to use on', value: _putToUse, first: _purchase, onChanged: (d) => setState(() => _putToUse = dateOnly(d))),
        KAmountField(label: 'Cost (excl. GST where ITC is claimed)', controller: _cost),
        KPickField<String>(
          label: 'Book method',
          value: _method,
          options: const [('SLM', 'Straight line (SLM)'), ('WDV', 'Written down value (WDV)')],
          onChanged: (v) => setState(() => _method = v),
        ),
        KTextField(label: 'Useful life (years)', controller: _life, keyboard: TextInputType.number),
        FieldGroup(children: [
          KAmountField(label: 'Residual value (default 0)', controller: _residual),
          if (_method == 'WDV') KAmountField(label: 'WDV rate % (blank = derived from life)', controller: _rate),
        ]),
        KPickField<String>(
          label: 'Income-tax block',
          value: _itBlock,
          searchable: true,
          options: [('', 'Not classified'), for (final b in kItBlocks) (b.$1, itBlockOptionLabel(b))],
          onChanged: (v) => setState(() => _itBlock = v),
        ),
        KPickField<String>(
          label: 'Asset account',
          value: _accountId.isEmpty ? null : _accountId,
          searchable: _assetAccounts.length > 8,
          options: [for (final a in _assetAccounts) (docText(a['id']), accountOptionLabel(a))],
          onChanged: (v) => setState(() => _accountId = v),
        ),
        KPickField<String>(
          label: 'Depreciation expense account',
          value: _depAccountId.isEmpty ? null : _depAccountId,
          searchable: true,
          options: [for (final a in _expenseAccounts) (docText(a['id']), accountOptionLabel(a))],
          onChanged: (v) => setState(() => _depAccountId = v),
        ),
        KPickField<String>(label: 'Paid from', value: _funding, options: kAssetFunding, onChanged: (v) => setState(() => _funding = v)),
        KTextField(label: 'Vendor', controller: _vendor),
        KTextField(label: 'Invoice number', controller: _invoice),
        if (_formProblem != null) Text(_formProblem!, style: AppText.body.copyWith(color: AppColors.negative)),
      ],
    );
  }
}
