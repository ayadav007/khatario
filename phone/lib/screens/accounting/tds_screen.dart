import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:printing/printing.dart';

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
import 'account_ledger_screen.dart' show PdfOpener;
import 'assets_tds_logic.dart';
import 'assets_tds_widgets.dart';

enum TdsTab { transactions, payments, certificates, categories }

/// `app/(app)/tds` and its four sub-pages on one screen: Transactions, Payments, Certificates and
/// Categories. Plan-gated (`accounting_tds`). Years and quarters are filters (`financial_year=2026-2027`, the
/// long form the server stores, and `quarter=Q3`). The tiles are `GET /api/tds/reports/summary`, which answers
/// one year-and-quarter row at a time, so they show only while a quarter is chosen. Every TDS amount and total
/// is the server's.
///
/// [openPdf] shows a certificate's PDF; it is replaceable so a test can see the bytes.
class TdsScreen extends StatefulWidget {
  const TdsScreen({super.key, required this.session, this.initialTab = TdsTab.transactions, this.openPdf});

  final AppSession session;
  final TdsTab initialTab;
  final PdfOpener? openPdf;

  @override
  State<TdsScreen> createState() => _TdsScreenState();
}

class _TdsScreenState extends State<TdsScreen> {
  late TdsTab _tab = widget.initialTab;
  FinancialYear _fy = FinancialYear.of(DateTime.now());
  String _quarter = tdsQuarterOf(DateTime.now());
  bool? _deposited;
  List<Map<String, dynamic>> _rows = const [];
  List<(String, String)> _tiles = const [];
  bool _loading = true;
  LoadProblem? _problem;
  bool _busy = false;
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  (String path, String key) get _source => switch (_tab) {
        TdsTab.transactions => (tdsListPath('/api/tds/transactions', fy: _fy.longCode, quarter: _quarter, deposited: _deposited), 'transactions'),
        TdsTab.payments => (tdsListPath('/api/tds/payments', fy: _fy.longCode, quarter: _quarter, deposited: null), 'payments'),
        TdsTab.certificates => (tdsListPath('/api/tds/certificates', fy: _fy.longCode, quarter: _quarter, deposited: null), 'certificates'),
        TdsTab.categories => ('/api/tds/categories', 'categories'),
      };

  String get _what => switch (_tab) {
        TdsTab.transactions => 'TDS transactions',
        TdsTab.payments => 'TDS payments',
        TdsTab.certificates => 'TDS certificates',
        TdsTab.categories => 'TDS categories',
      };

  Future<void> _load({bool spinner = true}) async {
    final seq = ++_seq;
    if (spinner) {
      setState(() {
        _loading = true;
        _problem = null;
      });
    }
    final api = widget.session.api;
    final (path, key) = _source;
    final wantsTiles = _tab != TdsTab.categories && _quarter.isNotEmpty;
    // The tiles only decorate the list: if the summary fails the list still shows.
    final summary = wantsTiles ? api.getData(tdsSummaryPath(_fy.longCode, _quarter)).then<dynamic>((b) => b, onError: (_) => null) : Future<dynamic>.value(null);
    try {
      final body = await api.getData(path);
      final s = await summary;
      if (!mounted || seq != _seq) return;
      setState(() {
        _rows = docRows(body, key);
        _tiles = tdsSummaryTiles(s);
        _loading = false;
        _problem = null;
      });
    } catch (e) {
      if (!mounted || seq != _seq) return;
      final problem = loadProblemOf(e);
      if (!spinner && _rows.isNotEmpty) return showKToast(context, problem.message, tone: KTone.negative);
      setState(() {
        _problem = problem;
        _loading = false;
      });
    }
  }

  void _change(VoidCallback f) {
    setState(() {
      f();
      _rows = const [];
      _tiles = const [];
    });
    _load();
  }

