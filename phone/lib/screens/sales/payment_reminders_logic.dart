import '../docs/doc_logic.dart';

/// The website's default message (`SendRemindersTab`).
const kDefaultReminderTemplate = 'Hi {customer_name},\n'
    '\n'
    'Invoice {invoice_no} for {balance_amount} is now overdue. The due date was {due_date}.\n'
    '\n'
    'Please arrange payment immediately to avoid any inconvenience.\n'
    '\n'
    'Thank you!\n'
    '{business_name}';

/// Website payment-status filter, in its order. The key goes to `payment_status`.
const kReminderStatusFilters = <(String, String)>[
  ('both', 'Both'),
  ('unpaid', 'Unpaid'),
  ('partially_paid', 'Partially paid'),
];

/// One row of `GET /api/invoices/for-reminders`: a final, unpaid or part-paid invoice whose customer has a phone.
class ReminderInvoice {
  const ReminderInvoice({
    required this.id,
    required this.number,
    required this.customerName,
    required this.total,
    required this.balance,
    required this.paymentStatus,
    this.dueDate,
    this.phone,
  });

  final String id;
  final String number;
  final String customerName;
  final num total;
  final num balance;
  final String paymentStatus;
  final DateTime? dueDate;
  final String? phone;

  String get statusLabel => paymentStatus == 'partially_paid'
      ? 'Partially paid'
      : (paymentStatus.isEmpty ? '' : paymentStatus[0].toUpperCase() + paymentStatus.substring(1).replaceAll('_', ' '));

  static ReminderInvoice? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = docText(json['id']);
    if (id.isEmpty) return null;
    final customer = json['customer'] is Map ? json['customer'] as Map : const {};
    final name = docText(customer['name']).trim();
    final phone = docText(customer['phone']).trim();
    final due = docText(json['due_date']);
    return ReminderInvoice(
      id: id,
      number: docText(json['invoice_number']),
      customerName: name.isEmpty ? 'Cash Sale' : name,
      total: docNum(json['grand_total']) ?? 0,
      balance: docNum(json['balance_amount']) ?? 0,
      paymentStatus: docText(json['payment_status']),
      dueDate: due.length >= 10 ? DateTime.tryParse(due.substring(0, 10)) : null,
      phone: phone.isEmpty ? null : phone,
    );
  }
}

List<ReminderInvoice> reminderInvoices(dynamic list) =>
    list is List ? list.map(ReminderInvoice.fromJson).whereType<ReminderInvoice>().toList() : const [];

/// `POST /api/whatsapp/send-bulk-reminders`. Only the invoices that are ticked and still on the screen go in,
/// in list order. The server takes the business and the user from the session.
Map<String, dynamic> reminderBody({
  required List<ReminderInvoice> invoices,
  required Set<String> ticked,
  required String template,
  required bool includePdf,
}) =>
    {
      'invoice_ids': [for (final i in invoices) if (ticked.contains(i.id)) i.id],
      'message_template': template,
      'include_pdf': includePdf,
    };

/// The website's `ready`: a live QR session, or the cloud API with the Connect add-on. Anything else is not linked.
bool whatsAppLinked(Map<String, dynamic> status, {required bool hasConnect}) =>
    status['status'] == 'connected' || (status['cloudReady'] == true && hasConnect);

/// Website toast after a send.
String reminderResultText(Map<String, dynamic> reply) =>
    'Reminders sent! Success: ${(docNum(reply['success_count']) ?? 0).toInt()}, Failed: ${(docNum(reply['failed_count']) ?? 0).toInt()}';
