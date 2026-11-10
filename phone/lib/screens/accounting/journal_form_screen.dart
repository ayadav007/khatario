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
import 'journal_logic.dart';

/// New journal entry. The server rejects it unless debits equal credits, so Save waits until
/// the typed amounts match. The business and user come from the session on the server.
class JournalFormScreen extends StatefulWidget {
  const JournalFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<JournalFormScreen> createState() => _JournalFormScreenState();
}

/// The boxes behind one line card.
class _Row {
  _Row({this.accountId = '', this.accountLabel = '', this.debit = true, String amount = '', String narration = '', required VoidCallback onEdit})
      : amount = TextEditingController(text: amount)..addListener(onEdit),
        narration = TextEditingController(text: narration)..addListener(onEdit);

  String accountId;
  String accountLabel;
  bool debit;
  final TextEditingController amount;
  final TextEditingController narration;

  JournalLine get line => JournalLine(
        accountId: accountId,
        accountLabel: accountLabel,
        debit: debit,
        amount: amount.text,
        narration: narration.text,
      );

  bool get touched => accountId.isNotEmpty || amount.text.isNotEmpty || narration.text.isNotEmpty;

  void dispose() {
    amount.dispose();
    narration.dispose();
  }
}

class _JournalFormScreenState extends State<JournalFormScreen> {
  final _reference = TextEditingController();
  final _narration = TextEditingController();
  final _reason = TextEditingController();
  bool _reasonShown = false;
  late final _rows = [_Row(onEdit: _refresh), _Row(onEdit: _refresh)];
  DateTime _date = DateTime.now();
  String? _templateId;

  @override
  void dispose() {
    _reference.dispose();
    _narration.dispose();
    _reason.dispose();
    for (final r in _rows) {
      r.dispose();
    }
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  List<JournalLine> get _lines => [for (final r in _rows) r.line];

  bool get _dirty => _rows.any((r) => r.touched) || _reference.text.isNotEmpty || _narration.text.isNotEmpty || _reason.text.isNotEmpty || _templateId != null;

  /// Controllers still sit in the old widgets until the next frame, so free them after it.
  void _disposeLater(Iterable<_Row> rows) {
    final old = rows.toList();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      for (final r in old) {
        r.dispose();
      }
    });
  }

  void _remove(int i) {
    if (_rows.length <= 2) return;
    final gone = _rows.removeAt(i);
    _disposeLater([gone]);
    setState(() {});
  }

  Future<List<(String, String, String)>> _accountSearch(String q) => searchAccounts(widget.session.api, q);

  bool get _needsReason => journalNeedsBackdateReason(DateTime.now(), _date);

  Future<void> _save() async {
    if (!journalBalanced(_lines)) return;
    if (_needsReason && _reason.text.trim().isEmpty) {
      setState(() => _reasonShown = true);
      return;
    }
    await widget.session.api.postJson(
      '/api/journal-entries',
      journalBody(
        date: _date,
        reference: _reference.text,
        narration: _narration.text,
        branchId: widget.session.defaultBranchId,
        templateId: _templateId,
        backdateReason: _needsReason ? _reason.text : null,
        lines: _lines,
      ),
    );
    if (mounted) Navigator.of(context).pop(true);
  }

  Future<void> _useTemplate() async {
    final picked = await showKSheet<Map<String, dynamic>>(
      context,
      title: 'Use a template',
      builder: (ctx) => _TemplateSheet(api: widget.session.api),
    );
    if (picked == null || !mounted) return;
    final id = docText(picked['id']);
    var raw = picked['lines'];
    try {
      if (raw is! List || raw.isEmpty) {
        final body = await widget.session.api.getData('/api/journal-entries/templates/$id');
        final t = body is Map ? body['template'] : null;
        raw = t is Map ? t['lines'] : null;
      }
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
      return;
    } catch (_) {
      if (mounted) showKToast(context, 'Could not load the template. Try again.', tone: KTone.negative);
      return;
    }
    if (!mounted) return;
    final lines = raw is List ? journalLinesFromTemplate(raw) : <JournalLine>[];
    if (lines.isEmpty) {
      showKToast(context, 'This template has no lines.', tone: KTone.negative);
      return;
    }
    if (_rows.any((r) => r.touched)) {
      final replace = await showKSheet<bool>(
        context,
        title: 'Replace the current lines?',
        builder: (ctx) => Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KSheetAction(icon: LucideIcons.refreshCw, label: 'Replace', subtitle: 'The lines you entered are removed', danger: true, onTap: () => Navigator.of(ctx).pop(true)),
            KSheetAction(icon: LucideIcons.pencil, label: 'Keep my lines', onTap: () => Navigator.of(ctx).pop(false)),
          ],
        ),
      );
      if (replace != true || !mounted) return;
    }
    // Templates keep account ids only; read each name by id (at most one call per line).
    final names = <String, String>{};
    await Future.wait([
      for (final id in {for (final l in lines) l.accountId})
        () async {
          try {
            final body = await widget.session.api.getData('/api/accounts/$id');
            final a = body is Map ? body['account'] : null;
            final name = a is Map ? docText(a['account_name']) : '';
            if (name.isNotEmpty) names[id] = name;
          } catch (_) {}
        }(),
    ]);
    if (!mounted) return;
    final old = [..._rows];
    setState(() {
      _rows
        ..clear()
        ..addAll([
          for (final l in lines) _Row(onEdit: _refresh, accountId: l.accountId, accountLabel: names[l.accountId] ?? 'Selected account', debit: l.debit, amount: l.amount, narration: l.narration),
        ]);
      while (_rows.length < 2) {
        _rows.add(_Row(onEdit: _refresh));
      }
      _date = journalTemplateDate(DateTime.now(), picked);
      _templateId = id.isEmpty ? null : id;
    });
    _disposeLater(old);
  }

  @override
  Widget build(BuildContext context) {
    final lines = _lines;
    final totals = journalTotals(lines);
    final balanced = journalBalanced(lines);
    return KFormScaffold(
      title: 'New journal entry',
      saveLabel: 'Post entry',
      onSave: _save,
      canSave: balanced,
      dirty: _dirty,
      children: [
        KButton(label: 'Use a template', kind: KButtonKind.secondary, icon: LucideIcons.layoutTemplate, onPressed: _useTemplate),
        KFormSection(title: 'Entry details', children: [
          KDateField(label: 'Entry date', value: _date, onChanged: (d) => setState(() => _date = d)),
          if (_needsReason)
            KTextField(
              label: 'Reason for back-dating',
              controller: _reason,
              hint: 'Why is this entry dated more than 30 days back?',
              maxLines: 2,
              error: _reasonShown && _reason.text.trim().isEmpty ? 'Enter a reason for back-dating this entry' : null,
              onChanged: (_) => setState(() {}),
            ),
          KTextField(label: 'Reference number', controller: _reference, hint: 'Optional', onChanged: (_) => setState(() {})),
          KTextField(label: 'Narration', controller: _narration, hint: 'What this entry is for', maxLines: 3, onChanged: (_) => setState(() {})),
        ]),
        const KSectionHeader('Lines'),
        for (final (i, row) in _rows.indexed) _lineCard(i, row),
        KButton(label: 'Add line', kind: KButtonKind.secondary, icon: LucideIcons.plus, onPressed: () => setState(() => _rows.add(_Row(onEdit: _refresh)))),
        _footer(totals, balanced),
      ],
    );
  }

  Widget _lineCard(int i, _Row row) {
    final canRemove = _rows.length > 2;
    return KCard(
      key: ValueKey('journal-line-$i'),
      padding: const EdgeInsets.all(AppSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(child: Text('Line ${i + 1}', style: AppText.bodyStrong)),
              IgnorePointer(
                ignoring: !canRemove,
                child: Opacity(
                  opacity: canRemove ? 1 : 0.35,
                  child: KIconButton(icon: LucideIcons.trash2, tooltip: 'Remove line', onTap: () => _remove(i)),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpace.sm),
          KAsyncPickField(
            label: 'Account',
            valueLabel: row.accountId.isEmpty ? null : row.accountLabel,
            search: _accountSearch,
            onPicked: (id, label) => setState(() {
              row.accountId = id;
              row.accountLabel = label;
            }),
          ),
          const SizedBox(height: AppSpace.md),
          KSegmented<bool>(
            value: row.debit,
            options: const [(true, 'Debit'), (false, 'Credit')],
            onChanged: (v) => setState(() => row.debit = v),
          ),
          const SizedBox(height: AppSpace.md),
          KAmountField(label: 'Amount', controller: row.amount),
          const SizedBox(height: AppSpace.md),
          KTextField(label: 'Line note', controller: row.narration, hint: 'Optional'),
        ],
      ),
    );
  }

  Widget _footer(({int debit, int credit}) totals, bool balanced) {
    final diff = (totals.debit - totals.credit).abs();
    Widget cell(String label, int paise, {Color? color}) => Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: AppText.caption),
              const SizedBox(height: 2),
              Text(inr(paise / 100, maxFraction: paise % 100 == 0 ? 0 : 2), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular, color: color)),
            ],
          ),
        );
    return KCard(
      padding: const EdgeInsets.all(AppSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(children: [
            cell('Total debit', totals.debit),
            cell('Total credit', totals.credit),
            cell('Difference', diff, color: diff == 0 && totals.debit > 0 ? AppColors.positive : AppColors.negative),
          ]),
          if (!balanced) ...[
            const SizedBox(height: AppSpace.sm),
            Text('Add at least two lines with an account and an amount, with debit equal to credit.', style: AppText.caption),
          ],
        ],
      ),
    );
  }
}

