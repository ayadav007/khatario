import '../../format.dart';
import '../docs/doc_logic.dart';

/// Rules for contra entries and advances, copied from the website (`app/(app)/contra/page.tsx`,
/// `app/(app)/advances/page.tsx`) and the routes under `app/api/contra` and `app/api/advances`.
/// Every amount shown is the server's. In particular the phone never works out how much of an advance
/// is left: the route sends `remaining`, and Adjust and Refund only appear while it is above zero.

num _clean(num n) => n == n.truncate() ? n.truncate() : n;

/// The amount typed, or null when it is not above zero.
num? _positive(String text) {
  final n = docNum(text.trim());
  return n == null || n <= 0 ? null : _clean(n);
}

/// `₹1,250.50`: two decimals always, as the website's money columns show.
String advanceMoney(num n) {
  var t = enIn(n.abs(), maxFraction: 2);
  final dot = t.indexOf('.');
  if (dot == -1) {
    t = '$t.00';
  } else if (t.length - dot == 2) {
    t = '${t}0';
  }
  return '${n < 0 ? '-' : ''}$rupeeSign$t';
}

String _day(dynamic v) {
  final d = docDate(v);
  return d == null ? '' : ddMMMyyyy(d);
}

// ---------------------------------------------------------------------------------------------
// Contra
// ---------------------------------------------------------------------------------------------

/// `accounts` of `GET /api/contra` (and `/api/advances`): the cash and bank accounts the server allows.
List<Map<String, dynamic>> contraAccounts(dynamic body) => [
      for (final a in docRows(body, 'accounts'))
        if (docText(a['id']).isNotEmpty) a,
    ];

bool _isCash(Map<String, dynamic>? a) => a != null && docText(a['kind']) == 'cash';

/// `1101 · Cash in hand (Cash)`.
String contraAccountLabel(Map<String, dynamic> a) => '${docText(a['code'])} · ${docText(a['name'])} (${_isCash(a) ? 'Cash' : 'Bank'})';

/// The line under the website's contra form.
String contraKindLabel(Map<String, dynamic>? from, Map<String, dynamic>? to) {
  if (from == null || to == null) return '';
  if (_isCash(from) && _isCash(to)) return 'Cash-to-cash is not a contra entry';
  if (_isCash(from)) return 'Cash deposit into bank';
  if (_isCash(to)) return 'Cash withdrawal from bank';
  return 'Bank-to-bank transfer';
}

/// The To list leaves out the chosen From account.
List<Map<String, dynamic>> contraToChoices(List<Map<String, dynamic>> accounts, String fromId) => [
      for (final a in accounts)
        if (fromId.isEmpty || docText(a['id']) != fromId) a,
    ];

/// Why the contra cannot be posted yet, or null. The website disables the button for cash to cash.
String? contraProblem({required Map<String, dynamic>? from, required Map<String, dynamic>? to, required String amountText}) {
  if (from == null) return 'Choose the account the money leaves';
  if (to == null) return 'Choose the account the money arrives in';
  if (docText(from['id']) == docText(to['id'])) return 'From and To accounts must be different';
  if (_isCash(from) && _isCash(to)) return 'Cash-to-cash is not a contra entry';
  if (_positive(amountText) == null) return 'Enter an amount above zero';
  return null;
}

/// `POST /api/contra`. The server fills in the business, the user and the default branch.
Map<String, dynamic> contraBody({
  required DateTime date,
  required String fromId,
  required String toId,
  required String amountText,
  required String reference,
  required String narration,
}) =>
    {
      'entry_date': ymd(date),
      'from_account_id': fromId,
      'to_account_id': toId,
      'amount': _positive(amountText) ?? 0,
      if (reference.trim().isNotEmpty) 'reference_number': reference.trim(),
      if (narration.trim().isNotEmpty) 'narration': narration.trim(),
    };

String contraRowTitle(Map<String, dynamic> v) {
  final n = docText(v['voucher_number']);
  return n.isEmpty ? 'Contra entry' : n;
}

String contraRowSubtitle(Map<String, dynamic> v) {
  final move = [docText(v['from_account']), docText(v['to_account'])].where((t) => t.isNotEmpty).join(' → ');
  return [move, docText(v['reference_number'])].where((t) => t.isNotEmpty).join(' · ');
}

// ---------------------------------------------------------------------------------------------
// Advances
// ---------------------------------------------------------------------------------------------

/// "From customers" (`received`, a receipt voucher) or "To suppliers" (`paid`).
enum AdvanceSide { received, paid }

String advancesPath(AdvanceSide side) => '/api/advances?type=${side.name}';

