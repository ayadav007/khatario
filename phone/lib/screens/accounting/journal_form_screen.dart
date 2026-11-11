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
import 'journal_list_logic.dart';
import 'journal_logic.dart';

/// New journal entry, or (with [entryId]) an edit of a saved one. The server rejects an entry unless
/// debits equal credits, so Save waits until the typed amounts match. The business and user come from
/// the session on the server.
///
/// Edit (`PATCH /api/journal-entries/[id]`): the form waits for `GET /api/journal-entries/[id]`. If that
/// fails it offers "Try again" with no form and no Save. A locked, reversed or automatic reversing entry,
/// or one whose lines the form cannot show, is refused with the reason and "Open on website"
/// ([journalEditRefusal]). Only what changed is sent; changed lines are sent whole, because the route
/// replaces every line. The server still refuses an entry in a locked or GST-filed period; its message is
/// shown and the form stays filled.
class JournalFormScreen extends StatefulWidget {
  const JournalFormScreen({super.key, required this.session, this.entryId});

  final AppSession session;
  final String? entryId;

  @override
  State<JournalFormScreen> createState() => _JournalFormScreenState();
}

/// The boxes behind one line card.
class _Row {
  _Row({this.accountId = '', this.accountLabel = '', this.debit = true, String amount = '', String narration = '', this.reference = '', required VoidCallback onEdit})
      : amount = TextEditingController(text: amount)..addListener(onEdit),
        narration = TextEditingController(text: narration)..addListener(onEdit);

  String accountId;
  String accountLabel;
  bool debit;

  /// The saved line's reference number: the form has no box for it, so an edit carries it through.
  final String reference;
  final TextEditingController amount;
  final TextEditingController narration;

  JournalLine get line => JournalLine(
        accountId: accountId,
        accountLabel: accountLabel,
        debit: debit,
        amount: amount.text,
        narration: narration.text,
        reference: reference,
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

  Map<String, dynamic> _oldEntry = const {};
  List<Map<String, dynamic>> _oldLines = const [];
  bool _loading = false;
  String? _loadError;
  String? _refusal;

  bool get _editing => widget.entryId != null;

  @override
  void initState() {
    super.initState();
    if (_editing) _load();
  }

  /// Edit: read the entry first. Nothing can be typed or saved until it has loaded and been accepted.
  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
      _refusal = null;
    });
    try {
      final doc = journalDetailDoc(await widget.session.api.getData('/api/journal-entries/${widget.entryId}'));
      if (doc.isEmpty) throw ApiException('Journal entry not found');
      final lines = docRows(doc, 'lines');
      final refusal = journalEditRefusal(doc, lines);
      if (!mounted) return;
      final old = [..._rows];
      setState(() {
        _oldEntry = doc;
        _oldLines = lines;
        _refusal = refusal;
        _loading = false;
        if (refusal == null) {
          _reference.text = docText(doc['reference_number']);
          _narration.text = docText(doc['narration']);
          final d = docDate(doc['entry_date']);
          _date = dateOnly(d ?? DateTime.now());
          _rows
            ..clear()
            ..addAll([
              for (final l in journalLinesFromEntry(lines))
                _Row(onEdit: _refresh, accountId: l.accountId, accountLabel: l.accountLabel, debit: l.debit, amount: l.amount, narration: l.narration, reference: l.reference),
            ]);
        }
      });
      // Only when the rows were replaced; a refused entry keeps (and later disposes) the blank ones.
      if (refusal == null) _disposeLater(old);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _loadError = e.message;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _loadError = 'Could not reach the server.';
          _loading = false;
        });
      }
    }
  }

  Map<String, dynamic> get _changes => journalEditChanges(
        oldEntry: _oldEntry,
        oldLines: _oldLines,
        date: _date,
        reference: _reference.text,
        narration: _narration.text,
        lines: _lines,
      );

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

  bool get _dirty => _editing
      ? _changes.isNotEmpty
      : _rows.any((r) => r.touched) || _reference.text.isNotEmpty || _narration.text.isNotEmpty || _reason.text.isNotEmpty || _templateId != null;

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
    if (_editing) return _saveEdit();
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

  Future<void> _saveEdit() async {
    final changes = _changes;
    if (changes.isEmpty) {
      Navigator.of(context).pop();
      return;
    }
    try {
      await widget.session.api.patchJson('/api/journal-entries/${widget.entryId}', changes);
    } on ApiException catch (e) {
      throw ApiException(journalActionMessage(e.code, e.message, verb: 'edited'), status: e.status, code: e.code, body: e.body);
    }
    if (mounted) Navigator.of(context).pop(true);
  }

  Widget _editGate() {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Edit journal entry'),
            Expanded(
              child: _loading
                  ? const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
                  : ListView(children: [
                      if (_loadError != null)
                        KEmptyState(
                          icon: LucideIcons.cloudOff,
                          title: 'Could not load the journal entry',
                          body: _loadError,
                          action: KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
                        )
                      else
                        KEmptyState(
                          icon: LucideIcons.lock,
                          title: _refusal ?? '',
                          action: KButton.secondary(
                            label: 'Open on website',
                            expand: false,
                            onPressed: () => openWebsiteInApp(context, widget.session, '/journal-entries/${widget.entryId}', 'Journal entry'),
                          ),
                        ),
                    ]),
            ),
          ],
        ),
      ),
    );
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
    if (_editing && (_loading || _loadError != null || _refusal != null)) return _editGate();
    final lines = _lines;
    final totals = journalTotals(lines);
    final balanced = journalBalanced(lines);
    return KFormScaffold(
      title: _editing ? 'Edit journal entry' : 'New journal entry',
      saveLabel: _editing ? 'Save changes' : 'Post entry',
      onSave: _save,
      canSave: balanced,
      dirty: _dirty,
      children: [
        if (!_editing) KButton(label: 'Use a template', kind: KButtonKind.secondary, icon: LucideIcons.layoutTemplate, onPressed: _useTemplate),
        KFormSection(title: 'Entry details', children: [
          KDateField(label: 'Entry date', value: _date, onChanged: (d) => setState(() => _date = d)),
          if (_needsReason && !_editing)
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
