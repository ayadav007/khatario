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
import '../docs/doc_list_screen.dart';
import '../docs/doc_logic.dart';
import '../reports/report_period.dart';
import '../sales/doc_action_sheets.dart';
import 'journal_form_screen.dart';
import 'journal_list_logic.dart';

/// `app/(app)/journal-entries/page.tsx`: the manual journal entries, newest first, grouped by day.
///
/// `GET /api/journal-entries?from_date=&to_date=&page=&limit=50` answers `entries` and `pagination`,
/// so "Show more" asks for the next page. The website opens on 1 January to today; the period bar
/// changes that. A row opens the entry; a long press offers Edit and Reverse as the entry allows (there is no Delete: the website only reverses, which keeps the audit trail).
class JournalEntriesScreen extends StatefulWidget {
  const JournalEntriesScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<JournalEntriesScreen> createState() => _JournalEntriesScreenState();
}

class _JournalEntriesScreenState extends State<JournalEntriesScreen> {
  ReportPeriod _period = journalDefaultPeriod();

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Journal Entries'),
            ReportPeriodBar(period: _period, onChanged: (p) => setState(() => _period = p)),
            Expanded(
              child: DocListScreen(
                key: ValueKey(_period.query),
                session: session,
                embedded: true,
                spec: DocListSpec(
                  title: 'Journal Entries',
                  href: '/journal-entries',
                  path: journalListPath(_period),
                  listKey: 'entries',
                  titleOf: journalRowTitle,
                  subtitleOf: journalRowSubtitle,
                  amountOf: (r) => docNum(r['total_debit']),
                  statusOf: journalRowStatus,
                  searchKeys: const ['voucher_number', 'reference_number'],
                  icon: LucideIcons.bookOpen,
                  emptyTitle: 'No journal entries found',
                  emptyBody: 'Manual accounting entries show up here.',
                  createLabel: 'New journal',
                  onCreate: (ctx) => Navigator.of(ctx).push<bool>(MaterialPageRoute(builder: (_) => JournalFormScreen(session: session))),
                  onOpen: (ctx, row) => Navigator.of(ctx).push<bool>(MaterialPageRoute(builder: (_) => JournalDetailScreen(session: session, voucherId: docText(row['voucher_id'])))),
                  rowActions: (row) => [
                    if (journalCanEdit(row)) DocAction('Edit entry', LucideIcons.pencil, (ctx) => editJournalEntry(ctx, session, docText(row['voucher_id']))),
                    if (journalCanReverse(row)) DocAction('Reverse entry', LucideIcons.undo2, (ctx) => reverseJournalEntry(ctx, session, row)),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// `app/(app)/journal-entries/[id]/page.tsx`: one entry with its lines, totals, lock and reversal.
///
/// `GET /api/journal-entries/[id]` answers `entry`, `lines` and `reversal` (the reversing lines of a
/// reversed entry). The totals are the entry's own `total_debit` and `total_credit`. Like the website,
/// a reversed entry has no actions and a locked one offers Unlock only.
class JournalDetailScreen extends StatelessWidget {
  const JournalDetailScreen({super.key, required this.session, required this.voucherId});

  final AppSession session;
  final String voucherId;

  Future<Map<String, dynamic>> _load(KhatarioApi api) async {
    final doc = journalDetailDoc(await api.getData('/api/journal-entries/$voucherId'));
    if (doc.isEmpty) throw ApiException('Journal entry not found');
    return doc;
  }

  static List<DocLine> _lines(List<Map<String, dynamic>> rows, {String prefix = ''}) {
    return [
      for (final l in rows)
        () {
          final debit = docNum(l['debit']) ?? 0;
          final credit = docNum(l['credit']) ?? 0;
          final name = docText(l['account_name']);
          return DocLine(
            '$prefix${name.isEmpty ? 'Account' : name}',
            subtitle: [docText(l['account_code']), if (debit > 0) 'Debit' else if (credit > 0) 'Credit', docText(l['narration'])].where((t) => t.isNotEmpty).join(' · '),
            amount: debit > 0 ? debit : credit,
          );
        }(),
    ];
  }

  @override
  Widget build(BuildContext context) {
    return DocDetailScreen(
      session: session,
      spec: DocDetailSpec(
        title: 'Journal entry',
        load: _load,
        numberOf: (d) => journalRowTitle(d),
        statusOf: journalRowStatus,
        amountOf: (d) => docNum(d['total_debit']),
        facts: (d) {
          final day = docDate(d['entry_date']);
          final lockedAt = docDate(d['locked_at']);
          final reversal = d['reversal'];
          final reversedAt = reversal is Map ? docDate(reversal['reversed_at']) : null;
          return [
            ('Entry date', day == null ? '' : ddMMMyyyy(day)),
            ('Reference number', docText(d['reference_number'])),
            ('Narration', docText(d['narration'])),
            if (d['is_reversing'] == true) ('Type', 'Reversing entry'),
            if (journalIsLocked(d)) ('Locked by', docText(d['locked_by_name']).isEmpty ? 'Unknown' : docText(d['locked_by_name'])),
            if (journalIsLocked(d)) ('Locked at', lockedAt == null ? '' : ddMMMyyyyHm(lockedAt)),
            if (journalIsLocked(d)) ('Lock reason', docText(d['lock_reason'])),
            if (reversal is Map) ('Reversed on', reversedAt == null ? '' : ddMMMyyyyHm(reversedAt)),
            if (reversal is Map) ('Reversed by', docText(reversal['reversed_by_name'])),
            if (reversal is Map) ('Reversal reason', docText(reversal['reason'])),
          ];
        },
        lines: (d) => [
          ..._lines(docRows(d, 'lines')),
          if (d['reversal'] is Map) ..._lines(docRows(d['reversal'], 'lines'), prefix: 'Reversal · '),
        ],
        totals: (d) => [
          ('Total debit', docNum(d['total_debit'])),
          ('Total credit', docNum(d['total_credit'])),
        ],
        primary: (d) {
          if (journalIsReversed(d)) return null;
          if (journalIsLocked(d)) return DocAction('Unlock entry', LucideIcons.lockOpen, (ctx) => unlockJournalEntry(ctx, session, d));
          return DocAction('Edit entry', LucideIcons.pencil, (ctx) => editJournalEntry(ctx, session, voucherId));
        },
        actions: (d) {
          if (!journalCanReverse(d)) return const [];
          return [
            DocAction('Lock entry', LucideIcons.lock, (ctx) => lockJournalEntry(ctx, session, d)),
            DocAction('Reverse entry', LucideIcons.undo2, (ctx) => reverseJournalEntry(ctx, session, d)),
          ];
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Actions shared by the list and the detail. Each returns true when the books changed (so the
// caller reloads) and shows the server's refusal as a toast.
// ---------------------------------------------------------------------------------------------

String _what(Map<String, dynamic> doc) {
  final amount = docNum(doc['total_debit']);
  return [journalRowTitle(doc), if (amount != null) inr(amount, maxFraction: 2)].join(' · ');
}

/// Opens the edit form; true when it saved.
Future<bool?> editJournalEntry(BuildContext context, AppSession session, String voucherId) {
  return Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => JournalFormScreen(session: session, entryId: voucherId)));
}

/// Runs [post]; a refusal becomes a toast. `JOURNAL_ALREADY_REVERSED` means it was already done, so
/// the caller reloads with a neutral message instead of an error.
Future<bool?> _post(BuildContext context, Future<void> Function() post, {required String done, required String verb, bool reloadOnAlready = false}) async {
  try {
    await post();
    if (context.mounted) showKToast(context, done, tone: KTone.positive);
    return true;
  } on ApiException catch (e) {
    if (!context.mounted) return null;
    final message = journalActionMessage(e.code, e.message, verb: verb);
    if (e.code == 'JOURNAL_ALREADY_REVERSED' && reloadOnAlready) {
      showKToast(context, message);
      return true;
    }
    showKToast(context, message, tone: KTone.negative);
    return null;
  } catch (_) {
    if (context.mounted) showKToast(context, 'Could not reach the server. Try again.', tone: KTone.negative);
    return null;
  }
}

/// "Reverse journal entry": names the entry and amount, wants a reason, then
/// `POST /api/journal-entries/[id]/reverse {reason}`.
Future<bool?> reverseJournalEntry(BuildContext context, AppSession session, Map<String, dynamic> doc) async {
  final reason = await showKSheet<String>(
    context,
    title: 'Reverse journal entry',
    scrollable: true,
    builder: (_) => _ReasonSheet(
      text: '${_what(doc)}. This journal entry will be reversed by posting corresponding reversing entries. The original entry will remain available for audit history.',
      label: 'Reason for reversal',
      hint: 'e.g. Entered twice, wrong amount',
      confirmLabel: 'Reverse entry',
      cancelLabel: 'Keep it',
      required: true,
      danger: true,
    ),
  );
  if (reason == null || !context.mounted) return null;
  return _post(
    context,
    () => session.api.postJson('/api/journal-entries/${docText(doc['voucher_id'])}/reverse', journalReverseBody(reason)),
    done: 'Entry reversed successfully.',
    verb: 'reversed',
    reloadOnAlready: true,
  );
}

/// "Lock entry": the website asks for an optional reason. `POST /api/journal-entries/[id]/lock`.
Future<bool?> lockJournalEntry(BuildContext context, AppSession session, Map<String, dynamic> doc) async {
  final reason = await showKSheet<String>(
    context,
    title: 'Lock entry',
    scrollable: true,
    builder: (_) => _ReasonSheet(
      text: '${_what(doc)} can no longer be edited, reversed or deleted until it is unlocked.',
      label: 'Reason for locking (optional)',
      hint: 'e.g. Month closed',
      confirmLabel: 'Lock entry',
      cancelLabel: 'Cancel',
      required: false,
      danger: false,
    ),
  );
  if (reason == null || !context.mounted) return null;
  return _post(
    context,
    () => session.api.postJson('/api/journal-entries/${docText(doc['voucher_id'])}/lock', journalLockBody(reason)),
    done: 'Entry locked',
    verb: 'locked',
  );
}

/// "Unlock entry": asks first, then `DELETE /api/journal-entries/[id]/lock`.
Future<bool?> unlockJournalEntry(BuildContext context, AppSession session, Map<String, dynamic> doc) async {
  final sure = await askSheet(
    context,
    title: 'Unlock entry',
    text: 'Are you sure you want to unlock this entry?',
    confirmLabel: 'Unlock entry',
    cancelLabel: 'Cancel',
    danger: false,
  );
  if (!sure || !context.mounted) return null;
  return _post(
    context,
    () => session.api.deleteJson('/api/journal-entries/${docText(doc['voucher_id'])}/lock'),
    done: 'Entry unlocked',
    verb: 'unlocked',
  );
}

/// A sheet with a sentence, one text box and a confirm button. Pops the trimmed text; a required
/// box left blank shows "Add a reason" instead. A double tap answers once.
class _ReasonSheet extends StatefulWidget {
  const _ReasonSheet({
    required this.text,
    required this.label,
    required this.hint,
    required this.confirmLabel,
    required this.cancelLabel,
    required this.required,
    required this.danger,
  });

  final String text, label, hint, confirmLabel, cancelLabel;
  final bool required, danger;

  @override
  State<_ReasonSheet> createState() => _ReasonSheetState();
}

class _ReasonSheetState extends State<_ReasonSheet> {
  final _reason = TextEditingController();
  String? _error;
  bool _done = false;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  void _confirm() {
    if (_done) return;
    final reason = _reason.text.trim();
    if (widget.required && reason.isEmpty) {
      setState(() => _error = 'Add a reason');
      return;
    }
    _done = true;
    Navigator.of(context).pop(reason);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(widget.text, style: AppText.body.copyWith(color: AppColors.ink2)),
          const SizedBox(height: AppSpace.md),
          KTextField(label: widget.label, controller: _reason, hint: widget.hint, error: _error, maxLines: 2),
          const SizedBox(height: AppSpace.lg),
          KButton(label: widget.confirmLabel, kind: widget.danger ? KButtonKind.danger : KButtonKind.primary, onPressed: _confirm),
          const SizedBox(height: AppSpace.sm),
          KButton.secondary(
            label: widget.cancelLabel,
            onPressed: () {
              if (_done) return;
              _done = true;
              Navigator.of(context).pop();
            },
          ),
        ],
      ),
    );
  }
}