/// The website's `open` test on the server's `remaining`: Adjust and Refund show only then.
bool advanceIsOpen(Map<String, dynamic> a) => (docNum(a['remaining']) ?? 0) > 0.005;

String advanceRowTitle(Map<String, dynamic> a) {
  final p = docText(a['party_name']);
  return p.isEmpty ? 'Advance' : p;
}

String advanceRowSubtitle(Map<String, dynamic> a) => [docText(a['voucher_number']), _day(a['payment_date'])].where((t) => t.isNotEmpty).join(' · ');

/// The website's GST rate list for an advance: its slabs above zero.
const kAdvanceGstRates = <num>[0.1, 0.25, 1.5, 3, 5, 18, 40];

String advancePartyWord(AdvanceSide side) => side == AdvanceSide.received ? 'customer' : 'supplier';

/// The first thing missing from a new advance, or null.
String? advanceProblem({required AdvanceSide side, required String partyId, required String amountText, required String accountId}) {
  if (partyId.isEmpty) return 'Choose a ${advancePartyWord(side)}';
  if (_positive(amountText) == null) return 'Enter an amount above zero';
  if (accountId.isEmpty) return 'Choose the account the money moves through';
  return null;
}

/// `POST /api/advances`, as the website's form sends it: `supply_type` and `tax_rate` are always the
/// form's values. The form's boxes for them show only for a customer advance, so a supplier advance
/// carries the form's defaults (`services`, 18); the server ignores GST on it, and the stored row matches
/// one made on the website.
Map<String, dynamic> advanceBody({
  required AdvanceSide side,
  required String partyId,
  required String amountText,
  required DateTime date,
  required String supplyType,
  required num taxRate,
  required String accountId,
  required String reference,
  required String notes,
}) {
  return {
    'type': side.name,
    if (side == AdvanceSide.received) 'customer_id': partyId else 'supplier_id': partyId,
    'amount': _positive(amountText) ?? 0,
    'payment_date': ymd(date),
    'supply_type': supplyType,
    'tax_rate': taxRate,
    'payment_account_id': accountId,
    'reference_number': reference.trim().isEmpty ? null : reference.trim(),
    'notes': notes.trim().isEmpty ? null : notes.trim(),
  };
}

/// `POST /api/advances/[id]/adjust`: an invoice for a customer advance, a purchase bill for a supplier one.
Map<String, dynamic> adjustBody({required AdvanceSide side, required String documentId, required String amountText, required DateTime date}) => {
      if (side == AdvanceSide.received) 'invoice_id': documentId else 'purchase_id': documentId,
      'amount': _positive(amountText) ?? 0,
      'adjustment_date': ymd(date),
    };

/// `POST /api/advances/[id]/refund`.
Map<String, dynamic> refundBody({required String amountText, required DateTime date, required String accountId}) => {
      'amount': _positive(amountText) ?? 0,
      'refund_date': ymd(date),
      'payment_account_id': accountId,
    };

/// `open_documents` of `GET /api/advances/[id]` as pick options: `INV-1 · 2026-10-01 · due ₹700.00`.
List<(String, String)> advanceDocOptions(List<Map<String, dynamic>> docs) => [
      for (final d in docs)
        if (docText(d['id']).isNotEmpty) (docText(d['id']), '${docText(d['number'])} · ${docText(d['date'])} · due ${advanceMoney(docNum(d['balance_amount']) ?? 0)}'),
    ];

/// What the website puts in the amount box: the unadjusted amount, cut to the chosen document's balance.
/// Both figures are the server's; the server checks the amount again when it is posted.
String adjustDefaultAmount(Map<String, dynamic> advance, Map<String, dynamic>? doc) {
  final remaining = docNum(advance['remaining']) ?? 0;
  final balance = doc == null ? null : docNum(doc['balance_amount']);
  final n = balance == null || balance > remaining ? remaining : balance;
  return jsNumberString(_clean(n));
}

String advanceAdjustmentTitle(Map<String, dynamic> a) {
  switch (docText(a['kind'])) {
    case 'refund':
      return 'Refund';
    case 'purchase':
      return 'Adjusted against ${docText(a['bill_number'])}'.trim();
    default:
      return 'Adjusted against ${docText(a['invoice_number'])}'.trim();
  }
}

String advanceAdjustmentSubtitle(Map<String, dynamic> a) {
  final reversed = docText(a['reversed_at']).isNotEmpty;
  return [_day(a['adjustment_date']), if (reversed) 'Reversed' else docText(a['voucher_number'])].where((t) => t.isNotEmpty).join(' · ');
}
