import '../../format.dart';
import '../docs/doc_logic.dart';
import '../reports/report_period.dart';
import 'advances_logic.dart' show advanceMoney;

/// Rules for fixed assets, provisions and TDS/TCS, copied from the website
/// (`app/(app)/fixed-assets/page.tsx`, `provisions/page.tsx`, `tds/*/page.tsx`) and the routes under
/// `app/api/fixed-assets`, `app/api/provisions` and `app/api/tds`. Every amount shown (book value,
/// accumulated depreciation, depreciation, gain or loss, balances, TDS) is the server's. The phone
/// never works one out.

/// Two decimals always, as the website's money columns show.
String assetsMoney(num n) => advanceMoney(n);

/// A typed amount (commas allowed) as a number, or null when it is not a number.
num? _typed(String text) => docNum(text.replaceAll(',', '').trim());

num? _positive(String text) {
  final n = _typed(text);
  return n == null || n <= 0 ? null : _clean(n);
}

num _clean(num n) => n == n.truncate() ? n.truncate() : n;

String _day(dynamic v) {
  final d = docDate(v);
  return d == null ? '' : ddMMMyyyy(d);
}

String _join(Iterable<String> parts) => parts.where((t) => t.isNotEmpty).join(' · ');

String _present(String? text) => (text ?? '').trim();

// ---------------------------------------------------------------------------------------------
// Fixed assets
// ---------------------------------------------------------------------------------------------

/// Companies Act 2013 Schedule II Part C categories (`lib/accounting/it-depreciation.ts`).
const kScheduleIi = <(String key, String label, int years)>[
  ('building_rcc', 'Buildings (RCC frame, other than factory)', 60),
  ('building_non_rcc', 'Buildings (non-RCC frame, other than factory)', 30),
  ('building_factory', 'Factory buildings', 30),
  ('building_temporary', 'Temporary structures', 3),
  ('plant_general', 'Plant and machinery - general (not continuous process)', 15),
  ('plant_continuous', 'Plant and machinery - continuous process plant', 25),
  ('furniture', 'Furniture and fittings', 10),
  ('electrical', 'Electrical installations and equipment', 10),
  ('office_equipment', 'Office equipment', 5),
  ('computer_end_user', 'Computers - end user devices (desktops, laptops)', 3),
  ('computer_server', 'Computers - servers and networks', 6),
  ('motor_car', 'Motor cars (other than hire business)', 8),
  ('motor_two_wheeler', 'Motor cycles, scooters and other mopeds', 10),
  ('motor_hire', 'Motor buses, lorries, taxis used in hire business', 6),
  ('motor_other', 'Motor buses, lorries and other vehicles', 8),
];

/// Income-tax blocks and their rates (`lib/accounting/it-depreciation.ts`).
const kItBlocks = <(String key, String label, num rate)>[
  ('building_residential', 'Building - residential', 5),
  ('building_other', 'Building - other than residential', 10),
  ('building_temporary', 'Building - purely temporary structures', 40),
  ('furniture', 'Furniture and fittings (incl. electrical fittings)', 10),
  ('plant_general', 'Plant and machinery - general', 15),
  ('motor_car', 'Motor cars (not used in hire business)', 15),
  ('motor_hire', 'Motor vehicles used in hire business', 30),
  ('computers', 'Computers and computer software', 40),
  ('books_annual', 'Books (annual publications) / professional books', 40),
  ('pollution_control', 'Pollution control / energy saving devices', 40),
  ('intangibles', 'Intangibles (know-how, patents, copyrights, licences)', 25),
];

/// "Paid from" choices of the add form.
const kAssetFunding = <(String, String)>[
  ('bank', 'Bank'),
  ('cash', 'Cash'),
  ('credit', 'On credit (Sundry creditors)'),
  ('opening', 'Opening balance (asset held before books start)'),
  ('purchase_bill', 'Already booked on a purchase bill (capital goods line)'),
];

int? scheduleIiYears(String key) {
  for (final c in kScheduleIi) {
    if (c.$1 == key) return c.$3;
  }
  return null;
}

/// The label of an Income-tax block or Schedule II category key; the key itself when unknown.
String itBlockLabel(String key) {
  for (final b in kItBlocks) {
    if (b.$1 == key) return b.$2;
  }
  return key;
}

