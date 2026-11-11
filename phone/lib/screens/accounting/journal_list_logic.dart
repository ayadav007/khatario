import '../../format.dart';
import '../docs/doc_logic.dart';
import '../reports/report_period.dart';
import 'journal_logic.dart';

/// Rules for the journal entry list, detail and edit, copied from the website
/// (`app/(app)/journal-entries/page.tsx`, `[id]/page.tsx`, `lib/accounting-ui/errors.ts`,
/// `lib/accounting-ui/reversal.ts`) and the routes under `app/api/journal-entries`. Every amount
/// shown is the server's; nothing here adds up a ledger.

/// The website opens on 1 January of this year to today (a custom range).
ReportPeriod journalDefaultPeriod([DateTime? now]) {
  final today = dateOnly(now ?? DateTime.now());
  return ReportPeriod('custom', DateTime(today.year, 1, 1), today);
}

/// `GET /api/journal-entries` pages with `page` and `limit` and answers `pagination`.
String journalListPath(ReportPeriod p) => '/api/journal-entries?${p.query}&limit=50';

String journalRowTitle(Map<String, dynamic> row) {
  final n = docText(row['voucher_number']);
  return n.isEmpty ? 'Journal entry' : n;
}

String journalRowSubtitle(Map<String, dynamic> row) {
  final lines = docNum(row['line_count'])?.toInt();
  return [
    docText(row['reference_number']),
    if (lines != null) '$lines ${lines == 1 ? 'line' : 'lines'}',
  ].where((t) => t.isNotEmpty).join(' · ');
}

bool journalIsReversed(Map<String, dynamic> row) => row['is_reversed'] == true;

bool journalIsLocked(Map<String, dynamic> row) => row['is_locked'] == true;

/// Reversed wins over locked, as the website's list and detail badges do.
String? journalRowStatus(Map<String, dynamic> row) => journalIsReversed(row) ? 'reversed' : (journalIsLocked(row) ? 'locked' : null);

/// The website's reverse button is disabled for a locked or a reversed entry.
bool journalCanReverse(Map<String, dynamic> row) => !journalIsLocked(row) && !journalIsReversed(row);

/// The website's list hides the edit button on a reversed entry only (a locked one is refused by the server).
bool journalCanEdit(Map<String, dynamic> row) => !journalIsReversed(row);

/// `POST /api/journal-entries/[id]/reverse` wants a reason.
Map<String, dynamic> journalReverseBody(String reason) => {'reason': reason.trim()};

/// `POST /api/journal-entries/[id]/lock`: the reason is optional and left out when blank.
Map<String, dynamic> journalLockBody(String reason) => reason.trim().isEmpty ? <String, dynamic>{} : {'lock_reason': reason.trim()};

/// The words the website shows for a refusal. [verb] is `reversed`, `edited` or `locked`.
/// A locked-period or filed-GST refusal keeps the server's own text, which names the date.
String journalActionMessage(String? code, String serverMessage, {String verb = 'reversed'}) {
  switch (code) {
    case 'JOURNAL_LOCKED':
      return 'This journal entry is locked. Unlock it before it can be $verb.';
    case 'JOURNAL_ALREADY_REVERSED':
      return 'This journal entry has already been reversed.';
    case 'JOURNAL_REVERSED':
      return 'This journal entry has been reversed and can no longer be edited.';
  }
  return serverMessage;
}

const _cannotShow = 'This entry has lines or settings the phone cannot show. Edit it on the website.';

/// Why the phone will not edit this entry, or null when it can. The entry is `GET /api/journal-entries/[id]`'s
/// `entry`, [lines] its `lines`. The route's PATCH only changes the date, reference, narration and the
/// lines, all of which the form holds; an entry the form could not show truthfully is refused instead.
String? journalEditRefusal(Map<String, dynamic> entry, List<Map<String, dynamic>> lines) {
  if (journalIsReversed(entry)) return journalActionMessage('JOURNAL_REVERSED', '');
  if (journalIsLocked(entry)) return journalActionMessage('JOURNAL_LOCKED', '', verb: 'edited');
  if (entry['is_reversing'] == true || docText(entry['reverses_entry_id']).isNotEmpty) {
    return 'This is an automatic reversing entry. Edit it on the website.';
  }
  if (lines.length < 2) return _cannotShow;
  for (final l in lines) {
    final debit = docNum(l['debit']) ?? 0;
    final credit = docNum(l['credit']) ?? 0;
    if (docText(l['account_id']).isEmpty || (debit > 0) == (credit > 0)) return _cannotShow;
  }
  return null;
}

/// The saved lines as the form shows them: one side per line.
List<JournalLine> journalLinesFromEntry(List<Map<String, dynamic>> lines) {
  return [
    for (final l in lines)
      () {
        final debit = ((docNum(l['debit']) ?? 0) * 100).round();
        final credit = ((docNum(l['credit']) ?? 0) * 100).round();
        final isDebit = debit > 0;
        return JournalLine(
          accountId: docText(l['account_id']),
          accountLabel: docText(l['account_name']).isEmpty ? 'Selected account' : docText(l['account_name']),
          debit: isDebit,
          amount: journalAmountText(isDebit ? debit : credit),
          narration: docText(l['narration']),
          reference: docText(l['reference_number']),
        );
      }(),
  ];
}

bool _sameLines(List<JournalLine> a, List<JournalLine> b) {
  final x = [for (final l in a) if (!l.isBlank) l];
  final y = [for (final l in b) if (!l.isBlank) l];
  if (x.length != y.length) return false;
  for (var i = 0; i < x.length; i++) {
    if (x[i].accountId != y[i].accountId ||
        x[i].debit != y[i].debit ||
        journalPaise(x[i].amount) != journalPaise(y[i].amount) ||
        x[i].narration.trim() != y[i].narration.trim() ||
        x[i].reference.trim() != y[i].reference.trim()) {
      return false;
    }
  }
  return true;
}

/// `PATCH /api/journal-entries/[id]`: only what changed. Without `lines` the route updates the header
/// (and re-posts the same amounts on a new date); with `lines` it replaces every line, so all of them are sent.
Map<String, dynamic> journalEditChanges({
  required Map<String, dynamic> oldEntry,
  required List<Map<String, dynamic>> oldLines,
  required DateTime date,
  required String reference,
  required String narration,
  required List<JournalLine> lines,
}) {
  final changes = <String, dynamic>{};
  final oldDate = docDate(oldEntry['entry_date']);
  if (oldDate == null || ymd(dateOnly(oldDate)) != ymd(dateOnly(date))) changes['entry_date'] = ymd(dateOnly(date));
  if (reference.trim() != docText(oldEntry['reference_number']).trim()) {
    changes['reference_number'] = reference.trim().isEmpty ? null : reference.trim();
  }
  if (narration.trim() != docText(oldEntry['narration']).trim()) {
    changes['narration'] = narration.trim().isEmpty ? null : narration.trim();
  }
  if (!_sameLines(lines, journalLinesFromEntry(oldLines))) changes['lines'] = journalLinesBody(lines);
  return changes;
}

/// The detail page's document: the entry with its `lines` and `reversal` beside it.
Map<String, dynamic> journalDetailDoc(dynamic body) {
  final entry = body is Map ? body['entry'] : null;
  if (entry is! Map) return const {};
  return {
    ...Map<String, dynamic>.from(entry),
    'lines': docRows(body, 'lines'),
    'reversal': body['reversal'] is Map ? Map<String, dynamic>.from(body['reversal'] as Map) : null,
  };
}
