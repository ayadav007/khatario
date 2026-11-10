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
import '../pages/website_page_screen.dart';
import 'doc_action_sheets.dart';
import 'load_failed_view.dart';
import 'recurring_invoices_logic.dart';

/// Website `/recurring-invoices` (and the older `/invoices/recurring`): invoices raised on a schedule.
///
/// The route has no way to move the next run date, so the phone offers what the website does: Pause, Resume,
/// Draft or Final, Run now, and a new schedule copied from an existing invoice.
class RecurringInvoicesScreen extends StatefulWidget {
  const RecurringInvoicesScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<RecurringInvoicesScreen> createState() => _RecurringInvoicesScreenState();
}

class _RecurringInvoicesScreenState extends State<RecurringInvoicesScreen> {
  List<RecurringInvoice> _rows = const [];
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  final Set<String> _busy = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool quiet = false}) async {
    if (!quiet) {
      setState(() {
        _loading = true;
        _error = null;
        _notInPlan = false;
      });
    }
    try {
      final body = await widget.session.api.getJson('/api/recurring-invoices');
      if (!mounted) return;
      setState(() {
        _rows = recurringInvoices(body['recurringInvoices']);
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (quiet) {
        showKToast(context, e.message, tone: KTone.negative);
        return;
      }
      setState(() {
        _notInPlan = LoadFailedView.isPlanBlock(e);
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      if (quiet) return;
      setState(() { _error = 'Could not reach the server.'; _loading = false; });
    }
  }

  /// Runs one action of one schedule. The row shows its spinner from the moment [job] calls `working`
  /// (after any question), and a second tap while it runs does nothing.
  Future<void> _run(RecurringInvoice r, Future<bool> Function(VoidCallback working) job) async {
    if (_busy.contains(r.id)) return;
    try {
      final changed = await job(() {
        if (_busy.add(r.id) && mounted) setState(() {});
      });
      if (changed && mounted) await _load(quiet: true);
    } finally {
      _busy.remove(r.id);
      if (mounted) setState(() {});
    }
  }

  Future<void> _new() async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => RecurringInvoiceFormScreen(session: widget.session)));
    if (saved == true && mounted) await _load(quiet: true);
  }

  Future<void> _open(RecurringInvoice r) async {
    await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => RecurringInvoiceDetailScreen(session: widget.session, invoice: r)));
    if (mounted) await _load(quiet: true);
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
              'Recurring invoices',
              trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                KIconButton(icon: LucideIcons.plus, tooltip: 'New recurring invoice', onTap: _new),
                KIconButton(
                  icon: LucideIcons.globe,
                  tooltip: 'Open on website',
                  onTap: () => openWebsiteInApp(context, widget.session, '/recurring-invoices', 'Recurring invoices'),
                ),
              ]),
            ),
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
        LoadFailedView(title: 'Could not load recurring invoices', message: _error, notInPlan: _notInPlan, onRetry: _load),
      ]);
    }
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
        children: [
          if (_rows.isEmpty)
            KEmptyState(
              icon: LucideIcons.repeat,
              title: 'No recurring invoices yet',
              body: 'Raise an invoice automatically on a schedule, copied from an existing invoice.',
              action: KButton(label: 'New recurring invoice', expand: false, onPressed: _new),
            )
          else
            for (final r in _rows) ...[
              _card(r),
              const SizedBox(height: AppSpace.md),
            ],
        ],
      ),
    );
  }

  Widget _card(RecurringInvoice r) {
    final busy = _busy.contains(r.id);
    return KCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Only the facts open the detail, so a tap on a busy button cannot fall through to it.
          InkWell(
            onTap: () => _open(r),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(r.customerName, style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
                  Text(r.templateNumber == null ? 'Custom lines' : 'Copies ${r.templateNumber}', style: AppText.caption),
                  Text(recurringSchedule(r), style: AppText.caption),
                  Text(r.isActive ? 'Next run ${recurringNextRun(r)}' : 'Paused', style: AppText.caption),
                  Text('${r.invoicesRaised} raised · ${r.autoFinalize ? 'Finalised automatically' : 'Saved as draft'}', style: AppText.caption),
                  if (r.lastError != null) ...[
                    const SizedBox(height: 4),
                    Text(r.lastError!, style: AppText.caption.copyWith(color: AppColors.negative)),
                  ],
                  const SizedBox(height: 10),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
            child: Row(children: [
              Expanded(
                child: KButton(
                  label: r.isActive ? 'Pause' : 'Resume',
                  height: 40,
                  kind: KButtonKind.secondary,
                  onPressed: busy ? null : () => _run(r, (working) => setRecurringActive(context, widget.session.api, r.id, !r.isActive, onWorking: working)),
                ),
              ),
              const SizedBox(width: AppSpace.sm),
              Expanded(
                child: KButton(
                  label: 'Run now',
                  height: 40,
                  loading: busy,
                  onPressed: busy || !r.isActive ? null : () => _run(r, (working) => runRecurringNow(context, widget.session.api, r, onWorking: working)),
                ),
              ),
            ]),
          ),
        ],
      ),
    );
  }
}