  Future<void> _push(Widget screen) async {
    final message = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => screen));
    if (message == null || !mounted) return;
    showKToast(context, message, tone: KTone.positive);
    _load(spinner: false);
  }

  String get _defaultQuarter => _quarter.isEmpty ? tdsQuarterOf(DateTime.now()) : _quarter;

  Future<void> _openCertificate(Map<String, dynamic> c) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final bytes = await widget.session.api.getBytes(tdsCertificatePdfPath(docText(c['id'])));
      if (!mounted) return;
      await (widget.openPdf ?? _openPdfViewer)(context, bytes, tdsCertificateTitle(c));
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not open the certificate. Try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _categoryActions(Map<String, dynamic> c) async {
    final choice = await showKSheet<String>(
      context,
      title: tdsCategoryTitle(c),
      builder: (ctx) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KSheetAction(icon: LucideIcons.pencil, label: 'Edit category', onTap: () => Navigator.of(ctx).pop('edit')),
          KSheetAction(icon: LucideIcons.trash2, label: 'Delete category', danger: true, onTap: () => Navigator.of(ctx).pop('delete')),
        ],
      ),
    );
    if (choice == null || !mounted) return;
    if (choice == 'edit') return _push(TdsCategoryFormScreen(session: widget.session, category: c));
    await _deleteCategory(c);
  }

  /// The server refuses a category that transactions use; its message is shown as sent.
  Future<void> _deleteCategory(Map<String, dynamic> c) async {
    if (_busy) return;
    final sure = await askSheet(
      context,
      title: 'Delete this category?',
      text: 'Delete ${tdsCategoryTitle(c)}? You cannot delete a category that TDS transactions use.',
      confirmLabel: 'Delete category',
      cancelLabel: 'Keep it',
    );
    if (!sure || !mounted) return;
    setState(() => _busy = true);
    try {
      await widget.session.api.deleteJson('/api/tds/categories/${docText(c['id'])}');
      if (!mounted) return;
      showKToast(context, 'Category deleted successfully', tone: KTone.positive);
      _load(spinner: false);
    } catch (e) {
      if (mounted) showKToast(context, actionProblemOf(e), tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  ({String label, VoidCallback onTap})? get _fab => switch (_tab) {
        TdsTab.transactions => null,
        TdsTab.payments => (label: 'Record payment', onTap: () => _push(TdsPaymentFormScreen(session: widget.session, financialYear: _fy.longCode, quarter: _defaultQuarter))),
        TdsTab.certificates => (label: 'Generate certificate', onTap: () => _push(TdsCertificateFormScreen(session: widget.session, financialYear: _fy.longCode, quarter: _defaultQuarter))),
        TdsTab.categories => (label: 'Add category', onTap: () => _push(TdsCategoryFormScreen(session: widget.session))),
      };

  @override
  Widget build(BuildContext context) {
    final fab = _fab;
    final filtered = _tab != TdsTab.categories;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Stack(
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const KBackBar('TDS / TCS'),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
                  child: KSegmented<TdsTab>(
                    value: _tab,
                    options: const [
                      (TdsTab.transactions, 'Transactions'),
                      (TdsTab.payments, 'Payments'),
                      (TdsTab.certificates, 'Certificates'),
                      (TdsTab.categories, 'Categories'),
                    ],
                    onChanged: (t) {
                      if (t != _tab) _change(() => _tab = t);
                    },
                  ),
                ),
                if (filtered) ...[
                  const SizedBox(height: AppSpace.sm),
                  FinancialYearBar(period: _fy, onChanged: (v) => _change(() => _fy = v)),
                  KChipBar<String>(
                    value: _quarter,
                    options: [('', 'All quarters'), for (final q in kTdsQuarters) (q, q)],
                    onChanged: (v) => _change(() => _quarter = v),
                  ),
                  if (_tab == TdsTab.transactions) ...[
                    const SizedBox(height: AppSpace.sm),
                    KChipBar<bool?>(
                      value: _deposited,
                      options: const [(null, 'All'), (true, 'Deposited'), (false, 'Pending')],
                      onChanged: (v) => _change(() => _deposited = v),
                    ),
                  ],
                ],
                const SizedBox(height: AppSpace.sm),
                Expanded(child: _body()),
              ],
            ),
            if (fab != null && !_loading && _problem == null) Positioned(right: AppSpace.gutter, bottom: AppSpace.lg, child: KFab(label: fab.label, onTap: fab.onTap)),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    final problem = _problem;
    if (problem != null) return LoadProblemView(problem: problem, what: _what, onRetry: _load);
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: () => _load(spinner: false),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: 112),
        children: [
          if (_tab != TdsTab.categories) _summary(),
          if (_rows.isEmpty) _empty() else KCard(margin: const EdgeInsets.symmetric(horizontal: AppSpace.gutter), child: KDivided(children: [for (final r in _rows) _row(r)])),
        ],
      ),
    );
  }

  Widget _summary() {
    if (_quarter.isEmpty) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.md),
        child: Text('Choose a quarter to see the TDS summary', style: AppText.caption),
      );
    }
    if (_tiles.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.md),
      child: Column(
        children: [
          for (var i = 0; i < _tiles.length; i += 2) ...[
            if (i > 0) const SizedBox(height: AppSpace.md),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: _tile(_tiles[i])),
                const SizedBox(width: AppSpace.md),
                Expanded(child: i + 1 < _tiles.length ? _tile(_tiles[i + 1]) : const SizedBox.shrink()),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _tile((String, String) tile) {
    return KCard(
      padding: const EdgeInsets.all(AppSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(tile.$1, style: AppText.caption, maxLines: 1, overflow: TextOverflow.ellipsis),
          const SizedBox(height: AppSpace.xs),
          Text(tile.$2, style: AppText.amount, maxLines: 1, overflow: TextOverflow.ellipsis),
        ],
      ),
    );
  }

  Widget _empty() => switch (_tab) {
        TdsTab.transactions => const KEmptyState(icon: LucideIcons.receipt, title: 'No TDS transactions found', body: 'TDS transactions will appear here when recorded.'),
        TdsTab.payments => const KEmptyState(icon: LucideIcons.banknote, title: 'No TDS payments recorded', body: 'Record a payment to get started.'),
        TdsTab.certificates => const KEmptyState(icon: LucideIcons.badgeCheck, title: 'No TDS certificates yet', body: 'Generate a Form 16A certificate for a supplier.'),
        TdsTab.categories => const KEmptyState(icon: LucideIcons.fileText, title: 'No TDS categories yet', body: 'Add a section and its rate.'),
      };

  Widget _row(Map<String, dynamic> r) {
    switch (_tab) {
      case TdsTab.transactions:
        final deposited = tdsTransactionDeposited(r);
        return KListRow(
          title: tdsTransactionTitle(r),
          subtitle: tdsTransactionSubtitle(r),
          leading: const KAvatar(name: '', icon: LucideIcons.receipt, muted: true),
          trailing: _amountWithStatus(r['tds_amount'], deposited ? 'Deposited' : 'Pending', deposited ? KTone.positive : KTone.due),
        );
      case TdsTab.payments:
        return KListRow(
          title: tdsPaymentTitle(r),
          subtitle: tdsPaymentSubtitle(r),
          leading: const KAvatar(name: '', icon: LucideIcons.banknote, muted: true),
          trailing: _amountWithStatus(r['total_tds_amount'], null, KTone.positive),
        );
      case TdsTab.certificates:
        final issued = tdsCertificateStatus(r) == 'Issued';
        return KListRow(
          title: tdsCertificateTitle(r),
          subtitle: tdsCertificateSubtitle(r),
          leading: const KAvatar(name: '', icon: LucideIcons.badgeCheck, muted: true),
          trailing: _amountWithStatus(r['total_tds_amount'], tdsCertificateStatus(r), issued ? KTone.positive : KTone.neutral),
          onTap: () => _openCertificate(r),
        );
      case TdsTab.categories:
        return KListRow(
          title: tdsCategoryTitle(r),
          subtitle: tdsCategorySubtitle(r),
          leading: const KAvatar(name: '', icon: LucideIcons.fileText, muted: true),
          onTap: () => _categoryActions(r),
        );
    }
  }

  Widget _amountWithStatus(dynamic amount, String? status, KTone tone) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text(assetsMoney(docNum(amount) ?? 0), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
        if (status != null) KStatusDot(label: status, tone: tone),
      ],
    );
  }
}

