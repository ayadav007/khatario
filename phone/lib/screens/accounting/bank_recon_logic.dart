import '../../format.dart';
import '../docs/doc_logic.dart';
import 'advances_logic.dart' show advanceMoney;

/// Rules for bank reconciliation, copied from the website (`app/(app)/bank/reconciliation/page.tsx`,
/// `lib/bank/reconciliation-ui-helpers.ts`) and the routes under `app/api/bank/reconciliation`.
/// The phone never works out a balance or a difference: the summary the server sends is shown as is.
/// No body carries a business or a user; the session decides both.

/// Importing a statement needs a spreadsheet upload, so it stays on the website.
const bankImportHref = '/bank/import';

// ---------------------------------------------------------------------------------------------
// Accounts and statements
// ---------------------------------------------------------------------------------------------

/// `accounts` of `GET /api/bank-accounts`, only those linked to a ledger account (the website's filter).
List<Map<String, dynamic>> reconBankAccounts(dynamic body) => [
      for (final a in docRows(body, 'accounts'))
        if (docText(a['id']).isNotEmpty && docText(a['ledger_account_id']).isNotEmpty) a,
    ];

/// `HDFC — Current`.
String reconBankAccountLabel(Map<String, dynamic> a) => '${docText(a['bank_name'])} — ${docText(a['account_name'])}';

String reconStatementsPath(String bankAccountId) => '/api/bank/reconciliation?bank_account_id=${Uri.encodeQueryComponent(bankAccountId)}';

String reconStatementPath(String statementId) => '/api/bank/reconciliation?bank_statement_id=${Uri.encodeQueryComponent(statementId)}';

String _day(dynamic v) {
  final d = docDate(v);
  return d == null ? docText(v) : ddMMMyyyy(d);
}

/// `01 Oct 2026 → 31 Oct 2026`, with `(done)` once reconciled.
String reconStatementLabel(Map<String, dynamic> s) {
  final period = '${_day(s['statement_period_start'])} → ${_day(s['statement_period_end'])}';
  return docText(s['reconciliation_status']) == 'completed' ? '$period (done)' : period;
}

bool reconIsCompleted(dynamic payload) {
  if (payload is! Map) return false;
  final s = payload['statement'];
  return s is Map && docText(s['reconciliation_status']) == 'completed';
}

// ---------------------------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------------------------

/// `POST /api/bank/reconciliation/match`.
Map<String, dynamic> reconMatchBody({required String statementId, required String lineId, required List<String> ledgerIds}) =>
    {'bank_statement_id': statementId, 'statement_line_id': lineId, 'ledger_line_ids': ledgerIds};

/// `POST /api/bank/reconciliation/ignore`.
Map<String, dynamic> reconIgnoreBody({required String statementId, required String lineId}) => {'bank_statement_id': statementId, 'statement_line_id': lineId};

/// `POST /api/bank/reconciliation/undo`.
Map<String, dynamic> reconUndoBody({required String statementId, required String lineId}) => {'bank_statement_id': statementId, 'statement_line_id': lineId};

/// `POST /api/bank/reconciliation/create-entry`. The server takes the amount and date from the line.
Map<String, dynamic> reconCreateEntryBody({required String statementId, required String lineId, required String type, required String accountId}) =>
    {'bank_statement_id': statementId, 'statement_line_id': lineId, 'type': type, 'account_id': accountId};

/// `POST /api/bank/reconciliation/auto-match`.
Map<String, dynamic> reconAutoMatchBody(String statementId) => {'bank_statement_id': statementId};

/// `POST /api/bank/reconciliation/complete`. [force] is how the website completes with unmatched lines left.
Map<String, dynamic> reconCompleteBody({required String statementId, required bool force}) => {'bank_statement_id': statementId, 'force': force};

// ---------------------------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------------------------

num _amt(dynamic v) => docNum(v) ?? 0;