String scheduleIiLabel(String key) {
  for (final c in kScheduleIi) {
    if (c.$1 == key) return c.$2;
  }
  return key;
}

String scheduleIiOptionLabel((String, String, int) c) => '${c.$2} (${c.$3} yrs)';

String itBlockOptionLabel((String, String, num) b) => '${b.$2} (${jsNumberString(b.$3)}%)';

String accountOptionLabel(Map<String, dynamic> a) => '${docText(a['account_code'])} · ${docText(a['account_name'])}';

List<Map<String, dynamic>> _accounts(dynamic body) => [
      for (final a in docRows(body, 'accounts'))
        if (docText(a['id']).isNotEmpty) a,
    ];

/// `GET /api/accounts?account_type=asset...`: the asset accounts the website offers for the cost: code
/// 12xx, not 1202 (accumulated depreciation).
List<Map<String, dynamic>> fixedAssetAccounts(dynamic assetAccountsBody) => [
      for (final a in _accounts(assetAccountsBody))
        if (docText(a['account_code']).startsWith('12') && docText(a['account_code']) != '1202') a,
    ];

/// The accounts sale proceeds can land in: code 11xx (cash and bank).
List<Map<String, dynamic>> proceedsAccounts(dynamic assetAccountsBody) => [
      for (final a in _accounts(assetAccountsBody))
        if (docText(a['account_code']).startsWith('11')) a,
    ];

List<Map<String, dynamic>> expenseAccounts(dynamic expenseAccountsBody) => _accounts(expenseAccountsBody);

/// The id of the account with this code, or '' (the website preselects 1201 and 5204).
String accountDefaultId(List<Map<String, dynamic>> accounts, String code) {
  for (final a in accounts) {
    if (docText(a['account_code']) == code) return docText(a['id']);
  }
  return '';
}

String assetRowTitle(Map<String, dynamic> a) {
  final n = docText(a['asset_name']);
  return n.isEmpty ? 'Asset' : n;
}

/// `WDV 15%` for a written-down-value asset with a rate, else `SLM 3y`.
String assetMethodLabel(Map<String, dynamic> a) {
  final method = docText(a['depreciation_method']);
  final rate = docNum(a['depreciation_rate']);
  if (method == 'WDV' && rate != null && rate != 0) return 'WDV ${jsNumberString(rate)}%';
  final life = docNum(a['useful_life_years']);
  return '$method ${life == null ? '' : '${jsNumberString(life)}y'}'.trim();
}

String assetRowSubtitle(Map<String, dynamic> a) => _join([docText(a['asset_code']), assetMethodLabel(a)]);

/// The "Depreciated to" column: the disposal, the date, or "Not yet".
String assetDepreciatedTo(Map<String, dynamic> a) {
  if (a['is_disposed'] == true) {
    final d = _day(a['disposal_date']);
    return d.isEmpty ? 'Disposed' : 'Disposed $d';
  }
  final last = _day(a['last_depreciated_to']);
  return last.isEmpty ? 'Not yet' : last;
}

/// Depreciate and Dispose show only for an asset that is not disposed.
bool assetCanAct(Map<String, dynamic> a) => a['is_disposed'] != true;

/// The first problem with the add form, in the website's order, or null when it can be posted.
String? fixedAssetProblem({
  required String code,
  required String name,
  required String costText,
  required String lifeText,
  required String residualText,
  required DateTime purchaseDate,
  required DateTime putToUseDate,
  required String accountId,
  required String depreciationAccountId,
}) {
  if (code.trim().isEmpty) return 'Enter the asset code';
  if (name.trim().isEmpty) return 'Enter the asset name';
  final cost = _positive(costText);
  if (cost == null) return 'Cost must be above zero';
  final life = _typed(lifeText);
  if (life == null || life < 1) return 'Enter the useful life in years';
  final residual = residualText.trim().isEmpty ? 0 : _typed(residualText);
  if (residual == null || residual < 0 || residual >= cost) return 'Residual value must be at least 0 and below the cost';
  if (ymd(putToUseDate).compareTo(ymd(purchaseDate)) < 0) return 'Put to use cannot be before the purchase date';
  if (accountId.isEmpty) return 'Choose the asset account';
  if (depreciationAccountId.isEmpty) return 'Choose the depreciation expense account';
  return null;
}

