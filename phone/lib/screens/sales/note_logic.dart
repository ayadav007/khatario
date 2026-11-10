import '../../format.dart';
import '../docs/doc_logic.dart';

/// Credit notes and debit notes (`app/(app)/credit-notes/page.tsx`, `debit-notes/page.tsx`).
/// `GET /api/credit-notes` replies `{ creditNotes, pagination }` (50 a page, `?page=`, `?search=`);
/// `GET /api/debit-notes` replies `{ debitNotes }` in one piece. Rows are `cn.*` / `dn.*` plus
/// `customer_name` and `invoice_number`. The phone shows the figures the server stored; it never adds them up.

enum NoteAction { cancel, share }

String _numberKey(bool debit) => debit ? 'debit_note_number' : 'credit_note_number';

String noteTitle(Map<String, dynamic> row, {required bool debit}) {
  final n = docText(row[_numberKey(debit)]);
  return n.isEmpty ? (debit ? 'Debit note' : 'Credit note') : n;
}

/// `cancelled` once the note is cancelled, else the website's badge: the refund status of a credit note
/// (pending, refunded, adjusted) or the adjustment status of a debit note.
String noteStatus(Map<String, dynamic> row, {required bool debit}) {
  if (docText(row['status']).trim().toLowerCase() == 'cancelled') return 'cancelled';
  final s = docText(row[debit ? 'adjustment_status' : 'refund_status']).trim().toLowerCase();
  return s.isEmpty ? 'pending' : s;
}

bool noteIsCancelled(Map<String, dynamic> row) => docText(row['status']).trim().toLowerCase() == 'cancelled';

/// A cancelled note is final: the website's list shows Cancel only on notes that are not cancelled, and
/// its detail page offers the PDF either way. There is no Edit: `PUT` and `PATCH /api/<kind>/[id]` always
/// answer 405 ("cancel the document and record a new one").
List<NoteAction> noteActions(Map<String, dynamic> row) => [
      if (!noteIsCancelled(row)) NoteAction.cancel,
      NoteAction.share,
    ];

/// "Oct 2026" or "Oct 2026 – Dec 2026", the website's `supplyPeriodLabel`.
String? noteSupplyPeriod(Map<String, dynamic> row) {
  final from = docDate(row['supply_period_from']);
  final to = docDate(row['supply_period_to']);
  if (from == null || to == null) return null;
  String month(DateTime d) => ddMMMyyyy(d).substring(3);
  final a = month(from), b = month(to);
  return a == b ? a : '$a – $b';
}

bool noteIsDiscount(Map<String, dynamic> row) => docText(row['note_type']) == 'post_sale_discount';

/// "Asha · INV-5 · 01 Nov 2026". A post-sale discount shows its supply period instead of an invoice.
String noteSubtitle(Map<String, dynamic> row, {required bool debit}) {
  final name = docText(row['customer_name']);
  final date = docDate(row[debit ? 'debit_note_date' : 'credit_note_date']);
  final invoice = docText(row['invoice_number']);
  return [
    name.isEmpty ? 'No customer' : name,
    if (!debit && noteIsDiscount(row)) 'Discount ${noteSupplyPeriod(row) ?? ''}'.trim() else if (invoice.isNotEmpty) invoice,
    if (date != null) ddMMMyyyy(date),
  ].join(' · ');
}

/// `{ reason }`, the only thing the cancel route reads (the session names the user and the business).
/// Null for a blank reason: the website will not cancel without one.
Map<String, dynamic>? noteCancelBody(String reason) {
  final r = reason.trim();
  return r.isEmpty ? null : {'reason': r};
}

/// The website's cancel prompt, naming the note and its amount.
String noteCancelText(String number, num amount, {required bool debit}) => debit
    ? 'Cancel debit note $number (${inr(amount, maxFraction: 2)})? The books and the amount the customer owes will be reversed. Stock is put back only if this note took it out.'
    : 'Cancel credit note $number (${inr(amount, maxFraction: 2)})? Returned stock, the customer balance and the books will be reversed.';

String noteCancelledToast(String number, {required bool debit}) => '${debit ? 'Debit' : 'Credit'} note $number cancelled';

/// "2 PCS × ₹500 · GST 18%".
String noteLineSubtitle(Map<String, dynamic> line) {
  final qty = docNum(line['qty'] ?? line['quantity']) ?? 0;
  final unit = docText(line['unit']);
  final price = docNum(line['unit_price']) ?? 0;
  final rate = docNum(line['tax_rate']) ?? 0;
  return [
    '${jsNumberString(qty)}${unit.isEmpty ? '' : ' $unit'} × ${inr(price, maxFraction: 2)}',
    if (rate > 0) 'GST ${jsNumberString(rate)}%',
  ].join(' · ');
}
