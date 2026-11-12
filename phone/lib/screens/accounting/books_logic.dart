import '../../format.dart';
import '../docs/doc_logic.dart';
import '../reports/report_period.dart';

/// Chart of accounts and ledger rules, copied from the website
/// (`components/accounts/AccountCreateForm.tsx`, `accounts/[id]/edit/page.tsx`,
/// `lib/accounting/account-hierarchy.ts`, `app/(app)/ledger/page.tsx`). Money in the ledger
/// (opening, closing, running balance, totals) is only ever the server's figure.

const kAccountTypes = <(String, String)>[
  ('asset', 'Assets'),
  ('liability', 'Liabilities'),
  ('income', 'Income'),
  ('expense', 'Expenses'),
  ('capital', 'Capital'),
];

/// The only nature the server accepts for a user-created account of this type.
String? natureForAccountType(String type) => switch (type) {
      'asset' || 'expense' => 'debit',
      'liability' || 'income' || 'capital' => 'credit',
      _ => null,
    };

const _codeFloor = {'asset': 1000, 'liability': 2000, 'capital': 3000, 'income': 4000, 'expense': 5000};

/// Next unused numeric code in the type's thousand-range (`suggestNextAccountCode` on the website).
String suggestNextAccountCode(List<String> existingCodes, String type) {
  final floor = _codeFloor[type] ?? 1000;
  final ceiling = floor + 1000;
  final used = {for (final c in existingCodes) c.trim()};
  var max = floor;
  for (final code in used) {
    if (!RegExp(r'^\d+$').hasMatch(code)) continue;
    final n = int.parse(code);
    if (n >= floor && n < ceiling && n > max) max = n;
  }
  var next = max + 1;
  while (next < ceiling && used.contains('$next')) {
    next += 1;
  }
  if (next >= ceiling || used.contains('$next')) {
    next = floor + 1;
    while (used.contains('$next')) {
      next += 1;
    }
  }
  return '$next';
}

/// The server marks seeded accounts `is_system`. Their code, name, group and balance are locked, so
/// the phone offers neither edit nor deactivate (the website hides both for them too).
bool accountIsSystem(Map<String, dynamic> row) => row['is_system'] == true;

bool accountCanEdit(Map<String, dynamic> row) => !accountIsSystem(row);

/// The website's "delete" is a deactivation and is disabled for an inactive account.
bool accountCanDeactivate(Map<String, dynamic> row) => !accountIsSystem(row) && row['is_active'] != false;

const _openingProblem = 'Opening balance must be zero or a positive amount.';

/// The opening amount typed, or null when it is not zero-or-more. Blank is zero.
num? _openingAmount(String text) {
  final t = text.trim();
  if (t.isEmpty) return 0;
  final n = docNum(t);
  return n == null || n < 0 ? null : n;
}

/// Money as the server stores it: two decimals, whole numbers stay whole.
num _round2(num n) {
  final r = (n * 100).round() / 100;
  return r == r.truncate() ? r.truncate() : r;
}

/// The first problem with the add form, in the website's order, or null when it can be posted.
String? accountCreateProblem({
  required String name,
  required String groupId,
  required String code,
  required String openingText,
  required bool subAccount,
  required String parentId,
}) {
  if (name.trim().isEmpty) return 'Account name is required';
  if (groupId.isEmpty) return 'Choose an account type';
  if (code.trim().isEmpty) return 'Enter an account code';
  if (subAccount && parentId.isEmpty) return 'Choose the parent account';
  if (_openingAmount(openingText) == null) return _openingProblem;
  return null;
}

/// `POST /api/accounts`. The code falls back to [suggestedCode]. The server fills in the business
/// and the user.
Map<String, dynamic> accountCreateBody({
  required String code,
  required String suggestedCode,
  required String name,
  required String type,
  required String groupId,
  required String? parentId,
  required String openingText,
  required String openingType,
}) {
  final typed = code.trim();
  return {
    'account_code': typed.isEmpty ? suggestedCode : typed,
    'account_name': name.trim(),
    'account_type': type,
    'account_group_id': groupId,
    'nature': natureForAccountType(type),
    'opening_balance': _round2(_openingAmount(openingText) ?? 0),
    'opening_balance_type': openingType,
    'parent_account_id': parentId == null || parentId.isEmpty ? null : parentId,
    'description': null,
    'sort_order': 0,
    'pl_section': null,
  };
}