Future<void> _openPdfViewer(BuildContext context, List<int> bytes, String title) {
  return Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => _CertificatePdfScreen(bytes: Uint8List.fromList(bytes), title: title)));
}

/// The certificate PDF with print and share, in the same viewer the statement and invoice PDFs use.
class _CertificatePdfScreen extends StatelessWidget {
  const _CertificatePdfScreen({required this.bytes, required this.title});

  final Uint8List bytes;
  final String title;

  @override
  Widget build(BuildContext context) {
    final safe = title.replaceAll(RegExp(r'[^\w.-]+'), '_');
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar('Certificate · $title'),
            Expanded(
              child: PdfPreview(
                build: (_) async => bytes,
                pdfFileName: 'TDS-Certificate-${safe.isEmpty ? 'certificate' : safe}.pdf',
                canChangePageFormat: false,
                canChangeOrientation: false,
                canDebug: false,
                scrollViewDecoration: const BoxDecoration(color: AppColors.bg),
                actionBarTheme: PdfActionBarTheme(backgroundColor: AppColors.brand, iconColor: AppColors.onBrand),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

List<(String, String)> _yearOptions() => [for (final y in tdsYears(DateTime.now())) (y, y)];

const _quarterOptions = <(String, String)>[('Q1', 'Q1 (Apr-Jun)'), ('Q2', 'Q2 (Jul-Sep)'), ('Q3', 'Q3 (Oct-Dec)'), ('Q4', 'Q4 (Jan-Mar)')];

/// Record a TDS payment (`POST /api/tds/payments`). The server saves the challan and marks every pending
/// TDS transaction of that year and quarter as deposited, so the form asks first, naming the amount typed,
/// the challan and the period, and quoting the server's pending figure for that quarter
/// (`GET /api/tds/reports/summary`) when it can be read. Pops the toast text on success.
class TdsPaymentFormScreen extends StatefulWidget {
  const TdsPaymentFormScreen({super.key, required this.session, required this.financialYear, required this.quarter});

  final AppSession session;
  final String financialYear;
  final String quarter;

  @override
  State<TdsPaymentFormScreen> createState() => _TdsPaymentFormScreenState();
}

class _TdsPaymentFormScreenState extends State<TdsPaymentFormScreen> {
  final _challan = TextEditingController();
  final _amount = TextEditingController();
  final _bank = TextEditingController();
  final _mode = TextEditingController();
  final _reference = TextEditingController();
  final _notes = TextEditingController();
  late String _fy = widget.financialYear;
  late String _quarter = widget.quarter;
  DateTime _challanDate = dateOnly(DateTime.now());
  DateTime _depositDate = dateOnly(DateTime.now());
  String? _problem;

  List<TextEditingController> get _controllers => [_challan, _amount, _bank, _mode, _reference, _notes];

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
    if (mounted) setState(() {});
  }

  Future<void> _save() async {
    final problem = tdsPaymentProblem(financialYear: _fy, quarter: _quarter, challan: _challan.text, challanDate: _challanDate, depositDate: _depositDate, amountText: _amount.text);
    setState(() => _problem = problem);
    if (problem != null) return;
    final api = widget.session.api;
    num? pending;
    try {
      final s = await api.getData(tdsSummaryPath(_fy, _quarter));
      final row = s is Map ? s['summary'] : null;
      if (row is Map && row.isNotEmpty) pending = docNum(row['pending_amount']);
    } catch (_) {}
    if (!mounted) return;
    final sure = await askSheet(
      context,
      title: 'Record this TDS payment?',
      text: tdsPaymentAsk(amountText: _amount.text, challan: _challan.text, financialYear: _fy, quarter: _quarter, serverPending: pending),
      confirmLabel: 'Record payment',
      cancelLabel: 'Not now',
      danger: false,
    );
    if (!sure || !mounted) return;
    await api.postJson(
      '/api/tds/payments',
      tdsPaymentBody(
        financialYear: _fy,
        quarter: _quarter,
        challan: _challan.text,
        challanDate: _challanDate,
        depositDate: _depositDate,
        amountText: _amount.text,
        bank: _bank.text,
        mode: _mode.text,
        reference: _reference.text,
        notes: _notes.text,
      ),
    );
    if (mounted) Navigator.of(context).pop('TDS payment recorded successfully');
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Record TDS payment',
      saveLabel: 'Record payment',
      onSave: _save,
      dirty: _controllers.any((c) => c.text.isNotEmpty),
      children: [
        KPickField<String>(label: 'Financial year', value: _fy, options: _yearOptions(), onChanged: (v) => setState(() => _fy = v)),
        KPickField<String>(label: 'Quarter', value: _quarter, options: _quarterOptions, onChanged: (v) => setState(() => _quarter = v)),
        KTextField(label: 'Challan number', controller: _challan, hint: 'e.g. CH123456'),
        KDateField(label: 'Challan date', value: _challanDate, onChanged: (d) => setState(() => _challanDate = dateOnly(d))),
        KDateField(label: 'Deposit date', value: _depositDate, onChanged: (d) => setState(() => _depositDate = dateOnly(d))),
        KAmountField(label: 'Total TDS amount', controller: _amount),
        KTextField(label: 'Bank name', controller: _bank),
        KTextField(label: 'Payment mode', controller: _mode, hint: 'e.g. NEFT, RTGS'),
        KTextField(label: 'Payment reference', controller: _reference),
        KTextField(label: 'Notes', controller: _notes, maxLines: 3, minLines: 2),
        if (_problem != null) Text(_problem!, style: AppText.body.copyWith(color: AppColors.negative)),
      ],
    );
  }
}

/// Generate a Form 16A certificate (`POST /api/tds/certificates`). The server adds up the deposited TDS for
/// the supplier, year and quarter and numbers the certificate; it refuses when there is none or one exists.
/// Pops the toast text on success.
class TdsCertificateFormScreen extends StatefulWidget {
  const TdsCertificateFormScreen({super.key, required this.session, required this.financialYear, required this.quarter});

  final AppSession session;
  final String financialYear;
  final String quarter;

  @override
  State<TdsCertificateFormScreen> createState() => _TdsCertificateFormScreenState();
}

class _TdsCertificateFormScreenState extends State<TdsCertificateFormScreen> {
  late String _fy = widget.financialYear;
  late String _quarter = widget.quarter;
  DateTime _issueDate = dateOnly(DateTime.now());
  String _supplierId = '';
  String _supplierLabel = '';
  String? _problem;

  Future<void> _save() async {
    final problem = tdsCertificateProblem(supplierId: _supplierId, financialYear: _fy, quarter: _quarter);
    setState(() => _problem = problem);
    if (problem != null) return;
    await widget.session.api.postJson(
      '/api/tds/certificates',
      tdsCertificateBody(supplierId: _supplierId, financialYear: _fy, quarter: _quarter, issueDate: _issueDate),
    );
    if (mounted) Navigator.of(context).pop('TDS certificate generated successfully');
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Generate TDS certificate',
      saveLabel: 'Generate certificate',
      onSave: _save,
      dirty: _supplierId.isNotEmpty,
      children: [
        KAsyncPickField(
          label: 'Supplier',
          valueLabel: _supplierId.isEmpty ? null : _supplierLabel,
          search: (q) => searchSuppliers(widget.session.api, q),
          onPicked: (id, label) => setState(() {
            _supplierId = id;
            _supplierLabel = label;
            _problem = null;
          }),
        ),
        KPickField<String>(label: 'Financial year', value: _fy, options: _yearOptions(), onChanged: (v) => setState(() => _fy = v)),
        KPickField<String>(label: 'Quarter', value: _quarter, options: _quarterOptions, onChanged: (v) => setState(() => _quarter = v)),
        KDateField(label: 'Issue date', value: _issueDate, onChanged: (d) => setState(() => _issueDate = dateOnly(d))),
        if (_problem != null) Text(_problem!, style: AppText.body.copyWith(color: AppColors.negative)),
      ],
    );
  }
}

/// Add (`POST /api/tds/categories`) or edit (`PUT /api/tds/categories/[id]`) a TDS section and its rate.
/// Pops the toast text on success.
class TdsCategoryFormScreen extends StatefulWidget {
  const TdsCategoryFormScreen({super.key, required this.session, this.category});