/// `POST /api/fixed-assets`. The server fills in the business, the branch and the user.
Map<String, dynamic> fixedAssetBody({
  required String code,
  required String name,
  required String scheduleIiCategory,
  required String itBlock,
  required DateTime purchaseDate,
  required DateTime putToUseDate,
  required String costText,
  required String residualText,
  required String method,
  required String lifeText,
  required String rateText,
  required String accountId,
  required String depreciationAccountId,
  required String funding,
  required String vendor,
  required String invoiceNumber,
}) {
  final rate = _positive(rateText);
  return {
    'asset_code': code.trim(),
    'asset_name': name.trim(),
    if (scheduleIiCategory.isNotEmpty) 'schedule_ii_category': scheduleIiCategory,
    if (itBlock.isNotEmpty) 'it_block': itBlock,
    'purchase_date': ymd(purchaseDate),
    'put_to_use_date': ymd(putToUseDate),
    'purchase_cost': _positive(costText) ?? 0,
    'residual_value': residualText.trim().isEmpty ? 0 : (_typed(residualText) ?? 0),
    'depreciation_method': method,
    'useful_life_years': _typed(lifeText) ?? 0,
    if (method == 'WDV' && rate != null) 'depreciation_rate': rate,
    'account_id': accountId,
    'depreciation_account_id': depreciationAccountId,
    'funding': funding,
    if (_present(vendor).isNotEmpty) 'vendor_name': vendor.trim(),
    if (_present(invoiceNumber).isNotEmpty) 'invoice_number': invoiceNumber.trim(),
  };
}

/// `POST /api/fixed-assets/[id]/depreciate`. The server works out where the period starts and how much.
Map<String, dynamic> depreciateBody(DateTime periodEnd) => {'period_end_date': ymd(periodEnd)};

String? disposeProblem(String amountText) {
  if (amountText.trim().isEmpty) return null;
  final n = _typed(amountText);
  if (n == null || n < 0) return 'Sale proceeds cannot be negative';
  return null;
}

/// `POST /api/fixed-assets/[id]/dispose`.
Map<String, dynamic> disposeBody({
  required DateTime date,
  required String amountText,
  required String proceedsAccountId,
  required String buyer,
  required String reason,
  required bool chargeDepreciation,
}) =>
    {
      'disposal_date': ymd(date),
      'disposal_amount': amountText.trim().isEmpty ? 0 : (_typed(amountText) ?? 0),
      if (proceedsAccountId.isNotEmpty) 'proceeds_account_id': proceedsAccountId,
      if (_present(buyer).isNotEmpty) 'buyer_name': buyer.trim(),
      if (_present(reason).isNotEmpty) 'reason': reason.trim(),
      'charge_depreciation': chargeDepreciation,
    };

/// The toast after Depreciate: the amount the server posted.
String depreciationDoneMessage(Map<String, dynamic> reply) {
  final dep = reply['depreciation'];
  final amount = dep is Map ? docNum(dep['amount']) : null;
  if (amount != null && amount > 0) return 'Depreciation of ${assetsMoney(amount)} posted';
  final message = docText(reply['message']);
  return message.isEmpty ? 'No depreciation due for this period' : message;
}

/// The toast after Dispose: the profit or loss the server worked out.
String disposalDoneMessage(Map<String, dynamic> reply) {
  final d = reply['disposal'];
  final gl = d is Map ? docNum(d['gainLoss']) : null;
  if (gl == null) return 'Asset disposed';
  return 'Asset disposed; ${gl >= 0 ? 'profit' : 'loss'} of ${assetsMoney(gl.abs())}';
}

String scheduleRowTitle(Map<String, dynamic> r) {
  final a = _day(r['period_start_date']);
  final b = _day(r['period_end_date']);
  return a.isEmpty && b.isEmpty ? 'Depreciation' : '$a – $b';
}

String scheduleRowSubtitle(Map<String, dynamic> r) {
  final open = docNum(r['opening_book_value']);
  final close = docNum(r['closing_book_value']);
  if (open == null || close == null) return '';
  return 'Opening ${assetsMoney(open)} → Closing ${assetsMoney(close)}';
}

// ---------------------------------------------------------------------------------------------
// Provisions
// ---------------------------------------------------------------------------------------------

