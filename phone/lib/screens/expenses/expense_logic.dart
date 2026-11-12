import '../../format.dart';
import '../docs/doc_logic.dart';

/// Body builders and checks for the expense form (`expenses/new/page.tsx`, `POST /api/expenses`,
/// `PUT /api/expenses/[id]`, `POST /api/expenses/preview`). Identity (business, user, creator) is
/// never sent: the server takes it from the session. The phone never works out GST: a bill is one
/// line (the chosen expense item, quantity 1, the typed amount, the chosen rate) and the totals
/// come from the server's preview.

/// `GST_RATE_SLABS` plus 28 (the website's `RATE_OPTIONS`, `lib/gst/rates.ts`).
const kGstRates = <num>[0, 0.1, 0.25, 1.5, 3, 5, 18, 28, 40];

/// The website's Payment options, value and label.
const kExpenseModes = <(String, String)>[
  ('cash', 'Paid — Cash'),
  ('upi', 'Paid — UPI'),
  ('bank_transfer', 'Paid — Bank transfer'),
  ('on_account', 'Bill received, not paid yet'),
];

String rateLabel(num rate) => '${jsNumberString(rate)}%';

String _s(dynamic v) => v?.toString().trim() ?? '';

/// An amount typed in the form: positive and finite, else null.
num? parseExpenseAmount(String text) {
  final n = num.tryParse(text.trim());
  if (n == null || !n.isFinite || n <= 0) return null;
  return n;
}

/// Whole amounts go out as integers (`1180`, not `1180.0`).
num _plain(num n) => n == n.truncate() ? n.truncate() : n;

class ExpenseErrors {
  const ExpenseErrors({this.category, this.item, this.amount, this.account});

  final String? category, item, amount, account;

  bool get ok => category == null && item == null && amount == null && account == null;
}

/// The website needs a category, and an item and amount (it refuses a bill without lines). A null
/// [itemId] means an expense that was saved as one amount, which has no item to choose.
/// [accountRequired] is the settlement route's `selection_required`.
ExpenseErrors validateExpense({
  required String categoryId,
  required String? itemId,
  required String amount,
  bool accountRequired = false,
  String accountId = '',
}) {
  return ExpenseErrors(
    category: categoryId.trim().isEmpty ? 'Choose a category' : null,
    item: itemId != null && itemId.trim().isEmpty ? 'Choose an expense item' : null,
    amount: parseExpenseAmount(amount) == null ? 'Enter an amount greater than zero' : null,
    account: accountRequired && accountId.trim().isEmpty ? 'Choose the cash or bank account' : null,
  );
}

Map<String, dynamic> _line(String itemId, num amount, num rate) => {
      'expense_item_id': itemId,
      'quantity': 1,
      'unit_price': _plain(amount),
      'tax_rate': _plain(rate),
    };

/// Create body. [amount] is already validated.
Map<String, dynamic> expenseBody({
  required String? branchId,
  required String categoryId,
  required String itemId,
  required String amount,
  required num rate,
  required bool includesGst,
  required String supplierId,
  required String mode,
  required String accountId,
  required DateTime date,
  required String reference,
  required String description,
  required String idempotencyKey,
}) {
  return {
    if (branchId != null && branchId.isNotEmpty) 'branch_id': branchId,
    'category_id': categoryId,
    'expense_date': ymd(date),
    'reference_number': reference.trim().isEmpty ? null : reference.trim(),
    'description': description.trim(),
    'payment_mode': mode,
    'settlement_account_id': accountId.isEmpty ? null : accountId,
    'supplier_id': supplierId.isEmpty ? null : supplierId,
    'prices_include_gst': includesGst,
    'lines': [_line(itemId, parseExpenseAmount(amount) ?? 0, rate)],
    'idempotency_key': idempotencyKey,
  };
}

List<Map<String, dynamic>> _savedLines(Map<String, dynamic> existing) {
  final raw = existing['lines'];
  return raw is List
      ? [
          for (final l in raw)
            if (l is Map) Map<String, dynamic>.from(l),
        ]
      : const [];
}