/// `PATCH /api/accounts/[id]`: only the fields that differ from [old], as the website's edit page does.
/// The opening amount and its side are sent together.
Map<String, dynamic> accountEditChanges(
  Map<String, dynamic> old, {
  required String code,
  required String name,
  required String parentId,
  required String openingText,
  required String openingType,
  required String description,
  required bool active,
}) {
  final changes = <String, dynamic>{};
  if (description.trim() != docText(old['description']).trim()) {
    changes['description'] = description.trim().isEmpty ? null : description.trim();
  }
  if (active != (old['is_active'] != false)) changes['is_active'] = active;
  if (code.trim() != docText(old['account_code'])) changes['account_code'] = code.trim();
  if (name.trim() != docText(old['account_name'])) changes['account_name'] = name.trim();
  if (parentId != docText(old['parent_account_id'])) changes['parent_account_id'] = parentId.isEmpty ? null : parentId;
  final oldAmount = docNum(old['opening_balance']) ?? 0;
  final oldSide = docText(old['opening_balance_type']).isEmpty ? 'debit' : docText(old['opening_balance_type']);
  final amount = _openingAmount(openingText) ?? 0;
  if (amount != oldAmount || openingType != oldSide) {
    changes['opening_balance'] = _round2(amount);
    changes['opening_balance_type'] = openingType;
  }
  return changes;
}

/// The checks the website runs before saving an edit, or null.
String? accountEditProblem({required String code, required String name, required String openingText}) {
  if (code.trim().isEmpty || name.trim().isEmpty) return 'Account code and name are required.';
  if (_openingAmount(openingText) == null) return _openingProblem;
  return null;
}

/// One account group and the accounts under it.
class AccountSection {
  const AccountSection(this.name, this.rows);

  final String name;
  final List<Map<String, dynamic>> rows;
}

int _codeOrder(String a, String b) {
  final x = int.tryParse(a);
  final y = int.tryParse(b);
  if (x != null && y != null && x != y) return x.compareTo(y);
  return a.compareTo(b);
}

/// Accounts under their account group, groups in group-code order. [type] keeps one account type;
/// [query] matches name, code or group name, ignoring case. An account whose group is not in
/// [groups] sits under the name its row carries (`account_group_name`).
List<AccountSection> accountSections(
  List<Map<String, dynamic>> accounts,
  List<Map<String, dynamic>> groups, {
  String query = '',
  String type = '',
}) {
  final q = query.trim().toLowerCase();
  final byId = {for (final g in groups) docText(g['id']): g};
  final buckets = <String, List<Map<String, dynamic>>>{};
  final names = <String, String>{};
  final codes = <String, String>{};
  for (final a in accounts) {
    if (type.isNotEmpty && docText(a['account_type']) != type) continue;
    final groupId = docText(a['account_group_id']);
    final group = byId[groupId];
    final groupName = group != null ? docText(group['group_name']) : docText(a['account_group_name']);
    if (q.isNotEmpty &&
        !docText(a['account_name']).toLowerCase().contains(q) &&
        !docText(a['account_code']).toLowerCase().contains(q) &&
        !groupName.toLowerCase().contains(q)) {
      continue;
    }
    final key = group != null ? groupId : 'other:$groupName';
    buckets.putIfAbsent(key, () => []).add(a);
    names[key] = groupName.isEmpty ? 'Other' : groupName;
    codes[key] = group != null ? docText(group['group_code']) : '￿';
  }
  final keys = buckets.keys.toList()..sort((a, b) => codes[a] == codes[b] ? names[a]!.compareTo(names[b]!) : _codeOrder(codes[a]!, codes[b]!));
  return [for (final k in keys) AccountSection(names[k]!, buckets[k]!)];
}

/// A balance exactly as the server reports it: the closing figure and its Dr / Cr side.
typedef AccountBalance = ({num amount, String? side});

/// `GET /api/accounts/my-accounts` rows (`closing`, `balance_side`) by account id. Accounts the
/// reply leaves out have never been posted to and get no balance.
Map<String, AccountBalance> accountBalances(dynamic body) {
  return {
    for (final r in docRows(body, 'accounts'))
      if (docText(r['id']).isNotEmpty) docText(r['id']): (amount: docNum(r['closing']) ?? 0, side: docText(r['balance_side']).isEmpty ? null : docText(r['balance_side'])),
  };
}

/// `Dr ₹1,200.50` (the website's `sided`); zero or no side is a plain `₹0.00`. Null gives ''.
String sidedBalance(AccountBalance? b) {
  if (b == null) return '';
  if (b.side == null || b.amount == 0) return _twoDecimals(0);
  return '${b.side} ${_twoDecimals(b.amount)}';
}

String _twoDecimals(num n) {
  var t = enIn(n.abs(), maxFraction: 2);
  final dot = t.indexOf('.');
  if (dot == -1) {
    t = '$t.00';
  } else if (t.length - dot == 2) {
    t = '${t}0';
  }
  return '$rupeeSign$t';
}

/// A ledger figure (positive means the account's own side) with its Dr / Cr side, e.g. `Dr ₹1,200.00`.
/// Zero has no side.
String natureSidedAmount(num value, String nature) {
  if (value.abs() < 0.005) return _twoDecimals(0);
  final natural = nature == 'credit' ? 'Cr' : 'Dr';
  final other = natural == 'Dr' ? 'Cr' : 'Dr';
  return '${value > 0 ? natural : other} ${_twoDecimals(value)}';
}

