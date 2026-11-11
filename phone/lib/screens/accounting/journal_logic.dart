import '../docs/doc_logic.dart';

/// One line of a journal entry as typed on the phone. [amount] is the text in the box.
class JournalLine {
  const JournalLine({this.accountId = '', this.accountLabel = '', this.debit = true, this.amount = '', this.narration = '', this.reference = ''});

  final String accountId;
  final String accountLabel;
  final bool debit;
  final String amount;
  final String narration;

  /// The line's own `reference_number` (kept when an entry is edited; the form has no box for it).
  final String reference;

  /// Nothing entered yet: no account and no amount. Such lines are left out of the entry.
  bool get isBlank => accountId.isEmpty && (journalPaise(amount) ?? 0) == 0;

  bool get isComplete => accountId.isNotEmpty && (journalPaise(amount) ?? 0) > 0;
}

/// Typed money as whole paise ("10.5" -> 1050), or null when empty or not a number.
/// Integer arithmetic only, so 0.1 + 0.2 equals 0.3.
int? journalPaise(String text) {
  final t = text.trim();
  final m = RegExp(r'^(\d*)(?:\.(\d{0,2})\d*)?$').firstMatch(t);
  if (m == null || t.isEmpty || t == '.') return null;
  final whole = int.tryParse(m.group(1)!.isEmpty ? '0' : m.group(1)!) ?? 0;
  final frac = (m.group(2) ?? '').padRight(2, '0');
  return whole * 100 + int.parse(frac);
}

/// Paise as the shortest text the amount box shows (50000 -> "500", 50050 -> "500.5").
String journalAmountText(int paise) {
  final whole = paise ~/ 100;
  final frac = paise % 100;
  if (frac == 0) return '$whole';
  final f = frac.toString().padLeft(2, '0');
  return '$whole.${f.endsWith('0') ? f.substring(0, 1) : f}';
}

/// Total debit and total credit in paise, over the lines that have an amount.
({int debit, int credit}) journalTotals(List<JournalLine> lines) {
  var debit = 0;
  var credit = 0;
  for (final l in lines) {
    final p = journalPaise(l.amount) ?? 0;
    if (l.debit) {
      debit += p;
    } else {
      credit += p;
    }
  }
  return (debit: debit, credit: credit);
}

/// True when the entry can be posted: every line that has anything on it is complete, there
/// are at least two complete lines, and debit equals credit (both above zero).
bool journalBalanced(List<JournalLine> lines) {
  final used = lines.where((l) => !l.isBlank).toList();
  if (used.length < 2 || used.any((l) => !l.isComplete)) return false;
  final t = journalTotals(used);
  return t.debit > 0 && t.credit > 0 && t.debit == t.credit;
}

num _money(int paise) => paise % 100 == 0 ? paise ~/ 100 : paise / 100;

String _isoDay(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// The `lines` of a journal body (`POST /api/journal-entries`, and `PATCH .../[id]` when the lines change).
/// A blank line is left out.
List<Map<String, dynamic>> journalLinesBody(List<JournalLine> lines) => [
      for (final l in lines)
        if (!l.isBlank)
          {
            'account_id': l.accountId,
            'debit': l.debit ? _money(journalPaise(l.amount) ?? 0) : 0,
            'credit': l.debit ? 0 : _money(journalPaise(l.amount) ?? 0),
            'narration': l.narration.trim().isEmpty ? null : l.narration.trim(),
            if (l.reference.trim().isNotEmpty) 'reference_number': l.reference.trim(),
          },
    ];

/// The `POST /api/journal-entries` body, as the website builds it. The other side of a line is 0.
/// The server fills in the business and the user.
Map<String, dynamic> journalBody({
  required DateTime date,
  required String reference,
  required String narration,
  required String? branchId,
  required String? templateId,
  required List<JournalLine> lines,
  String? backdateReason,
}) {
  String? orNull(String s) => s.trim().isEmpty ? null : s.trim();
  return {
    'branch_id': branchId,
    'entry_date': _isoDay(date),
    'reference_number': orNull(reference),
    'narration': orNull(narration),
    'lines': journalLinesBody(lines),
    if (templateId != null && templateId.isNotEmpty) 'template_id': templateId,
    if (backdateReason != null && backdateReason.trim().isNotEmpty) 'backdate_reason': backdateReason.trim(),
  };
}

/// Lines for the form from a template's `lines`. A template may hold only accounts and sides,
/// so an amount can be blank. A line without an account is skipped.
List<JournalLine> journalLinesFromTemplate(List<dynamic> raw) {
  final out = <JournalLine>[];
  for (final r in raw) {
    if (r is! Map) continue;
    final account = docText(r['account_id']);
    if (account.isEmpty) continue;
    final d = journalPaise(docText(r['debit'])) ?? 0;
    final c = journalPaise(docText(r['credit'])) ?? 0;
    final bool debit;
    final int paise;
    if (d > 0) {
      debit = true;
      paise = d;
    } else if (c > 0) {
      debit = false;
      paise = c;
    } else {
      // Only the credit key carries a value (for example 0): a credit line with no amount yet.
      final hasD = docText(r['debit']).isNotEmpty;
      final hasC = docText(r['credit']).isNotEmpty;
      debit = hasD || !hasC;
      paise = 0;
    }
    out.add(JournalLine(
      accountId: account,
      debit: debit,
      amount: paise > 0 ? journalAmountText(paise) : '',
      narration: docText(r['narration']),
    ));
  }
  return out;
}

/// A template's entry date: today moved by `entry_date_offset` days.
DateTime journalTemplateDate(DateTime today, Map<String, dynamic> template) {
  final off = docNum(template['entry_date_offset'])?.toInt() ?? 0;
  return DateTime(today.year, today.month, today.day + off);
}

/// Whole days from [date] back to [today], counted between local midnights and rounded down,
/// as the server does (`lib/backdate-controls.ts`). Negative for a future date.
int journalDaysBack(DateTime today, DateTime date) {
  final a = DateTime.utc(today.year, today.month, today.day);
  final b = DateTime.utc(date.year, date.month, date.day);
  return a.difference(b).inDays;
}

/// The server wants a reason for an entry dated more than 30 days back.
bool journalNeedsBackdateReason(DateTime today, DateTime date) => journalDaysBack(today, date) > 30;