/// The saved templates, loaded when the sheet opens. Picking one closes it with that template.
class _TemplateSheet extends StatefulWidget {
  const _TemplateSheet({required this.api});

  final KhatarioApi api;

  @override
  State<_TemplateSheet> createState() => _TemplateSheetState();
}

class _TemplateSheetState extends State<_TemplateSheet> {
  bool _loading = true;
  bool _notInPlan = false;
  String? _error;
  List<Map<String, dynamic>> _rows = const [];

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
      final body = await widget.api.getData('/api/journal-entries/templates?is_active=true');
      if (!mounted) return;
      setState(() {
        _rows = docRows(body, 'templates');
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not load templates.';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final Widget body;
    if (_loading) {
      body = const KSpinner();
    } else if (_notInPlan) {
      body = const KEmptyState(icon: LucideIcons.lock, title: 'Not included in your current plan');
    } else if (_error != null) {
      body = KEmptyState(
        icon: LucideIcons.circleAlert,
        title: _error!,
        action: KButton(label: 'Try again', expand: false, kind: KButtonKind.secondary, onPressed: _load),
      );
    } else if (_rows.isEmpty) {
      body = const KEmptyState(icon: LucideIcons.layoutTemplate, title: 'No templates yet', body: 'Templates you save on the website show up here.');
    } else {
      body = ListView(
        children: [
          for (final t in _rows)
            KListRow(
              title: docText(t['name']),
              subtitle: docText(t['description']).isEmpty ? null : docText(t['description']),
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              onTap: () => Navigator.of(context).pop(t),
            ),
        ],
      );
    }
    return SizedBox(height: MediaQuery.sizeOf(context).height * 0.6, child: body);
  }
}