/// Plain two-decimal money for a debit or credit column.
String ledgerMoney(num value) => _twoDecimals(value);

/// `GET /api/ledger/account/[id]`, which reads `from_date` and `to_date`.
String accountLedgerPath(String accountId, ReportPeriod p) => '/api/ledger/account/$accountId?${p.query}';

/// `GET /api/ledger/account/[id]/statement/pdf`, same period names.
String accountStatementPdfPath(String accountId, ReportPeriod p) => '/api/ledger/account/$accountId/statement/pdf?${p.query}';

/// `GET /api/ledger`, which reads `from_date`, `to_date`, `account_id`, `voucher_type`, `page`.
String ledgerPath(ReportPeriod p, {String? accountId, String? voucherType, int page = 1}) {
  final parts = [
    p.query,
    if (accountId != null && accountId.isNotEmpty) 'account_id=${Uri.encodeQueryComponent(accountId)}',
    if (voucherType != null && voucherType.isNotEmpty) 'voucher_type=${Uri.encodeQueryComponent(voucherType)}',
    'page=$page',
  ];
  return '/api/ledger?${parts.join('&')}';
}

/// The source screens a ledger row can open on the phone.
enum LedgerSource { invoice, purchase, payment, journal, none }

LedgerSource ledgerSourceOf(Map<String, dynamic> row) {
  if (docText(row['voucher_id']).isEmpty) return LedgerSource.none;
  return switch (docText(row['voucher_type'])) {
    'invoice' => LedgerSource.invoice,
    'purchase' => LedgerSource.purchase,
    'payment' => LedgerSource.payment,
    'journal' => LedgerSource.journal,
    _ => LedgerSource.none,
  };
}

/// The website's voucher type list (`app/(app)/ledger/page.tsx`).
const kVoucherTypes = <(String, String)>[
  ('invoice', 'Invoice'),
  ('payment', 'Payment'),
  ('purchase', 'Purchase'),
  ('expense', 'Expense'),
  ('journal', 'Journal'),
  ('contra', 'Contra'),
  ('opening_balance', 'Opening balance'),
  ('opening_stock', 'Opening stock'),
  ('credit_note', 'Credit note'),
  ('debit_note', 'Debit note'),
  ('purchase_return', 'Purchase return'),
  ('supplier_credit_note', 'Supplier credit note'),
  ('credit_note_refund', 'Credit note refund'),
  ('advance_receipt', 'Advance receipt'),
  ('advance_adjustment', 'Advance adjustment'),
  ('advance_refund', 'Advance refund'),
  ('gst_setoff', 'GST set-off'),
  ('gst_payment', 'GST payment'),
  ('gst_cash_deposit', 'GST cash deposit'),
  ('gst_cash_utilization', 'GST cash utilisation'),
  ('stock_adjustment', 'Stock adjustment'),
  ('itc_reversal', 'ITC reversal'),
  ('tds', 'TDS'),
  ('asset_purchase', 'Asset purchase'),
  ('depreciation', 'Depreciation'),
  ('asset_disposal', 'Asset disposal'),
  ('provision', 'Provision'),
  ('tax_provision', 'Tax provision'),
  ('inter_branch_receipt', 'Inter-branch receipt'),
  ('staff_wage_accrual', 'Staff wage accrual'),
  ('staff_wage_payment', 'Staff wage payment'),
  ('salary_advance', 'Salary advance'),
  ('salary_payment', 'Salary payment'),
];

String voucherLabel(String? type) {
  if (type == null || type.isEmpty) return '';
  for (final (v, label) in kVoucherTypes) {
    if (v == type) return label;
  }
  return type.replaceAll('_', ' ');
}

/// The voucher words of a ledger row: its `voucher_types` when the server merged several, else its `voucher_type`.
String ledgerVoucherWords(Map<String, dynamic> row) {
  final types = row['voucher_types'];
  final list = types is List && types.isNotEmpty ? [for (final t in types) docText(t)] : [docText(row['voucher_type'])];
  return list.where((t) => t.isNotEmpty).map(voucherLabel).join(' · ');
}

/// A group's name with its parent groups in front (`Current assets → Cash`), as the website's group picker shows it.
String groupPathLabel(List<Map<String, dynamic>> groups, Map<String, dynamic> group) {
  final byId = {for (final g in groups) docText(g['id']): g};
  final names = <String>[];
  final seen = <String>{};
  Map<String, dynamic>? cur = group;
  while (cur != null && seen.add(docText(cur['id']))) {
    names.insert(0, docText(cur['group_name']));
    cur = byId[docText(cur['parent_group_id'])];
  }
  return names.join(' → ');
}