/// The website's `bankLineFlow`: a credit wins, then a debit.
({bool inflow, num amount}) reconLineFlow(Map<String, dynamic> line) {
  final d = _amt(line['debit_amount']);
  final c = _amt(line['credit_amount']);
  if (c > 0.005) return (inflow: true, amount: c);
  if (d > 0.005) return (inflow: false, amount: d);
  return (inflow: false, amount: 0);
}

/// `Dr ₹118.00` (money out of the bank) or `Cr ₹45.50` (money in), the statement's own columns.
String reconLineAmountText(Map<String, dynamic> line) {
  final f = reconLineFlow(line);
  return '${f.inflow ? 'Cr' : 'Dr'} ${advanceMoney(f.amount)}';
}

/// `bank_charge` for a debit line, `interest` for a credit line, null when the line has no amount.
String? reconCreateType(Map<String, dynamic> line) {
  final f = reconLineFlow(line);
  if (f.amount <= 0) return null;
  return f.inflow ? 'interest' : 'bank_charge';
}

/// The account type the route accepts for each entry type.
String reconOffsetAccountType(String type) => type == 'interest' ? 'income' : 'expense';

String reconStatusLabel(String status) => switch (status) {
      'matched' => 'Matched',
      'partial' => 'Partial',
      'ignored' => 'Ignored',
      _ => 'Unmatched',
    };

enum ReconFilter { all, unmatched, partial, over30, duplicates }

const reconFilterOptions = <(ReconFilter, String)>[
  (ReconFilter.all, 'All'),
  (ReconFilter.unmatched, 'Unmatched'),
  (ReconFilter.partial, 'Partial'),
  (ReconFilter.over30, 'Over 30 days'),
  (ReconFilter.duplicates, 'Duplicates'),
];

/// The website's filters, on the fields the server sent, plus its search of description and date.
List<Map<String, dynamic>> reconFilterLines(List<Map<String, dynamic>> lines, ReconFilter filter, String query) {
  final q = query.trim().toLowerCase();
  return [
    for (final l in lines)
      if (_passes(l, filter) && (q.isEmpty || docText(l['description']).toLowerCase().contains(q) || docText(l['transaction_date']).contains(q))) l,
  ];
}

bool _passes(Map<String, dynamic> l, ReconFilter f) {
  final status = docText(l['match_status']);
  return switch (f) {
    ReconFilter.all => true,
    ReconFilter.unmatched => status == 'unmatched',
    ReconFilter.partial => status == 'partial',
    ReconFilter.over30 => (docNum(l['age_days']) ?? 0) > 30,
    ReconFilter.duplicates => l['is_duplicate'] == true,
  };
}

// ---------------------------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------------------------

/// The suggestion the server made for [lineId], or null.
Map<String, dynamic>? reconSuggestionFor(dynamic payload, String lineId) {
  for (final s in docRows(payload, 'suggestions')) {
    if (docText(s['bankLineId']) == lineId) return s;
  }
  return null;
}

/// `ledger_lines` by id.
Map<String, Map<String, dynamic>> reconLedgerById(dynamic payload) => {
      for (final l in docRows(payload, 'ledger_lines')) docText(l['id']): l,
    };

/// The ids a suggestion points at.
List<String> reconSuggestionLedgerIds(Map<String, dynamic> s) {
  final raw = s['ledgerLineIds'];
  return raw is List ? [for (final v in raw) docText(v)] : const [];
}

num _ledgerBankSide(Map<String, dynamic> l) {
  final d = _amt(l['debit']);
  return d > 0.005 ? d : _amt(l['credit']);
}

int _daysBetween(String a, String b) {
  final da = DateTime.tryParse(a);
  final db = DateTime.tryParse(b);
  if (da == null || db == null) return 999;
  return dateOnly(da).difference(dateOnly(db)).inDays.abs();
}

