import '../../format.dart';
import '../docs/doc_logic.dart';

/// Work orders (`app/(app)/work-orders/page.tsx`, `[id]/page.tsx`, `lib/work-orders/work-order-math.ts`).
/// `GET /api/work-orders?status=` replies `{ workOrders }` (every row is `wo.*` plus `customer_name`,
/// `converted_invoice_number`, `converted_invoice_status`); the route does not page.
/// `GET /api/work-orders/[id]` replies `{ workOrder, items }`.
/// The costs are the server's; the phone never adds them up.

/// The website's status chips.
const kWorkOrderFilters = <(String, String)>[
  ('', 'All'),
  ('draft', 'Draft'),
  ('scheduled', 'Scheduled'),
  ('in_progress', 'In Progress'),
  ('completed', 'Completed'),
  ('cancelled', 'Cancelled'),
];

/// What a work order page can do. The order is the order the actions are offered.
enum WorkOrderAction { start, complete, createInvoice, schedule, openInvoice, edit, cancel, share }

/// `work-order-math.ts` TRANSITIONS.
const _transitions = <String, List<String>>{
  'draft': ['scheduled', 'in_progress', 'cancelled'],
  'scheduled': ['in_progress', 'cancelled'],
  'in_progress': ['completed', 'cancelled'],
  'completed': [],
  'cancelled': [],
};

bool canTransitionWorkOrder(String from, String to) => (_transitions[from] ?? const []).contains(to);

String workOrderStatus(Map<String, dynamic> row) {
  final s = docText(row['status']).trim().toLowerCase();
  return s.isEmpty ? 'draft' : s;
}

bool _has(Map<String, dynamic> row, String key) => docText(row[key]).trim().isNotEmpty;

/// `isWorkOrderEditable`: draft, scheduled or in progress.
bool canEditWorkOrder(Map<String, dynamic> row) => const {'draft', 'scheduled', 'in_progress'}.contains(workOrderStatus(row));

String workOrderEditBlock(Map<String, dynamic> row) =>
    'This work order can no longer be edited. A ${workOrderStatus(row).replaceAll('_', ' ')} work order is final.';

/// `canConvertToInvoice`: completed, and no invoice yet (or the invoice was cancelled).
bool canConvertWorkOrder(Map<String, dynamic> row) {
  if (workOrderStatus(row) != 'completed') return false;
  if (!_has(row, 'converted_invoice_id')) return true;
  return docText(row['converted_invoice_status']) == 'cancelled';
}

bool workOrderInvoiceCancelled(Map<String, dynamic> row) => docText(row['converted_invoice_status']) == 'cancelled';

List<WorkOrderAction> workOrderActions(Map<String, dynamic> row) {
  final status = workOrderStatus(row);
  return [
    if (canTransitionWorkOrder(status, 'in_progress')) WorkOrderAction.start,
    if (canTransitionWorkOrder(status, 'completed')) WorkOrderAction.complete,
    if (canConvertWorkOrder(row)) WorkOrderAction.createInvoice,
    if (canTransitionWorkOrder(status, 'scheduled')) WorkOrderAction.schedule,
    if (_has(row, 'converted_invoice_id')) WorkOrderAction.openInvoice,
    if (canEditWorkOrder(row)) WorkOrderAction.edit,
    if (canTransitionWorkOrder(status, 'cancelled')) WorkOrderAction.cancel,
    WorkOrderAction.share,
  ];
}

/// The action that moves the work order on; it goes in the bottom bar.
WorkOrderAction? workOrderPrimary(Map<String, dynamic> row) {
  for (final a in workOrderActions(row)) {
    if (a == WorkOrderAction.start || a == WorkOrderAction.complete || a == WorkOrderAction.createInvoice) return a;
  }
  // Nothing left to move: the invoice is the next thing to look at.
  return workOrderActions(row).contains(WorkOrderAction.openInvoice) ? WorkOrderAction.openInvoice : null;
}

/// `PATCH /api/work-orders/[id]` body, as the website sends it: the status and `actual_hours` (null unless completing).
Map<String, dynamic> workOrderStatusBody(String next, {num? hours}) => {'status': next, 'actual_hours': next == 'completed' ? hours : null};

/// The website's `SUCCESS` messages.
String workOrderStatusToast(String next) => switch (next) {
      'scheduled' => 'Work order scheduled',
      'in_progress' => 'Work started',
      'completed' => 'Work order completed',
      'cancelled' => 'Work order cancelled',
      _ => 'Work order updated',
    };

String workOrderTitle(Map<String, dynamic> row) {
  final n = docText(row['work_order_number']);
  return n.isEmpty ? 'Work order' : n;
}

String _capital(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

String workOrderSubtitle(Map<String, dynamic> row) {
  final name = docText(row['customer_name']);
  final date = docDate(row['work_order_date']);
  final priority = docText(row['priority']);
  final assigned = docText(row['assigned_to']);
  final invoice = docText(row['converted_invoice_number']);
  return [
    name.isEmpty ? 'No customer' : name,
    if (date != null) ddMMMyyyy(date),
    if (priority.isNotEmpty) _capital(priority),
    if (assigned.isNotEmpty) assigned,
    if (invoice.isNotEmpty) 'Invoice $invoice${workOrderInvoiceCancelled(row) ? ' (cancelled)' : ''}',
  ].join(' · ');
}

/// "2 PCS × ₹500" (materials carry no GST here; tax is added on the invoice).
String workOrderLineSubtitle(Map<String, dynamic> line) {
  final qty = docNum(line['qty'] ?? line['quantity']) ?? 0;
  final unit = docText(line['unit']);
  final price = docNum(line['unit_price']) ?? 0;
  return '${jsNumberString(qty)}${unit.isEmpty ? '' : ' $unit'} × ${inr(price, maxFraction: 2)}';
}

String workOrderCancelText(String number) => 'Cancel work order $number? This cannot be undone.';

String workOrderConvertText(String number, num total) =>
    'Make a tax invoice for completed work order $number (${inr(total, maxFraction: 2)} before GST)? Materials are issued from stock and the customer ledger updates when it is created.';

const kWorkOrderPriorities = <(String, String)>[
  ('low', 'Low'),
  ('medium', 'Medium'),
  ('high', 'High'),
  ('urgent', 'Urgent'),
];

/// `DEFAULT_LABOR_SAC` and `DEFAULT_LABOR_TAX_RATE` of `work-order-math.ts`.
const kDefaultLaborSac = '9987';
const kDefaultLaborTaxRate = 18;
