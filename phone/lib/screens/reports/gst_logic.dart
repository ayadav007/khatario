import '../../format.dart';
import '../docs/doc_logic.dart';
import 'report_period.dart';
import 'table_report_screen.dart';

/// Rules for the GST screens, copied from the website pages under `app/(app)/reports/gst/*` and
/// `app/(app)/eway-bills` and the routes they call. Every GST amount, section total and difference on
/// these screens is the server's; nothing here adds tax up.

// ---------------------------------------------------------------------------------------------
// Period names. The routes disagree, so each path is built here and tested.
// ---------------------------------------------------------------------------------------------

/// `2026-09`, the `filing_period` / `period` the GST routes want.
String gstPeriodKey(MonthPeriod m) => '${m.year}-${m.month.toString().padLeft(2, '0')}';

/// The last day of the month, `2026-09-30` (the `as_on_date` the website's GSTR-3B asks the cash ledger for).
String gstMonthEnd(MonthPeriod m) => ymd(DateTime(m.year, m.month + 1, 0));

/// `GET /api/reports/gst/gstr1` reads `month`, `year` and `customer_type` (all, b2b or b2c).
String gstr1Path(MonthPeriod m, String customerType) => '/api/reports/gst/gstr1?${m.query}&customer_type=$customerType';

/// `GET /api/reports/gst/gstr3b` and `.../gstr2b` read `month` and `year`.
String gstr3bPath(MonthPeriod m) => '/api/reports/gst/gstr3b?${m.query}';
String gstr2bPath(MonthPeriod m) => '/api/reports/gst/gstr2b?${m.query}';

/// `GET /api/gst/gstr2b/reconcile` reads `filing_period`. The business is the session's (the route accepts a
/// missing `business_id` and refuses a mismatching one), so the phone does not send it.
String gstr2bReconcilePath(MonthPeriod m) => '/api/gst/gstr2b/reconcile?filing_period=${gstPeriodKey(m)}';

/// `GET /api/reports/gst/reconciliation` reads `period=YYYY-MM` and `mode`.
String gstReconciliationPath(MonthPeriod m, String mode) => '/api/reports/gst/reconciliation?period=${gstPeriodKey(m)}&mode=$mode';

/// `GET /api/gst/cash-ledger` needs `as_on_date`. A user with a branch sees that branch; the others see every
/// branch together (`consolidated=1`), as the website does when no branch is chosen.
String gstCashLedgerPath(DateTime asOn, {String? branchId}) =>
    '/api/gst/cash-ledger?as_on_date=${ymd(asOn)}&${branchId == null || branchId.isEmpty ? 'consolidated=1' : 'branch_id=${Uri.encodeQueryComponent(branchId)}'}';

const gstr1ExcelBase = '/api/reports/gst/gstr1/export/excel';

String gstr1ExcelPath(MonthPeriod m) => '$gstr1ExcelBase?${m.query}';

String gstr1ExcelName(MonthPeriod m) => 'GSTR1_${m.month.toString().padLeft(2, '0')}_${m.year}.xlsx';

/// `GET /api/gst/return-readiness?kind=gstr1&period=2026-09`, asked before a portal file is built.
String gstReadinessPath(String kind, MonthPeriod m) => '/api/gst/return-readiness?kind=$kind&period=${gstPeriodKey(m)}';

/// The website's download gate (`lib/gst/confirm-return-download.ts`). A block stops the file. Items that need an
/// acknowledgement are reviewed and acknowledged on the website, so the phone stops there too.
({bool ok, String? message}) gstReadinessGate(dynamic body) {
  if (body is Map && body['blocked'] == true) {
    return (
      ok: false,
      message: 'Download is stopped because a GSTIN or a required portal field is invalid. The on-screen report is still available. This is not a filing mark.',
    );
  }
  final needs = body is Map ? body['needsAcknowledgement'] : null;
  if (needs is List && needs.isNotEmpty) {
    return (ok: false, message: 'This return has items to review first. Open the GSTR-1 page on the website, review them, then download.');
  }
  return (ok: true, message: null);
}

// ---------------------------------------------------------------------------------------------
// GSTR-1
// ---------------------------------------------------------------------------------------------

const gstr1CustomerTypes = <(String, String)>[('all', 'All types'), ('b2b', 'B2B only'), ('b2c', 'B2C only')];