/// A change of one schedule runs at most once at a time.
final _inFlight = <String>{};

/// `PATCH /api/recurring-invoices/[id]` once. True when it changed; a refusal is a toast and false.
Future<bool> _patch(BuildContext context, KhatarioApi api, String id, Map<String, dynamic> body, String done, VoidCallback? onWorking) async {
  if (!_inFlight.add('patch:$id')) return false;
  try {
    onWorking?.call();
    await api.patchJson('/api/recurring-invoices/$id', body);
    if (context.mounted) showKToast(context, done, tone: KTone.positive);
    return true;
  } on ApiException catch (e) {
    if (context.mounted) showKToast(context, e.message, tone: KTone.negative);
    return false;
  } catch (_) {
    if (context.mounted) showKToast(context, 'Update failed', tone: KTone.negative);
    return false;
  } finally {
    _inFlight.remove('patch:$id');
  }
}

/// Pause (`is_active: false`) or Resume (`true`).
Future<bool> setRecurringActive(BuildContext context, KhatarioApi api, String id, bool active, {VoidCallback? onWorking}) =>
    _patch(context, api, id, recurringActiveBody(active), active ? 'Schedule resumed' : 'Schedule paused', onWorking);

/// Draft (`auto_finalize: false`) or Final (`true`).
Future<bool> setRecurringMode(BuildContext context, KhatarioApi api, String id, bool autoFinalize, {VoidCallback? onWorking}) =>
    _patch(context, api, id, recurringModeBody(autoFinalize), autoFinalize ? 'Invoices will be finalised automatically' : 'Invoices will be saved as drafts', onWorking);

/// Asks, then `POST /api/recurring-invoices/[id]` with `{ action: 'run_now' }` once. Raising invoices is a
/// write, so the phone asks first. True when the server answered (invoices raised or nothing due).
Future<bool> runRecurringNow(BuildContext context, KhatarioApi api, RecurringInvoice r, {VoidCallback? onWorking}) async {
  if (!_inFlight.add('run:${r.id}')) return false;
  try {
    final ok = await askSheet(
      context,
      title: 'Raise invoices now?',
      text: 'Anything due today for ${r.customerName} will be raised now. Each period is raised only once.',
      confirmLabel: 'Raise invoices',
      cancelLabel: 'Not now',
      danger: false,
    );
    if (!ok || !context.mounted) return false;
    onWorking?.call();
    final reply = await api.postJson('/api/recurring-invoices/${r.id}', runNowBody());
    if (context.mounted) showKToast(context, runNowMessage(reply), tone: KTone.positive);
    return true;
  } on ApiException catch (e) {
    if (context.mounted) showKToast(context, e.message, tone: KTone.negative);
    return false;
  } catch (_) {
    if (context.mounted) showKToast(context, 'Run failed', tone: KTone.negative);
    return false;
  } finally {
    _inFlight.remove('run:${r.id}');
  }
}

/// One schedule with its run history and the same actions as the list.
class RecurringInvoiceDetailScreen extends StatefulWidget {
  const RecurringInvoiceDetailScreen({super.key, required this.session, required this.invoice});

  final AppSession session;
  final RecurringInvoice invoice;

  @override
  State<RecurringInvoiceDetailScreen> createState() => _RecurringInvoiceDetailScreenState();
}

