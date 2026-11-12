import '../../format.dart';
import '../docs/doc_logic.dart';

/// Delivery challans (`app/(app)/delivery-challans/page.tsx`, `[id]/page.tsx`, `lib/delivery-challans/challan-math.ts`).
/// `GET /api/delivery-challans?status=` replies `{ deliveryChallans }` (every row is `dc.*` plus `customer_name`,
/// `invoice_number`, `sales_order_number`, `stock_transfer_number`); the route does not page.
/// `GET /api/delivery-challans/[id]` replies `{ deliveryChallan, items, ewayBills }`.
/// The phone shows the server's figures; it never adds them up.

/// The website's status chips (the route filters on the stored status).
const kChallanFilters = <(String, String)>[
  ('', 'All'),
  ('draft', 'Draft'),
  ('sent', 'Sent'),
  ('delivered', 'Delivered'),
  ('cancelled', 'Cancelled'),
];

/// What a challan page can do. The order is the order the actions are offered.
enum ChallanAction { generate, sendOut, recordReturn, markDelivered, edit, openInvoice, cancel, share }

/// `challan-math.ts` TRANSITIONS: draft to sent or cancelled, sent to delivered or cancelled; the rest are final.
const _transitions = <String, List<String>>{
  'draft': ['sent', 'cancelled'],
  'sent': ['delivered', 'cancelled'],
  'delivered': [],
  'cancelled': [],
};

bool canTransitionChallan(String from, String to) => (_transitions[from] ?? const []).contains(to);

String challanStatus(Map<String, dynamic> row) {
  final s = docText(row['status']).trim().toLowerCase();
  return s.isEmpty ? 'draft' : s;
}

bool _has(Map<String, dynamic> row, String key) => docText(row[key]).trim().isNotEmpty;

bool isReturnableChallan(Map<String, dynamic> row) => docText(row['challan_kind']) == 'returnable';

/// Returnable goods that have left the godown and not all come back (the website's `goodsOut`).
bool challanGoodsOut(Map<String, dynamic> row) => isReturnableChallan(row) && _has(row, 'stock_posted_at') && !_has(row, 'closed_at');

/// The detail page's `canEdit`: draft or sent, goods not sent out, not a stock transfer challan.
bool canEditChallan(Map<String, dynamic> row) =>
    const {'draft', 'sent'}.contains(challanStatus(row)) && !_has(row, 'stock_posted_at') && !_has(row, 'stock_transfer_id');

/// Why the phone form cannot save this challan, or null. These are the server's own refusals.
String? challanEditBlock(Map<String, dynamic> row) {
  if (canEditChallan(row)) return null;
  if (_has(row, 'stock_transfer_id')) {
    return 'This challan can no longer be edited. It was issued for a stock transfer and follows it, so change the transfer instead.';
  }
  if (_has(row, 'stock_posted_at')) {
    return 'This challan can no longer be edited. The goods on it have been sent out, so record the returns instead.';
  }
  return 'This challan can no longer be edited. A ${challanStatus(row)} challan is final.';
}

/// The actions for a challan in its current state, from the website's `ChallanStatusActions`.
/// Record return is the website's "Settle": goods coming back on a returnable challan.
List<ChallanAction> challanActions(Map<String, dynamic> row) {
  final status = challanStatus(row);
  final returnable = isReturnableChallan(row);
  final goodsOut = challanGoodsOut(row);
  final fromTransfer = _has(row, 'stock_transfer_id');
  return [
    if (canTransitionChallan(status, 'sent')) returnable ? ChallanAction.sendOut : ChallanAction.generate,
    if (goodsOut) ChallanAction.recordReturn,
    if (!returnable && canTransitionChallan(status, 'delivered')) ChallanAction.markDelivered,
    if (canEditChallan(row)) ChallanAction.edit,
    if (_has(row, 'invoice_id')) ChallanAction.openInvoice,
    if (canTransitionChallan(status, 'cancelled') && !goodsOut && !fromTransfer) ChallanAction.cancel,
    ChallanAction.share,
  ];
}

/// The action that moves the challan on; it goes in the bottom bar.
ChallanAction? challanPrimary(Map<String, dynamic> row) {
  for (final a in challanActions(row)) {
    if (a == ChallanAction.generate || a == ChallanAction.sendOut || a == ChallanAction.recordReturn || a == ChallanAction.markDelivered) return a;
  }
  // Nothing left to move: the linked invoice is the next thing to look at.
  return challanActions(row).contains(ChallanAction.openInvoice) ? ChallanAction.openInvoice : null;
}

/// `PATCH /api/delivery-challans/[id]` body: only the new status (the session names the business).
Map<String, dynamic> challanStatusBody(String next) => {'status': next};

/// The website's success messages.
String challanStatusToast(String next, {required bool returnable}) => switch (next) {
      'sent' => returnable ? 'Goods sent out; they now show as held by the party' : 'Challan generated',
      'delivered' => 'Marked as delivered',
      _ => 'Challan cancelled',
    };

String challanTitle(Map<String, dynamic> row) {
  final n = docText(row['challan_number']);
  return n.isEmpty ? 'Delivery challan' : n;
}

String challanParty(Map<String, dynamic> row) {
  final name = docText(row['customer_name']);
  if (name.isNotEmpty) return name;
  final supplier = docText(row['supplier_name']);
  if (supplier.isNotEmpty) return supplier;
  final transfer = docText(row['stock_transfer_number']);
  return transfer.isEmpty ? '' : 'Stock transfer $transfer';
}