bool _utrMatched(Map<String, dynamic> line, Map<String, dynamic> ledger) {
  final ext = line['extracted_references'];
  final refs = ext is Map && ext['long_numeric_refs'] is List ? [for (final r in ext['long_numeric_refs'] as List) docText(r)] : const <String>[];
  if (refs.isEmpty) return false;
  final text = '${docText(ledger['reference_number'])} ${docText(ledger['narration'])}';
  return refs.any((r) => r.isNotEmpty && text.contains(r));
}

/// The website's `suggestionHeadline`.
String reconSuggestionHeadline(Map<String, dynamic> s, Map<String, dynamic> line, Map<String, Map<String, dynamic>> ledgerById) {
  final flow = reconLineFlow(line);
  final main = advanceMoney(flow.amount);
  final ids = reconSuggestionLedgerIds(s);
  final le = ids.isEmpty ? null : ledgerById[ids.first];
  final tier = docText(s['tier']);
  if (tier == 'exact') {
    final dd = le == null ? 0 : _daysBetween(docText(line['transaction_date']), docText(le['entry_date']));
    return 'Exact match ($main, ${dd <= 2 ? 'date matched' : '${dd}d apart'})';
  }
  if (tier == 'reference') {
    if (le != null && _utrMatched(line, le)) return 'Reference match (UTR found)';
    return 'Reference match (text / reference similarity)';
  }
  if (le != null) return 'Fuzzy match ($main ≈ ${advanceMoney(_ledgerBankSide(le))})';
  return 'Fuzzy match ($main)';
}

/// `05 Oct 2026 · ATM charges #JV-1 · ₹118.00`.
String reconLedgerLabel(Map<String, dynamic> l) {
  final narr = docText(l['narration']).trim();
  final ref = docText(l['reference_number']);
  final what = '${narr.isEmpty ? 'Ledger entry' : (narr.length > 120 ? narr.substring(0, 120) : narr)}${ref.isEmpty ? '' : ' #$ref'}';
  return '${_day(l['entry_date'])} · $what · ${advanceMoney(_ledgerBankSide(l))}';
}

// ---------------------------------------------------------------------------------------------
// Summary and questions
// ---------------------------------------------------------------------------------------------

String _count(dynamic v) => (docNum(v) ?? 0).toInt().toString();

/// The server's `summary`, labelled. Nothing here is worked out on the phone.
List<(String, String)> reconSummaryRows(Map<String, dynamic> summary) => [
      ('Opening balance', advanceMoney(_amt(summary['opening_balance']))),
      ('Statement closing balance', advanceMoney(_amt(summary['closing_balance']))),
      ('Book balance', advanceMoney(_amt(summary['ledger_book_balance']))),
      ('Difference', advanceMoney(_amt(summary['reconciliation_difference']))),
      ('Matched', _count(summary['matched_count'])),
      ('Unmatched', _count(summary['unmatched_count'])),
      ('Ignored', _count(summary['ignored_count'])),
    ];

/// The question before a new ledger entry is posted: amount, date and both accounts.
String reconCreateQuestion({required Map<String, dynamic> line, required String type, required String accountName, required String bankName}) {
  final money = advanceMoney(reconLineFlow(line).amount);
  final date = _day(line['transaction_date']);
  final charge = type != 'interest';
  final what = charge ? 'a bank charge' : 'interest';
  final dr = charge ? accountName : bankName;
  final cr = charge ? bankName : accountName;
  return 'Post $what of $money dated $date: debit $dr, credit $cr. This statement line is then matched to it.';
}

/// The website's confirmation, asked always on the phone.
String reconCompleteQuestion(int unmatched) =>
    unmatched > 0 ? 'There are $unmatched unmatched line(s). Mark this statement as reconciled anyway?' : 'Mark this statement as reconciled?';

/// The server's count after Match automatically.
String reconAutoMatchToast(Map<String, dynamic> reply) => 'Auto-matched ${_count(reply['matched_count'])}, skipped ${_count(reply['skipped_count'])}';