class _RecurringInvoiceDetailScreenState extends State<RecurringInvoiceDetailScreen> {
  late RecurringInvoice _r = widget.invoice;
  List<RunHistory> _history = const [];
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await widget.session.api.getJson('/api/recurring-invoices/${_r.id}');
      if (!mounted) return;
      setState(() {
        _r = _r.withDetail(body['recurringInvoice']);
        _history = runHistory(body['history']);
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _notInPlan = LoadFailedView.isPlanBlock(e);
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() { _error = 'Could not reach the server.'; _loading = false; });
    }
  }

  Future<void> _do(Future<bool> Function(VoidCallback working) job) async {
    if (_busy) return;
    try {
      final changed = await job(() {
        if (mounted) setState(() => _busy = true);
      });
      if (changed && mounted) await _load();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(_r.customerName),
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
        LoadFailedView(title: 'Could not load this schedule', message: _error, notInPlan: _notInPlan, onRetry: _load),
      ]);
    }
    final r = _r;
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
        children: [
          KInfoCard(title: 'Schedule', rows: [
            ('Copies', r.templateNumber ?? 'Custom lines'),
            ('Repeats', recurringSchedule(r)),
            ('Starts', recurringDate(r.startDate)),
            ('Next run', r.isActive ? recurringNextRun(r) : 'Paused'),
            if (r.lastRunDate != null) ('Last run', recurringDate(r.lastRunDate)),
            ('Raised', '${r.invoicesRaised}'),
            if (r.notes != null) ('Notes', r.notes!),
          ]),
          if (r.lastError != null) ...[
            const SizedBox(height: AppSpace.sm),
            Text(r.lastError!, style: AppText.body.copyWith(color: AppColors.negative)),
          ],
          const SizedBox(height: AppSpace.lg),
          KToggleField(
            label: 'Finalise automatically',
            help: 'Otherwise each invoice is saved as a draft for review',
            value: r.autoFinalize,
            onChanged: (v) => _do((working) => setRecurringMode(context, widget.session.api, r.id, v, onWorking: working)),
          ),
          const SizedBox(height: AppSpace.md),
          Row(children: [
            Expanded(
              child: KButton(
                label: r.isActive ? 'Pause' : 'Resume',
                kind: KButtonKind.secondary,
                onPressed: _busy ? null : () => _do((working) => setRecurringActive(context, widget.session.api, r.id, !r.isActive, onWorking: working)),
              ),
            ),
            const SizedBox(width: AppSpace.sm),
            Expanded(
              child: KButton(
                label: 'Run now',
                loading: _busy,
                onPressed: _busy || !r.isActive ? null : () => _do((working) => runRecurringNow(context, widget.session.api, r, onWorking: working)),
              ),
            ),
          ]),
          const SizedBox(height: AppSpace.xl),
          const KSectionHeader('Run history'),
          if (_history.isEmpty)
            KCard(padding: const EdgeInsets.all(AppSpace.lg), child: Text('No invoices raised yet', style: AppText.body))
          else
            KCard(child: KDivided(indent: 0, children: [for (final h in _history) _historyRow(h)])),
        ],
      ),
    );
  }

  Widget _historyRow(RunHistory h) {
    final tone = switch (h.status) {
      'success' => KTone.positive,
      'failed' => KTone.negative,
      _ => KTone.neutral,
    };
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(h.invoiceNumber ?? '-', style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
                Text(recurringDate(h.runDate), style: AppText.caption),
              ]),
            ),
            KPill(label: h.statusLabel, tone: tone),
          ]),
          if (h.error != null) ...[
            const SizedBox(height: 4),
            Text(h.error!, style: AppText.caption.copyWith(color: AppColors.negative)),
          ],
        ],
      ),
    );
  }
}

/// New schedule: the website's form (customer, invoice to copy, every N, frequency, first date, end date,
/// notes, finalise automatically). The server copies the lines from the chosen invoice.
class RecurringInvoiceFormScreen extends StatefulWidget {
  const RecurringInvoiceFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<RecurringInvoiceFormScreen> createState() => _RecurringInvoiceFormScreenState();
}

class _RecurringInvoiceFormScreenState extends State<RecurringInvoiceFormScreen> {
  String? _customerId;
  String? _customerName;
  String? _templateId;
  String? _templateLabel;
  String _frequency = 'monthly';
  final _every = TextEditingController(text: '1');
  String? _everyError;
  DateTime _start = dateOnly(DateTime.now());
  DateTime? _end;
  final _notes = TextEditingController();
  bool _auto = false;
  bool _dirty = false;