  final AppSession session;
  final Map<String, dynamic>? category;

  @override
  State<TdsCategoryFormScreen> createState() => _TdsCategoryFormScreenState();
}

class _TdsCategoryFormScreenState extends State<TdsCategoryFormScreen> {
  late final _code = TextEditingController(text: docText(widget.category?['section_code']));
  late final _name = TextEditingController(text: docText(widget.category?['section_name']));
  late final _description = TextEditingController(text: docText(widget.category?['description']));
  late final _rate = TextEditingController(text: _number(widget.category?['rate']));
  late final _threshold = TextEditingController(text: _number(widget.category?['threshold_amount']));
  String? _problem;
  bool _dirty = false;

  bool get _editing => widget.category != null;

  static String _number(dynamic v) {
    final n = docNum(v);
    return n == null ? '' : jsNumberString(n);
  }

  List<TextEditingController> get _controllers => [_code, _name, _description, _rate, _threshold];

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
    final problem = tdsCategoryProblem(code: _code.text, name: _name.text, rateText: _rate.text, thresholdText: _threshold.text);
    setState(() => _problem = problem);
    if (problem != null) return;
    final body = tdsCategoryBody(code: _code.text, name: _name.text, description: _description.text, rateText: _rate.text, thresholdText: _threshold.text);
    final api = widget.session.api;
    if (_editing) {
      await api.putJson('/api/tds/categories/${docText(widget.category!['id'])}', body);
    } else {
      await api.postJson('/api/tds/categories', body);
    }
    if (mounted) Navigator.of(context).pop(_editing ? 'Category updated successfully' : 'Category added successfully');
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: _editing ? 'Edit TDS category' : 'Add TDS category',
      saveLabel: _editing ? 'Save changes' : 'Add category',
      onSave: _save,
      dirty: _dirty,
      children: [
        KTextField(label: 'Section code', controller: _code, hint: 'e.g. 194C'),
        KTextField(label: 'Section name', controller: _name, hint: 'e.g. Payments to contractors'),
        KTextField(label: 'Description', controller: _description, maxLines: 3, minLines: 2),
        KAmountField(label: 'Rate (%)', controller: _rate),
        KAmountField(label: 'Threshold amount', controller: _threshold),
        if (_problem != null) Text(_problem!, style: AppText.body.copyWith(color: AppColors.negative)),
      ],
    );
  }
}