const kProvisionTypes = <(String, String)>[
  ('bad_debts', 'Bad Debts'),
  ('warranty', 'Warranty'),
  ('gratuity', 'Gratuity'),
  ('leave_encashment', 'Leave Encashment'),
  ('employee_benefits', 'Employee Benefits'),
  ('litigation', 'Litigation'),
  ('others', 'Others'),
];

const kEntryTypes = <(String, String)>[
  ('addition', 'Addition'),
  ('reversal', 'Reversal'),
  ('utilization', 'Utilization'),
];

String provisionTypeLabel(String type) {
  for (final t in kProvisionTypes) {
    if (t.$1 == type) return t.$2;
  }
  final s = type.replaceAll('_', ' ');
  return s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);
}

String entryTypeLabel(String type) {
  for (final t in kEntryTypes) {
    if (t.$1 == type) return t.$2;
  }
  return type;
}

/// `financial_year` is the long form (`2026-2027`), how the server stores it.
String provisionsPath(String financialYear) => '/api/provisions?financial_year=$financialYear';

String provisionEntriesPath(String id, String financialYear) => '/api/provisions/$id/entries?financial_year=$financialYear';

String provisionRowTitle(Map<String, dynamic> p) {
  final n = docText(p['provision_name']);
  return n.isEmpty ? 'Provision' : n;
}

String provisionRowSubtitle(Map<String, dynamic> p) {
  final count = docNum(p['entries_count']);
  return _join([
    docText(p['provision_code']),
    provisionTypeLabel(docText(p['provision_type'])),
    if (count != null) '${jsNumberString(count)} ${count == 1 ? 'entry' : 'entries'}',
  ]);
}

String? provisionProblem({required String code, required String name, required String rateText}) {
  if (code.trim().isEmpty) return 'Enter the provision code';
  if (name.trim().isEmpty) return 'Enter the provision name';
  if (rateText.trim().isNotEmpty && _typed(rateText) == null) return 'Enter the rate as a number';
  return null;
}

/// `POST /api/provisions`. Blank accounts are left out: the server then uses its default provision and
/// expense accounts.
Map<String, dynamic> provisionCreateBody({
  required String code,
  required String name,
  required String type,
  required String provisionAccountId,
  required String expenseAccountId,
  required String method,
  required String rateText,
  required String description,
}) {
  final rate = _typed(rateText);
  return {
    'provision_code': code.trim(),
    'provision_name': name.trim(),
    'provision_type': type,
    if (provisionAccountId.isNotEmpty) 'provision_account_id': provisionAccountId,
    if (expenseAccountId.isNotEmpty) 'expense_account_id': expenseAccountId,
    if (_present(method).isNotEmpty) 'calculation_method': method.trim(),
    if (rate != null) 'calculation_rate': _clean(rate),
    if (_present(description).isNotEmpty) 'description': description.trim(),
  };
}

/// `PATCH /api/provisions/[id]`: the only fields the route updates. The code and accounts are not editable.
Map<String, dynamic> provisionUpdateBody({
  required String name,
  required String type,
  required String method,
  required String rateText,
  required String description,
}) {
  final rate = _typed(rateText);
  return {
    'provision_name': name.trim(),
    'provision_type': type,
    'calculation_method': method.trim(),
    'calculation_rate': rate == null ? null : _clean(rate),
    'description': description.trim(),
  };
}

/// `POST /api/provisions/[id]/entries`. The counter account is only for a utilization.
Map<String, dynamic> provisionEntryBody({
  required String financialYear,
  required DateTime date,
  required String type,
  required String amountText,
  required String narration,
  required String counterAccountId,
}) =>
    {
      'financial_year': financialYear,
      'entry_date': ymd(date),
      'entry_type': type,
      'amount': _positive(amountText) ?? 0,
      if (_present(narration).isNotEmpty) 'narration': narration.trim(),
      if (type == 'utilization' && counterAccountId.isNotEmpty) 'counter_account_id': counterAccountId,
    };

String? provisionEntryProblem({
  required String type,
  required String amountText,
  required String counterAccountId,
  required String provisionType,
}) {
  if (_positive(amountText) == null) return 'Enter an amount above zero';
  if (type == 'utilization' && counterAccountId.isEmpty && provisionType != 'bad_debts') {
    return 'Choose the account the cost is settled against';
  }
  return null;
}