  @override
  void dispose() {
    _every.dispose();
    _notes.dispose();
    super.dispose();
  }

  /// `GET /api/invoices?status=final&customer_id=` for the chosen customer.
  Future<List<(String, String, String)>> _searchInvoices(String q) async {
    final text = q.trim();
    final body = await widget.session.api.getData(Uri(path: '/api/invoices', queryParameters: {
      'status': 'final',
      'customer_id': _customerId!,
      'limit': '50',
      if (text.isNotEmpty) 'search': text,
    }).toString());
    return [
      for (final r in docRows(body, 'invoices'))
        if (docText(r['id']).isNotEmpty)
          (
            docText(r['id']),
            docText(r['invoice_number']),
            [
              if (docDate(r['invoice_date']) != null) ddMMMyyyy(docDate(r['invoice_date'])!),
              if (docNum(r['grand_total']) != null) inr(docNum(r['grand_total'])!, maxFraction: 2),
            ].join(' · '),
          ),
    ];
  }

  Future<void> _save() async {
    final error = recurringIntervalError(_every.text);
    if (error != null) {
      setState(() => _everyError = error);
      return;
    }
    if (_end != null && _end!.isBefore(_start)) {
      showKToast(context, 'The end date must be on or after the first invoice date', tone: KTone.negative);
      return;
    }
    await widget.session.api.postJson(
      '/api/recurring-invoices',
      recurringCreateBody(
        customerId: _customerId!,
        templateInvoiceId: _templateId!,
        frequency: _frequency,
        interval: int.parse(_every.text.trim()),
        start: _start,
        end: _end,
        autoFinalize: _auto,
        notes: _notes.text,
      ),
    );
    if (!mounted) return;
    showKToast(context, 'Recurring invoice scheduled', tone: KTone.positive);
    setState(() => _dirty = false);
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'New recurring invoice',
      saveLabel: 'Schedule',
      dirty: _dirty,
      canSave: _customerId != null && _templateId != null,
      onSave: _save,
      children: [
        KAsyncPickField(
          label: 'Customer',
          valueLabel: _customerName,
          search: (q) => searchCustomers(widget.session.api, q),
          onPicked: (id, label) => setState(() {
            if (id != _customerId) {
              _templateId = null;
              _templateLabel = null;
            }
            _customerId = id;
            _customerName = label;
            _dirty = true;
          }),
        ),
        if (_customerId != null)
          KAsyncPickField(
            key: ValueKey('template-$_customerId'),
            label: 'Copy lines from invoice',
            valueLabel: _templateLabel,
            search: _searchInvoices,
            onPicked: (id, label) => setState(() {
              _templateId = id;
              _templateLabel = label;
              _dirty = true;
            }),
          ),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: KTextField(
              label: 'Every',
              controller: _every,
              error: _everyError,
              keyboard: TextInputType.number,
              onChanged: (_) => setState(() {
                _everyError = null;
                _dirty = true;
              }),
            ),
          ),
          const SizedBox(width: AppSpace.md),
          Expanded(
            child: KPickField<String>(
              label: 'Frequency',
              value: _frequency,
              options: kRecurringFrequencies,
              onChanged: (v) => setState(() {
                _frequency = v;
                _dirty = true;
              }),
            ),
          ),
        ]),
        KDateField(
          label: 'First invoice date',
          value: _start,
          onChanged: (d) => setState(() {
            _start = dateOnly(d);
            _dirty = true;
          }),
        ),
        KDateField(
          label: 'End date (optional)',
          value: _end,
          initial: _start,
          first: _start,
          onChanged: (d) => setState(() {
            _end = dateOnly(d);
            _dirty = true;
          }),
        ),
        if (_end != null) Align(alignment: Alignment.centerLeft, child: KTextButton(label: 'Clear end date', onTap: () => setState(() => _end = null))),
        KTextField(label: 'Notes', controller: _notes, maxLines: 3, onChanged: (_) => _dirty = true),
        KToggleField(
          label: 'Finalise automatically',
          help: 'Otherwise each invoice is saved as a draft for review',
          value: _auto,
          onChanged: (v) => setState(() {
            _auto = v;
            _dirty = true;
          }),
        ),
      ],
    );
  }
}