String _text(Map<String, dynamic> r, String k) => docText(r[k]);

String _join(Iterable<String> parts) => parts.where((p) => p.trim().isNotEmpty).join(' · ');

String _money(dynamic v) => reportCellText(v, money: true);

String _rate(dynamic v) {
  final n = docNum(v);
  return n == null ? '' : '${enIn(n, maxFraction: 2)}%';
}

/// One section of the GSTR-1 reply (a tab on the website) and how its rows read on the phone.
class Gstr1Section {
  const Gstr1Section({
    required this.key,
    required this.title,
    required this.emptyText,
    required this.rowTitle,
    required this.rowSubtitle,
    required this.rowAmount,
    required this.columns,
  });

  /// The reply key: `b2b`, `b2cl`, `b2cs`, `exports`, `sez`, `cdn`, `nil` or `hsn`.
  final String key, title, emptyText;
  final String Function(Map<String, dynamic>) rowTitle, rowSubtitle, rowAmount;
  final List<ReportColumn> columns;
}

const _tax = [
  ReportColumn('IGST', 'igst_amount', money: true),
  ReportColumn('CGST', 'cgst_amount', money: true),
  ReportColumn('SGST', 'sgst_amount', money: true),
];

/// The tabs of `app/(app)/reports/gst/gstr1/page.tsx`, in its order, with its columns and labels.
final gstr1Sections = <Gstr1Section>[
  Gstr1Section(
    key: 'b2b',
    title: 'B2B invoices',
    emptyText: 'No B2B invoices found',
    rowTitle: (r) => _text(r, 'invoice_number'),
    rowSubtitle: (r) => _join([_text(r, 'gstin'), _text(r, 'invoice_date'), _rate(r['rate'])]),
    rowAmount: (r) => _money(r['taxable_value']),
    columns: const [
      ReportColumn('GSTIN', 'gstin'),
      ReportColumn('Receiver', 'receiver_name'),
      ReportColumn('Invoice no', 'invoice_number'),
      ReportColumn('Date', 'invoice_date'),
      ReportColumn('Invoice value', 'invoice_value', money: true),
      ReportColumn('Rate (%)', 'rate', qty: true),
      ReportColumn('Taxable', 'taxable_value', money: true),
      ..._tax,
      ReportColumn('Place of supply', 'place_of_supply'),
      ReportColumn('Reverse charge', 'reverse_charge'),
    ],
  ),
  Gstr1Section(
    key: 'b2cl',
    title: 'B2C large',
    emptyText: 'No B2C Large invoices found',
    rowTitle: (r) => _text(r, 'invoice_number'),
    rowSubtitle: (r) => _join([_text(r, 'invoice_date'), _text(r, 'place_of_supply'), _rate(r['rate'])]),
    rowAmount: (r) => _money(r['taxable_value']),
    columns: const [
      ReportColumn('Invoice no', 'invoice_number'),
      ReportColumn('Date', 'invoice_date'),
      ReportColumn('Invoice value', 'invoice_value', money: true),
      ReportColumn('Rate (%)', 'rate', qty: true),
      ReportColumn('Taxable', 'taxable_value', money: true),
      ReportColumn('IGST', 'igst_amount', money: true),
      ReportColumn('Place of supply', 'place_of_supply'),
    ],
  ),
  Gstr1Section(
    key: 'b2cs',
    title: 'B2C small',
    emptyText: 'No B2C Small invoices found',
    rowTitle: (r) => _join([_text(r, 'type'), _text(r, 'place_of_supply')]),
    rowSubtitle: (r) => _rate(r['rate']),
    rowAmount: (r) => _money(r['taxable_value']),
    columns: const [
      ReportColumn('Type', 'type'),
      ReportColumn('Place of supply', 'place_of_supply'),
      ReportColumn('Rate (%)', 'rate', qty: true),
      ReportColumn('Taxable value', 'taxable_value', money: true),
      ..._tax,
    ],
  ),
  Gstr1Section(
    key: 'exports',
    title: 'Exports',
    emptyText: 'No Export invoices found',
    rowTitle: (r) => _text(r, 'invoice_number'),
    rowSubtitle: (r) => _join([_text(r, 'export_type'), _text(r, 'invoice_date'), _text(r, 'port_code')]),
    rowAmount: (r) => _money(r['invoice_value']),
    columns: const [
      ReportColumn('Type', 'export_type'),
      ReportColumn('Invoice no', 'invoice_number'),
      ReportColumn('Date', 'invoice_date'),
      ReportColumn('Value', 'invoice_value', money: true),
      ReportColumn('Port code', 'port_code'),
      ReportColumn('Shipping bill', 'shipping_bill_number'),
      ReportColumn('Shipping bill date', 'shipping_bill_date'),
    ],
  ),
  Gstr1Section(
    key: 'sez',
    title: 'SEZ',
    emptyText: 'No SEZ invoices found',
    rowTitle: (r) => _text(r, 'invoice_number'),
    rowSubtitle: (r) => _join([_text(r, 'sez_unit_gstin'), _text(r, 'invoice_date'), _text(r, 'sez_type') == 'WPAY' ? 'With payment' : 'Without payment']),
    rowAmount: (r) => _money(r['taxable_value']),
    columns: const [
      ReportColumn('SEZ unit GSTIN', 'sez_unit_gstin'),
      ReportColumn('Invoice no', 'invoice_number'),
      ReportColumn('Date', 'invoice_date'),
      ReportColumn('Value', 'invoice_value', money: true),
      ReportColumn('Place of supply', 'place_of_supply'),
      ReportColumn('Rate (%)', 'rate', qty: true),
      ReportColumn('Taxable value', 'taxable_value', money: true),
      ReportColumn('IGST', 'igst_amount', money: true),
    ],
  ),
  Gstr1Section(
    key: 'cdn',
    title: 'Credit and debit notes',
    emptyText: 'No Credit/Debit Notes found for this period',
    rowTitle: (r) => _text(r, 'note_number'),
    rowSubtitle: (r) => _join([_text(r, 'note_type') == 'C' ? 'Credit' : 'Debit', _text(r, 'note_date'), _text(r, 'gstin_uin_recipient')]),
    rowAmount: (r) => _money(r['invoice_value']),
    columns: const [
      ReportColumn('Note no', 'note_number'),
      ReportColumn('Date', 'note_date'),
      ReportColumn('Recipient GSTIN', 'gstin_uin_recipient'),
      ReportColumn('Note value', 'invoice_value', money: true),
      ReportColumn('Taxable', 'taxable_value', money: true),
      ..._tax,
      ReportColumn('Original invoice', 'original_invoice_number'),
      ReportColumn('Place of supply', 'place_of_supply'),
    ],
  ),
  Gstr1Section(
    key: 'nil',
    title: 'Nil rated',
    emptyText: 'No Nil rated supplies',
    rowTitle: (r) => _text(r, 'description'),
    rowSubtitle: (r) => _join(['Exempted ${_money(r['exempt_supply'])}', 'Non-GST ${_money(r['non_gst_supply'])}']),
    rowAmount: (r) => _money(r['nil_supply']),
    columns: const [
      ReportColumn('Description', 'description'),
      ReportColumn('Nil rated', 'nil_supply', money: true),
      ReportColumn('Exempted', 'exempt_supply', money: true),
      ReportColumn('Non-GST', 'non_gst_supply', money: true),
    ],
  ),
  Gstr1Section(
    key: 'hsn',
    title: 'HSN summary',
    emptyText: 'No HSN summary data',
    rowTitle: (r) => _text(r, 'hsn_sac'),
    rowSubtitle: (r) => _join([_text(r, 'description'), _text(r, 'uqc'), _rate(r['rate'])]),
    rowAmount: (r) => _money(r['taxable_value']),
    columns: const [
      ReportColumn('HSN/SAC', 'hsn_sac'),
      ReportColumn('Description', 'description'),
      ReportColumn('UQC', 'uqc'),
      ReportColumn('Total quantity', 'total_quantity', qty: true),
      ReportColumn('Total value', 'total_value', money: true),
      ReportColumn('Taxable', 'taxable_value', money: true),
      ReportColumn('IGST', 'integrated_tax', money: true),
      ReportColumn('CGST', 'central_tax', money: true),
      ReportColumn('SGST', 'state_ut_tax', money: true),
    ],
  ),
];