/// Edit body: only what changed, plus what the server needs to accept it. `PUT` refuses a bill
/// that has lines unless the lines come with the edit, so [lines] go out whenever anything
/// changed (a many-line bill goes back as it was); `expected_updated_at` is the version the
/// edit started from. Empty when nothing changed.
///
/// [itemId] is null when the expense has no single item line (saved as one amount, or several
/// lines the phone does not edit).
Map<String, dynamic> expenseEditBody({
  required Map<String, dynamic> existing,
  required String categoryId,
  required String? itemId,
  required String amount,
  required num rate,
  required bool includesGst,
  required String supplierId,
  required String mode,
  required String accountId,
  required DateTime date,
  required String reference,
  required String description,
}) {
  final body = <String, dynamic>{};
  if (categoryId != _s(existing['category_id'])) body['category_id'] = categoryId;
  final was = _s(existing['expense_date']);
  if (ymd(date) != (was.length >= 10 ? was.substring(0, 10) : was)) body['expense_date'] = ymd(date);
  if (reference.trim() != _s(existing['reference_number'])) body['reference_number'] = reference.trim().isEmpty ? null : reference.trim();
  if (description.trim() != _s(existing['description'])) body['description'] = description.trim();
  if (mode != _s(existing['payment_mode'])) body['payment_mode'] = mode;
  if (accountId != _s(existing['settlement_account_id'])) body['settlement_account_id'] = accountId.isEmpty ? null : accountId;
  if (supplierId != _s(existing['supplier_id'])) body['supplier_id'] = supplierId.isEmpty ? null : supplierId;
  if (includesGst != (existing['prices_include_gst'] == true)) body['prices_include_gst'] = includesGst;

  final saved = _savedLines(existing);
  final typed = parseExpenseAmount(amount) ?? 0;
  List<Map<String, dynamic>>? lines;
  if (saved.isEmpty) {
    final was = docNum(existing['amount']) ?? 0;
    if (typed != was) body['amount'] = _plain(typed);
  } else if (saved.length == 1 && itemId != null) {
    final l = saved.first;
    final same = itemId == _s(l['expense_item_id']) && typed == (docNum(l['unit_price']) ?? 0) && rate == (docNum(l['tax_rate']) ?? 0);
    if (!same) body['lines'] = [_line(itemId, typed, rate)];
    lines = [_line(itemId, typed, rate)];
  } else {
    lines = [
      for (final l in saved)
        {
          'expense_item_id': _s(l['expense_item_id']),
          'quantity': _plain(docNum(l['quantity']) ?? 1),
          'unit_price': _plain(docNum(l['unit_price']) ?? 0),
          'tax_rate': _plain(docNum(l['tax_rate']) ?? 0),
        },
    ];
  }

  if (body.isEmpty) return const {};
  if (lines != null) body['lines'] = lines;
  final version = _s(existing['updated_at']);
  if (version.isNotEmpty) body['expected_updated_at'] = version;
  return body;
}

/// `POST /api/expenses/preview` body, or null until there is a category, an item and an amount.
Map<String, dynamic>? expensePreviewBody({
  required String categoryId,
  required String? itemId,
  required String amount,
  required num rate,
  required bool includesGst,
  required String supplierId,
  required String mode,
  required String accountId,
  required DateTime date,
  required String description,
}) {
  final typed = parseExpenseAmount(amount);
  if (categoryId.isEmpty || itemId == null || itemId.isEmpty || typed == null) return null;
  return {
    'category_id': categoryId,
    'expense_date': ymd(date),
    'payment_mode': mode,
    'settlement_account_id': accountId.isEmpty ? null : accountId,
    'supplier_id': supplierId.isEmpty ? null : supplierId,
    'description': description.trim(),
    'prices_include_gst': includesGst,
    'lines': [_line(itemId, typed, rate)],
  };
}

/// The server's `bill` from a preview reply, exactly as sent.
class ExpenseBill {
  const ExpenseBill({required this.amount, required this.cgst, required this.sgst, required this.igst, required this.intraState});

  final num amount, cgst, sgst, igst;
  final bool intraState;
}

ExpenseBill? readExpenseBill(dynamic reply) {
  final bill = readPath(reply, 'bill');
  if (bill is! Map) return null;
  final amount = docNum(bill['amount']);
  if (amount == null) return null;
  return ExpenseBill(
    amount: amount,
    cgst: docNum(bill['cgst']) ?? 0,
    sgst: docNum(bill['sgst']) ?? 0,
    igst: docNum(bill['igst']) ?? 0,
    intraState: bill['intra_state'] == true,
  );
}

String expenseModeLabel(String mode) {
  return switch (mode.trim().toLowerCase()) {
    '' || 'cash' => 'Cash',
    'upi' => 'UPI',
    'bank_transfer' || 'bank' => 'Bank transfer',
    'on_account' || 'pay_later' || 'unpaid' || 'credit' => 'On account (unpaid)',
    final other => other[0].toUpperCase() + other.substring(1).replaceAll('_', ' '),
  };
}

bool isOnAccountMode(String mode) => const {'on_account', 'pay_later', 'unpaid', 'credit'}.contains(mode.trim().toLowerCase());

/// A row's heading: its description, else its category.
String expenseTitle(Map<String, dynamic> row) {
  final description = docText(row['description']).trim();
  if (description.isNotEmpty) return description;
  final category = docText(row['category_name']).trim();
  return category.isNotEmpty ? category : 'Expense';
}

/// Under the heading: the category (unless it is the heading) and how it was paid.
String expenseSubtitle(Map<String, dynamic> row) {
  final category = docText(row['category_name']).trim();
  final showCategory = category.isNotEmpty && docText(row['description']).trim().isNotEmpty;
  return [if (showCategory) category, expenseModeLabel(docText(row['payment_mode']))].join(' · ');
}
