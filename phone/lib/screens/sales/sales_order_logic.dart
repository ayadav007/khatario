import '../../format.dart';
import '../../ui/kit.dart';
import '../docs/doc_logic.dart';

/// Sales orders (`app/(app)/sales-orders/page.tsx` and `[id]/page.tsx`).
/// `GET /api/sales-orders` replies `{ salesOrders }` (every row has `so.*` plus `customer_name`,
/// `total_paid`, `payment_remaining`, `linked_invoice_count`, `latest_invoice_id`, `latest_invoice_number`);
/// `GET /api/sales-orders/[id]` replies `{ salesOrder }` with `items` and `editable`;
/// `GET .../payment-summary` replies `{ grand_total, total_paid, remaining, payment_status, ... }`.
/// The phone shows those figures; it never adds them up.

/// The website's status chips (the route filters on the stored status).
const kSalesOrderFilters = <(String, String)>[
  ('', 'All'),
  ('draft', 'Draft'),
  ('confirmed', 'Open'),
  ('partially_fulfilled', 'Partial Open'),
  ('fulfilled', 'Completed'),
  ('cancelled', 'Cancelled'),
];

enum SalesOrderAction { convert, openInvoice, share }

String salesOrderStatus(Map<String, dynamic> row) {
  final s = docText(row['status']).trim().toLowerCase();
  return s.isEmpty ? 'draft' : s;
}

/// `isSalesOrderConvertibleStatus`: everything except fulfilled, cancelled and rejected.
bool canConvertSalesOrder(Map<String, dynamic> row) => !const {'fulfilled', 'cancelled', 'rejected'}.contains(salesOrderStatus(row));

/// The detail page's `canEditOrder`: the server's `editable` flag (false wins), then draft or confirmed
/// with no invoice (`isSalesOrderEditable`).
bool canEditSalesOrder(Map<String, dynamic> row) {
  if (row['editable'] == false) return false;
  if (!const {'draft', 'confirmed'}.contains(salesOrderStatus(row))) return false;
  return docText(row['converted_invoice_id']).isEmpty;
}

/// Why the phone's order form cannot save this order safely, or null. The form has no discount, extra
/// charge or round-off fields and `PUT` replaces the totals, so saving such an order here would change it.
String? salesOrderPhoneEditBlock(Map<String, dynamic> order) {
  bool set(String key) => (docNum(order[key]) ?? 0).abs() > 0.0001;
  var discounted = set('discount_total');
  final items = order['items'];
  if (items is List) {
    for (final l in items.whereType<Map>()) {
      if ((docNum(l['discount_percent']) ?? 0) > 0 || (docNum(l['discount_amount']) ?? 0) > 0) discounted = true;
    }
  }
  if (discounted || set('additional_charges') || set('round_off')) {
    return 'This order has a discount, an extra charge or a round off. Edit it on the website so its totals stay right.';
  }
  return null;
}

/// The invoice to open: the latest linked invoice, else the one the order header points at.
String? linkedInvoiceIdOf(Map<String, dynamic> row) {
  final count = docNum(row['linked_invoice_count']) ?? 0;
  final latest = docText(row['latest_invoice_id']);
  if (count > 0 && latest.isNotEmpty) return latest;
  final id = docText(row['converted_invoice_id']);
  return id.isEmpty ? null : id;
}

List<SalesOrderAction> salesOrderRowActions(Map<String, dynamic> row) => [
      if (canConvertSalesOrder(row)) SalesOrderAction.convert,
      if (linkedInvoiceIdOf(row) != null) SalesOrderAction.openInvoice,
      SalesOrderAction.share,
    ];

String salesOrderTitle(Map<String, dynamic> row) {
  final n = docText(row['order_number']);
  return n.isEmpty ? 'Sales order' : n;
}

String salesOrderSubtitle(Map<String, dynamic> row) {
  final name = docText(row['customer_name']);
  final date = docDate(row['order_date']);
  final delivery = docDate(row['expected_delivery_date']);
  final paid = docNum(row['total_paid']) ?? 0;
  final remaining = docNum(row['payment_remaining']) ?? 0;
  return [
    name.isEmpty ? 'No customer' : name,
    if (date != null) ddMMMyyyy(date),
    if (delivery != null) 'Delivery ${ddMMMyyyy(delivery)}',
    if (paid > 0.005 && remaining > 0.005) 'Remaining ${money2(remaining)}',
  ].join(' · ');
}

/// `₹` with Indian grouping and two decimals, like the website's payment card.
String money2(num v) {
  final text = enIn(v.abs(), maxFraction: 2);
  final dot = text.indexOf('.');
  final fixed = dot == -1 ? '$text.00' : (text.length - dot - 1 == 1 ? '${text}0' : text);
  return '${v < 0 ? '-' : ''}$rupeeSign$fixed';
}

/// The rows of the payment card from `payment-summary`, as the server returned them. Empty without a summary.
List<(String, String)> salesOrderPaymentRows(Map<String, dynamic>? summary) {
  if (summary == null) return const [];
  final total = docNum(summary['grand_total']);
  final paid = docNum(summary['total_paid']);
  final remaining = docNum(summary['remaining']);
  return [
    if (summary.containsKey('payment_status'))
      ('Payment', statusTone(docText(summary['payment_status']).isEmpty ? 'unpaid' : docText(summary['payment_status'])).$2),
    if (total != null) ('Order total', money2(total)),
    if (paid != null) ('Paid', money2(paid)),
    if (remaining != null) ('Remaining', money2(remaining)),
  ];
}

/// "2 PCS × ₹500 · GST 18% · Invoiced 1 of 2", from the line's own figures.
String salesOrderLineSubtitle(Map<String, dynamic> line) {
  final qty = docNum(line['qty'] ?? line['quantity']) ?? 0;
  final done = docNum(line['fulfilled_qty']) ?? 0;
  final unit = docText(line['unit']);
  final price = docNum(line['unit_price']) ?? 0;
  final rate = docNum(line['tax_rate']) ?? 0;
  return [
    '${jsNumberString(qty)}${unit.isEmpty ? '' : ' $unit'} × ${inr(price, maxFraction: 2)}',
    if (rate > 0) 'GST ${jsNumberString(rate)}%',
    if (done > 0.0001) 'Invoiced ${jsNumberString(done)} of ${jsNumberString(qty)}',
  ].join(' · ');
}

String salesOrderConfirmText(String number, num amount) =>
    'Make an invoice for everything left on sales order $number (${inr(amount, maxFraction: 2)} in all)? Stock and the customer ledger update when it is created.';