String challanSubtitle(Map<String, dynamic> row) {
  final party = challanParty(row);
  final date = docDate(row['challan_date']);
  final vehicle = docText(row['vehicle_number']);
  final invoice = docText(row['invoice_number']);
  final order = docText(row['sales_order_number']);
  return [
    party.isEmpty ? 'No customer' : party,
    if (date != null) ddMMMyyyy(date),
    if (vehicle.isNotEmpty) vehicle,
    if (invoice.isNotEmpty) 'Invoice $invoice',
    if (order.isNotEmpty) 'Order $order',
  ].join(' · ');
}

/// The list shows the value only when there is one (the website shows a dash).
num? challanAmount(Map<String, dynamic> row) {
  final v = docNum(row['grand_total']);
  return v == null || v <= 0 ? null : v;
}

/// `GST s.143` purposes and the website's reason-for-transportation words.
const kChallanReasons = <String, String>{
  'supply': 'Supply (sale)',
  'export': 'Export',
  'job_work': 'Job work',
  'skd_ckd': 'SKD/CKD',
  'recipient_not_known': 'Recipient not known',
  'line_sales': 'For own use',
  'exhibition': 'Exhibition or fairs',
  'others': 'Others',
};

const kChallanPurposes = <String, String>{
  'repair': 'repair',
  'job_work': 'job work',
  'approval': 'approval',
  'consignment': 'consignment',
  'exhibition': 'exhibition',
  'demo': 'demo',
  'other': 'other',
};

/// The website's amber chip under the status: where returnable goods stand.
String challanReturnableNote(Map<String, dynamic> row) {
  if (!isReturnableChallan(row)) return '';
  final purpose = kChallanPurposes[docText(row['purpose'])] ?? docText(row['purpose']);
  if (_has(row, 'closed_at')) return 'Returnable: closed (${docText(row['close_reason']).isEmpty ? 'returned' : docText(row['close_reason'])})';
  if (_has(row, 'stock_posted_at')) {
    final due = docDate(row['expected_return_date']);
    return 'Out for $purpose${due == null ? '' : ', due ${ddMMMyyyy(due)}'}';
  }
  return 'Returnable: $purpose';
}

/// "2 PCS × ₹500 · GST 18% · Returned 1 · Sold 0 · Written off 0" from the line's own figures.
String challanLineSubtitle(Map<String, dynamic> line) {
  final qty = docNum(line['qty'] ?? line['quantity']) ?? 0;
  final unit = docText(line['unit']);
  final price = docNum(line['unit_price']) ?? 0;
  final rate = docNum(line['tax_rate']) ?? 0;
  final returned = docNum(line['qty_returned']) ?? 0;
  final invoiced = docNum(line['qty_invoiced']) ?? 0;
  final lost = docNum(line['qty_written_off']) ?? 0;
  return [
    '${jsNumberString(qty)}${unit.isEmpty ? '' : ' $unit'} × ${inr(price, maxFraction: 2)}',
    if (rate > 0) 'GST ${jsNumberString(rate)}%',
    if (returned > 0.0001) 'Returned ${jsNumberString(returned)}',
    if (invoiced > 0.0001) 'Sold ${jsNumberString(invoiced)}',
    if (lost > 0.0001) 'Written off ${jsNumberString(lost)}',
  ].join(' · ');
}

/// The lines that can still take a return: an item line with a quantity left out (the website's panel filter).
List<Map<String, dynamic>> challanOpenLines(List<Map<String, dynamic>> items) => [
      for (final l in items)
        if (_has(l, 'item_id') && (docNum(l['qty_open']) ?? 0) > 0) l,
    ];

/// One line of the return sheet: what came back, was sold to the holder, or was lost.
class ChallanReturnEntry {
  const ChallanReturnEntry({required this.lineId, this.returned = 0, this.invoiced = 0, this.writtenOff = 0});

  final String lineId;
  final num returned, invoiced, writtenOff;

  bool get isEmpty => returned + invoiced + writtenOff <= 0;
}

num _n(num v) => v == v.roundToDouble() ? v.toInt() : v;

/// `POST /api/delivery-challans/[id]/settle` body (the website's `ChallanReturnPanel.save`): the date, the lines
/// that have a quantity, the write-off reason and a note. The session names the business.
Map<String, dynamic> challanReturnBody({
  required DateTime date,
  required List<ChallanReturnEntry> entries,
  required String reason,
  required String notes,
}) {
  final d = date;
  return {
    'date': '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}',
    'lines': [
      for (final e in entries)
        if (!e.isEmpty) {'line_id': e.lineId, 'returned': _n(e.returned), 'invoiced': _n(e.invoiced), 'written_off': _n(e.writtenOff)},
    ],
    'write_off_reason': reason,
    'notes': notes.trim().isEmpty ? null : notes.trim(),
  };
}

/// The website's write-off reasons (`WRITE_OFF_REASONS` in the settle route).
const kWriteOffReasons = <(String, String)>[
  ('CUSTODY_LOSS', 'Lost while with the holder'),
  ('DAMAGE', 'Damaged'),
  ('THEFT', 'Stolen'),
  ('TRANSIT_LOSS', 'Lost in transit'),
];

String challanCancelText(String number) => 'Cancel delivery challan $number? This cannot be undone.';