/// The filing of this report: by `filing_id` when the reply has one, else by `filing_period`
/// (`gstr1/page.tsx` `fetchFilingInfo` / `fetchFilingByPeriod`).
Map<String, dynamic>? gstr1Filing(dynamic filingsBody, {String? filingId, required String period}) {
  final filings = docRows(filingsBody, 'filings');
  if (filingId != null && filingId.isNotEmpty) {
    for (final f in filings) {
      if (docText(f['id']) == filingId) return f;
    }
  }
  for (final f in filings) {
    if (docText(f['filing_period']) == period) return f;
  }
  return null;
}

/// "Period 2026-11 · 8 invoices".
String gstr1FilingLine(Map<String, dynamic> filing) {
  final count = docNum(filing['invoice_count']);
  return _join([
    'Period ${docText(filing['filing_period'])}',
    if (count != null) '${count.toInt()} invoice${count == 1 ? '' : 's'}',
  ]);
}

/// The question before `POST .../[filingId]/mark-filed`, in the website's words (`handleMarkAsFiled`).
String gstr1MarkFiledQuestion(Map<String, dynamic> filing) {
  final count = (docNum(filing['invoice_count']) ?? 0).toInt();
  return 'Mark GSTR-1 for ${docText(filing['filing_period'])} as filed? This locks all $count invoice${count == 1 ? '' : 's'} included in this filing and stops them being edited. This action cannot be undone.';
}