bool entryIsAddition(Map<String, dynamic> e) => docText(e['entry_type']) == 'addition';

String entryRowTitle(Map<String, dynamic> e) => _join([entryTypeLabel(docText(e['entry_type'])), _day(e['entry_date'])]);

String entryRowSubtitle(Map<String, dynamic> e) {
  final open = docNum(e['opening_balance']);
  final close = docNum(e['closing_balance']);
  return _join([
    docText(e['narration']),
    if (open != null && close != null) 'Opening ${assetsMoney(open)} → Closing ${assetsMoney(close)}',
  ]);
}

// ---------------------------------------------------------------------------------------------
// TDS / TCS
// ---------------------------------------------------------------------------------------------

const kTdsQuarters = ['Q1', 'Q2', 'Q3', 'Q4'];

/// Five financial years, newest first, in the long form the server stores (`2026-2027`).
List<String> tdsYears(DateTime now) {
  final cur = FinancialYear.of(now);
  return [for (var i = 0; i < 5; i++) FinancialYear(cur.startYear - i).longCode];
}

/// The quarter the server files a date under (`app/api/tds/deduct/route.ts`).
String tdsQuarterOf(DateTime d) {
  final m = d.month;
  if (m >= 4 && m <= 6) return 'Q1';
  if (m >= 7 && m <= 9) return 'Q2';
  if (m >= 10) return 'Q3';
  return 'Q4';
}

String tdsListPath(String base, {required String fy, required String quarter, required bool? deposited}) {
  final q = [
    if (fy.isNotEmpty) 'financial_year=$fy',
    if (quarter.isNotEmpty) 'quarter=$quarter',
    if (deposited != null) 'is_deposited=$deposited',
  ];
  return q.isEmpty ? base : '$base?${q.join('&')}';
}

String tdsSummaryPath(String fy, String quarter) => '/api/tds/reports/summary?financial_year=$fy&quarter=$quarter';

/// Tiles from `GET /api/tds/reports/summary` (`summary` is one row for one year and quarter; the route
/// answers `[]` when there is nothing). All four figures are the server's.
List<(String, String)> tdsSummaryTiles(dynamic body) {
  final s = body is Map ? body['summary'] : null;
  if (s is! Map || s.isEmpty) return const [];
  String money(String key) => assetsMoney(docNum(s[key]) ?? 0);
  return [
    ('Transactions', enIn(docNum(s['transaction_count']) ?? 0, maxFraction: 0)),
    ('Total TDS', money('total_tds_amount')),
    ('Deposited', money('deposited_amount')),
    ('Pending', money('pending_amount')),
  ];
}

String tdsTransactionTitle(Map<String, dynamic> t) {
  final n = docText(t['supplier_name']);
  return n.isEmpty ? 'N/A' : n;
}

String tdsTransactionSubtitle(Map<String, dynamic> t) => _join([
      _day(t['transaction_date']),
      docText(t['section_name']),
      _join([docText(t['financial_year']), docText(t['quarter'])]).replaceAll(' · ', ' '),
    ]);

bool tdsTransactionDeposited(Map<String, dynamic> t) => t['is_deposited'] == true;

String? tdsPaymentProblem({
  required String financialYear,
  required String quarter,
  required String challan,
  required DateTime challanDate,
  required DateTime depositDate,
  required String amountText,
}) {
  if (financialYear.isEmpty) return 'Choose the financial year';
  if (quarter.isEmpty) return 'Choose the quarter';
  if (challan.trim().isEmpty) return 'Enter the challan number';
  if (_positive(amountText) == null) return 'Enter the TDS amount above zero';
  return null;
}

/// `POST /api/tds/payments`. The server records who made it.
Map<String, dynamic> tdsPaymentBody({
  required String financialYear,
  required String quarter,
  required String challan,
  required DateTime challanDate,
  required DateTime depositDate,
  required String amountText,
  required String bank,
  required String mode,
  required String reference,
  required String notes,
}) =>
    {
      'financial_year': financialYear,
      'quarter': quarter,
      'challan_number': challan.trim(),
      'challan_date': ymd(challanDate),
      'deposit_date': ymd(depositDate),
      'total_tds_amount': _positive(amountText) ?? 0,
      'bank_name': _present(bank).isEmpty ? null : bank.trim(),
      'payment_mode': _present(mode).isEmpty ? null : mode.trim(),
      'payment_reference': _present(reference).isEmpty ? null : reference.trim(),
      'notes': _present(notes).isEmpty ? null : notes.trim(),
    };