// ---------------------------------------------------------------------------------------------
// GSTR-3B (`gstr3b/page.tsx`)
// ---------------------------------------------------------------------------------------------

/// The five columns of a 3B row.
const gstTaxHeads = <(String label, String key)>[
  ('Taxable value', 'taxable_value'),
  ('IGST', 'igst'),
  ('CGST', 'cgst'),
  ('SGST', 'sgst'),
  ('Cess', 'cess'),
];

/// A table row of the 3B screen: its label and the reply object holding the five figures.
typedef Gstr3bRow = ({String label, dynamic data});

Map<String, dynamic>? _obj(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : null;

/// Table 3.1, rows (a) to (e).
List<Gstr3bRow> gstr3bTable31(Map<String, dynamic> d) {
  final nature = _obj(d['outward_taxable_supplies_nature']);
  return [
    if (nature != null) ...[
      (label: '(a)(i) Inter-state outward taxable supplies (other than zero rated, nil rated and exempted)', data: nature['inter_state']),
      (label: '(a)(ii) Intra-state outward taxable supplies (other than zero rated, nil rated and exempted)', data: nature['intra_state']),
    ] else
      (label: '(a) Outward taxable supplies (other than zero rated, nil rated and exempted)', data: d['outward_taxable_supplies']),
    (label: '(b) Outward taxable supplies (zero rated)', data: d['outward_zero_rated']),
    (label: '(c) Other outward supplies (Nil rated, exempted)', data: d['other_outward_supplies']),
    (label: '(d) Inward supplies (liable to reverse charge)', data: d['inward_reverse_charge']),
    if (d['non_gst_outward_supplies'] != null) (label: '(e) Non-GST outward supplies', data: d['non_gst_outward_supplies']),
  ];
}

/// Table 4, eligible ITC.
List<Gstr3bRow> gstr3bTable4(Map<String, dynamic> itc) => [
      (label: '(A)(1) Import of goods', data: itc['imports']),
      if (itc['import_services'] != null) (label: '(A)(2) Import of services', data: itc['import_services']),
      (label: '(A)(3) Inward supplies liable to reverse charge (other than 1 & 2)', data: itc['inward_reverse_charge']),
      (label: '(A)(5) All other ITC', data: itc['other_itc']),
      (label: '(B)(1) ITC reversed — Rule 38/42/43 & s.17(5)', data: itc['itc_reversed_rules'] ?? itc['itc_reversed']),
      if (itc['itc_reversed_others'] != null) (label: '(B)(2) ITC reversed — Others (Rule 37, re-claimable)', data: itc['itc_reversed_others']),
      (label: '(C) Net ITC Available (A) - (B)', data: itc['net_itc']),
      if (itc['itc_reclaimed'] != null) (label: '(D)(1) ITC reclaimed which was reversed under (B)(2) earlier', data: itc['itc_reclaimed']),
    ];

// ---------------------------------------------------------------------------------------------
// GSTR-2B reconciliation (`gstr2b-reconciliation/page.tsx`)
// ---------------------------------------------------------------------------------------------

const gstMatchStatuses = <(String key, String label)>[
  ('MATCHED', 'Matched'),
  ('PARTIALLY_MATCHED', 'Partially matched'),
  ('MISSING_IN_2B', 'Missing in 2B'),
  ('ONLY_IN_2B', 'Only in 2B'),
  ('NOT_ELIGIBLE', 'Not eligible'),
];

String gstMatchLabel(String status) {
  for (final (k, l) in gstMatchStatuses) {
    if (k == status) return l;
  }
  return status;
}

/// `ITC_DEFERRED_TO_FUTURE` as `ITC deferred to future`.
String gstDecisionLabel(String decision) {
  final t = decision.replaceAll('_', ' ').trim();
  if (t.isEmpty) return '';
  final lower = t.toLowerCase();
  return lower.startsWith('itc ') ? 'ITC${lower.substring(3)}' : lower[0].toUpperCase() + lower.substring(1);
}

const gstReconModes = <(String, String)>[('live_vs_live', 'Live vs Live'), ('filed_vs_live', 'Filed vs Live'), ('filed_vs_filed', 'Filed vs Filed')];

const gstExceptionLabels = {
  'missing_invoice': 'Missing invoice',
  'extra_invoice': 'Extra invoice',
  'tax_mismatch': 'Tax mismatch',
  'date_mismatch': 'Date mismatch',
  'cdn_mismatch': 'CDN mismatch',
};

// ---------------------------------------------------------------------------------------------
// GST cash ledger (`cash-ledger/page.tsx`)
// ---------------------------------------------------------------------------------------------

const gstCashHeads = ['IGST', 'CGST', 'SGST', 'CESS'];
const gstLiabilityHeads = ['IGST', 'CGST', 'SGST', 'CESS', 'RCM', 'RCM_IGST', 'RCM_CGST', 'RCM_SGST'];
const gstCashDeposit = 'gst_cash_deposit';
const gstCashUtilization = 'gst_cash_utilization';

/// Which cash ledger pays a liability head (`cashHeadForLiability`).
String gstCashHeadFor(String liability, String pooledCash) {
  if (liability == 'RCM') return pooledCash;
  if (liability == 'IGST' || liability == 'RCM_IGST') return 'IGST';
  if (liability == 'CGST' || liability == 'RCM_CGST') return 'CGST';
  if (liability == 'SGST' || liability == 'RCM_SGST') return 'SGST';
  return 'CESS';
}

String gstVoucherLabel(String type) => switch (type) {
      gstCashDeposit => 'Cash deposit',
      gstCashUtilization => 'Cash utilisation',
      _ => type.isEmpty ? '' : '${type[0].toUpperCase()}${type.substring(1).replaceAll('_', ' ')}',
    };

/// Voucher ids that a "Reversal:" line of the statement already reversed.
Set<String> gstReversedVouchers(List<Map<String, dynamic>> statement) => {
      for (final l in statement)
        if (docText(l['narration']).startsWith('Reversal:')) docText(l['voucher_id']),
    };

/// A deposit or utilisation that is not itself a reversal and has not been reversed (`reversible` on the website).
bool gstLineReversible(Map<String, dynamic> line, Set<String> reversed) {
  final type = docText(line['voucher_type']);
  return (type == gstCashDeposit || type == gstCashUtilization) &&
      !docText(line['narration']).startsWith('Reversal:') &&
      !reversed.contains(docText(line['voucher_id']));
}

Map<String, dynamic> _withBranch(Map<String, dynamic> body, String? branchId) => {...body, if (branchId != null && branchId.isNotEmpty) 'branch_id': branchId};

/// `POST /api/gst/cash-ledger/deposit`. The bank is the server's default (account 1102), as when the website form leaves it blank.
Map<String, dynamic> gstDepositBody({required DateTime date, required String head, required num amount, String challan = '', String? branchId}) => _withBranch({
      'payment_date': ymd(date),
      'tax_head': head,
      'amount': amount,
      if (challan.trim().isNotEmpty) 'challan_number': challan.trim(),
    }, branchId);

/// `POST /api/gst/cash-ledger/utilize`. `cash_head` is only sent for pooled RCM, as on the website.
Map<String, dynamic> gstUtilizeBody({required DateTime date, required String head, required num amount, String cashHead = 'IGST', String? branchId}) => _withBranch({
      'payment_date': ymd(date),
      'tax_head': head,
      'amount': amount,
      if (head == 'RCM') 'cash_head': cashHead,
    }, branchId);

/// `POST /api/gst/cash-ledger/reverse`.
Map<String, dynamic> gstReverseBody({required Map<String, dynamic> line, required String reason, required DateTime today, String? branchId}) => _withBranch({
      'voucher_id': docText(line['voucher_id']),
      'voucher_type': docText(line['voucher_type']),
      'reason': reason.trim(),
      'entry_date': ymd(today),
    }, branchId);

/// A typed amount (commas allowed) when it is above zero.
num? gstTypedAmount(String text) {
  final n = docNum(text.replaceAll(',', '').trim());
  if (n == null || n <= 0) return null;
  return n == n.truncate() ? n.truncate() : n;
}

// ---------------------------------------------------------------------------------------------
// GST alerts (`compliance/page.tsx`, `components/gst/alerts/alert-meta.ts`)
// ---------------------------------------------------------------------------------------------

/// What each check is called in the list and what its `amount` means (`CHECK_META`).
const gstCheckMeta = <String, ({String chip, String? impact, bool itc})>{
  'rule37': (chip: 'Rule 37 · ITC reversal', impact: 'ITC at risk', itc: true),
  'itc_deadline': (chip: 'Section 16(4) · ITC time limit', impact: 'ITC to claim', itc: true),
  'gstr3b_due': (chip: 'GSTR-3B · Filing', impact: 'Late fee', itc: false),
  'rcm_self_invoice': (chip: 'Rule 47A · RCM self-invoice', impact: 'Tax payable under RCM', itc: false),
  'credit_note_deadline': (chip: 'Section 34(2) · Credit notes', impact: null, itc: false),
  'eway_bill': (chip: 'E-way bill', impact: 'Invoice value', itc: false),
  'einvoice': (chip: 'E-invoicing', impact: 'Last FY turnover', itc: false),
};

({String chip, String? impact, bool itc}) gstCheckOf(String id) => gstCheckMeta[id] ?? (chip: 'GST', impact: null, itc: false);

/// `POST /api/gst/compliance-alerts` `{ alert_id, action: 'dismiss', reason }`. The route wants 3 to 300 characters.
Map<String, dynamic> gstDismissBody(String alertId, String reason) => {'alert_id': alertId, 'action': 'dismiss', 'reason': reason.trim()};

Map<String, dynamic> gstRestoreBody(String alertId) => {'alert_id': alertId, 'action': 'restore'};

bool gstReasonOk(String reason) {
  final n = reason.trim().length;
  return n >= 3 && n <= 300;
}

// ---------------------------------------------------------------------------------------------
// E-way bills (`eway-bills/page.tsx`, `components/eway-bills/EwayBillPanel.tsx`, `lib/gst/eway-bills.ts`)
// ---------------------------------------------------------------------------------------------

/// The statuses the list route filters on (`status` is applied after the load).
const ewayStatuses = <(String, String)>[
  ('', 'All'),
  ('active', 'Active'),
  ('expired', 'Expired'),
  ('cancelled', 'Cancelled'),
  ('rejected', 'Rejected'),
  ('closed', 'Closed'),
];

const ewayDocTypes = <(String, String)>[
  ('tax_invoice', 'Tax invoice'),
  ('bill_of_supply', 'Bill of supply'),
  ('delivery_challan', 'Delivery challan'),
  ('bill_of_entry', 'Bill of entry'),
  ('credit_note', 'Credit note'),
  ('others', 'Others'),
];

const ewaySubSupplyTypes = <(String, String)>[
  ('supply', 'Supply'),
  ('job_work', 'Job work'),
  ('job_work_returns', 'Job work returns'),
  ('sales_return', 'Sales return'),
  ('exhibition', 'Exhibition or fairs'),
  ('line_sales', 'Line sales'),
  ('own_use', 'For own use'),
  ('recipient_not_known', 'Recipient not known'),
  ('skd_ckd', 'SKD/CKD'),
  ('export', 'Export'),
  ('import', 'Import'),
  ('others', 'Others'),
];

const ewayDirections = <(String, String)>[('outward', 'Outward'), ('inward', 'Inward')];

/// "12 hours left" for an active bill with under a day to go (`hours_to_expiry`), else empty.
String ewayHoursLeft(Map<String, dynamic> bill) {
  final hours = docNum(bill['hours_to_expiry']);
  if (docText(bill['status']) != 'active' || hours == null || hours >= 24) return '';
  return '${hours.toInt()} hours left';
}

/// `POST /api/eway-bills`, the fields of the website's "Record e-way bill" panel. A bill added from the list has
/// no document, so its `source_type` is `other` (the route's own default).
Map<String, dynamic> ewayCreateBody({
  required String direction,
  required String number,
  required DateTime generatedAt,
  required num distanceKm,
  required bool odc,
  required String docType,
  required String subSupply,
  required num goodsValue,
  String vehicle = '',
  String transporter = '',
}) =>
    {
      'source_type': 'other',
      'direction': direction,
      'ewb_number': number.trim(),
      'generated_at': generatedAt.toUtc().toIso8601String(),
      'distance_km': distanceKm,
      'is_odc': odc,
      'doc_type': docType,
      'sub_supply_type': subSupply,
      'goods_value': goodsValue,
      'vehicle_number': vehicle.trim().isEmpty ? null : vehicle.trim(),
      'transporter_name': transporter.trim().isEmpty ? null : transporter.trim(),
    };

/// `PATCH /api/eway-bills/[id]` bodies (`EwayBillAction`).
Map<String, dynamic> ewayCancelBody(String reason) => {'action': 'cancel', if (reason.trim().isNotEmpty) 'reason': reason.trim()};
Map<String, dynamic> ewayRejectBody(String reason) => {'action': 'reject', if (reason.trim().isNotEmpty) 'reason': reason.trim()};
const ewayCloseBody = <String, dynamic>{'action': 'close'};
Map<String, dynamic> ewayExtendBody(num remainingKm) => {'action': 'extend', 'remaining_km': remainingKm};
Map<String, dynamic> ewayVehicleBody({String vehicle = '', String transporter = ''}) => {
      'action': 'vehicle',
      if (vehicle.trim().isNotEmpty) 'vehicle_number': vehicle.trim(),
      if (transporter.trim().isNotEmpty) 'transporter_name': transporter.trim(),
    };

/// `E-way bill 281001234567`, the words of the questions.
String ewayName(Map<String, dynamic> bill) => 'e-way bill ${docText(bill['ewb_number'])}';

// ---------------------------------------------------------------------------------------------
// GSTR-2B decisions and the reconciliation run (`gstr2b-reconciliation/page.tsx`)
// ---------------------------------------------------------------------------------------------

/// The five decisions of the website's "Record Decision" dialog (`app/api/gst/gstr2b/decision/route.ts`).
const gstDecisions = <(String, String)>[
  ('PENDING_SUPPLIER_CORRECTION', 'Pending Supplier Correction'),
  ('ITC_ELIGIBLE_THIS_PERIOD', 'ITC Eligible This Period'),
  ('ITC_DEFERRED_TO_FUTURE', 'ITC Deferred to Future'),
  ('ITC_NOT_ELIGIBLE', 'ITC Not Eligible'),
  ('IGNORE', 'Ignore (Informational Only)'),
];

String gstDecisionName(String key) => gstDecisions.firstWhere((d) => d.$1 == key, orElse: () => (key, key)).$2;

final _yearMonth = RegExp(r'^\d{4}-\d{2}$');

/// A deferral period is optional, but when typed it must be YYYY-MM (the route says so).
bool gstPeriodTextOk(String text) => text.trim().isEmpty || _yearMonth.hasMatch(text.trim());

/// `POST /api/gst/gstr2b/decision`. The business and the user come from the session, so neither is sent.
Map<String, dynamic> gstDecisionBody({
  required String reconciliationId,
  required String decision,
  String remarks = '',
  num? eligibleItc,
  String deferredTo = '',
}) =>
    {
      'reconciliation_id': reconciliationId,
      'decision': decision,
      if (remarks.trim().isNotEmpty) 'remarks': remarks.trim(),
      if (decision == 'ITC_ELIGIBLE_THIS_PERIOD' && eligibleItc != null) 'eligible_itc_amount': eligibleItc,
      if (decision == 'ITC_DEFERRED_TO_FUTURE' && deferredTo.trim().isNotEmpty) 'deferred_to_period': deferredTo.trim(),
    };

/// `POST /api/gst/gstr2b/reconcile` `{ filing_period }`.
Map<String, dynamic> gstReconcileBody(MonthPeriod m) => {'filing_period': gstPeriodKey(m)};