/// The question before a TDS payment posts. [serverPending] is `pending_amount` of the server's summary for
/// that year and quarter, or null when it could not be read.
String tdsPaymentAsk({
  required String amountText,
  required String challan,
  required String financialYear,
  required String quarter,
  required num? serverPending,
}) {
  final base = 'Record a TDS payment of ${assetsMoney(_positive(amountText) ?? 0)} against challan ${challan.trim()} for $financialYear $quarter? '
      'All pending TDS for that quarter is marked deposited.';
  return serverPending == null ? base : '$base The server shows ${assetsMoney(serverPending)} pending for it.';
}

String tdsPaymentTitle(Map<String, dynamic> p) {
  final n = docText(p['challan_number']);
  return n.isEmpty ? 'TDS payment' : n;
}

String tdsPaymentSubtitle(Map<String, dynamic> p) {
  final dep = _day(p['deposit_date']);
  return _join([
    dep.isEmpty ? '' : 'Deposited $dep',
    _join([docText(p['financial_year']), docText(p['quarter'])]).replaceAll(' · ', ' '),
    docText(p['bank_name']),
  ]);
}

String? tdsCertificateProblem({required String supplierId, required String financialYear, required String quarter}) {
  if (supplierId.isEmpty) return 'Choose a supplier';
  if (financialYear.isEmpty) return 'Choose the financial year';
  if (quarter.isEmpty) return 'Choose the quarter';
  return null;
}

/// `POST /api/tds/certificates`. The server adds up the deposited TDS and numbers the certificate.
Map<String, dynamic> tdsCertificateBody({
  required String supplierId,
  required String financialYear,
  required String quarter,
  required DateTime issueDate,
}) =>
    {
      'supplier_id': supplierId,
      'financial_year': financialYear,
      'quarter': quarter,
      'issue_date': ymd(issueDate),
    };

String tdsCertificateTitle(Map<String, dynamic> c) {
  final n = docText(c['certificate_number']);
  return n.isEmpty ? 'TDS certificate' : n;
}

String tdsCertificateSubtitle(Map<String, dynamic> c) => _join([
      docText(c['supplier_name']),
      _day(c['issue_date']),
      _join([docText(c['financial_year']), docText(c['quarter'])]).replaceAll(' · ', ' '),
    ]);

String tdsCertificateStatus(Map<String, dynamic> c) => c['is_issued'] == true ? 'Issued' : 'Draft';

String tdsCertificatePdfPath(String id) => '/api/tds/certificates/$id/pdf';

String? tdsCategoryProblem({required String code, required String name, required String rateText, String thresholdText = ''}) {
  if (code.trim().isEmpty || name.trim().isEmpty || rateText.trim().isEmpty) return 'Section code, section name, and rate are required';
  if (_typed(rateText) == null) return 'Enter the rate as a number';
  if (thresholdText.trim().isNotEmpty) {
    final t = _typed(thresholdText);
    if (t == null) return 'Enter the threshold as a number';
    if (t < 0) return 'Threshold cannot be negative';
  }
  return null;
}

/// `POST /api/tds/categories` and `PUT /api/tds/categories/[id]`.
Map<String, dynamic> tdsCategoryBody({
  required String code,
  required String name,
  required String description,
  required String rateText,
  required String thresholdText,
}) {
  final t = thresholdText.trim().isEmpty ? 0 : (_typed(thresholdText) ?? 0);
  return {
    'section_code': code.trim(),
    'section_name': name.trim(),
    'description': _present(description).isEmpty ? null : description.trim(),
    'rate': _clean(_typed(rateText) ?? 0),
    'threshold_amount': _clean(t),
  };
}

String tdsCategoryTitle(Map<String, dynamic> c) => _join([docText(c['section_code']), docText(c['section_name'])]);

String tdsCategorySubtitle(Map<String, dynamic> c) {
  final rate = docNum(c['rate']);
  final threshold = docNum(c['threshold_amount']);
  return _join([
    if (rate != null) 'Rate ${jsNumberString(rate)}%',
    if (threshold != null && threshold > 0) 'Threshold ${assetsMoney(threshold)}',
  ]);
}
