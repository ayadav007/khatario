import '../../format.dart';
import '../docs/doc_logic.dart';

/// Website `FREQ_LABEL`, in its order.
const kRecurringFrequencies = <(String, String)>[
  ('daily', 'Daily'),
  ('weekly', 'Weekly'),
  ('monthly', 'Monthly'),
  ('quarterly', 'Quarterly'),
  ('half_yearly', 'Half-yearly'),
  ('yearly', 'Yearly'),
];

String recurringFrequencyLabel(String frequency) {
  for (final (key, label) in kRecurringFrequencies) {
    if (key == frequency) return label;
  }
  return frequency;
}

/// One row of `GET /api/recurring-invoices` (`recurringInvoices`).
class RecurringInvoice {
  const RecurringInvoice({
    required this.id,
    required this.customerName,
    required this.templateNumber,
    required this.frequency,
    required this.interval,
    required this.startDate,
    required this.endDate,
    required this.nextRunDate,
    required this.lastRunDate,
    required this.isActive,
    required this.autoFinalize,
    required this.lastError,
    required this.invoicesRaised,
    this.notes,
  });

  final String id;
  final String customerName;

  /// The invoice the lines are copied from; null for a schedule with its own lines.
  final String? templateNumber;
  final String frequency;
  final int interval;
  final String? startDate;
  final String? endDate;
  final String? nextRunDate;
  final String? lastRunDate;
  final bool isActive;
  final bool autoFinalize;
  final String? lastError;
  final int invoicesRaised;
  final String? notes;

  static String? _day(dynamic v) {
    final s = docText(v);
    return s.length >= 10 ? s.substring(0, 10) : null;
  }

  static RecurringInvoice? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = docText(json['id']);
    if (id.isEmpty) return null;
    String? text(String key) {
      final v = docText(json[key]).trim();
      return v.isEmpty ? null : v;
    }

    return RecurringInvoice(
      id: id,
      customerName: text('customer_name') ?? '-',
      templateNumber: text('template_invoice_number'),
      frequency: text('frequency') ?? 'monthly',
      interval: (docNum(json['interval_value']) ?? 1).toInt(),
      startDate: _day(json['start_date']),
      endDate: _day(json['end_date']),
      nextRunDate: _day(json['next_run_date']),
      lastRunDate: _day(json['last_run_date']),
      isActive: json['is_active'] != false,
      autoFinalize: json['auto_finalize'] == true,
      lastError: text('last_error'),
      invoicesRaised: (docNum(json['invoices_raised']) ?? 0).toInt(),
      notes: text('notes'),
    );
  }

  /// The row with the fresh fields of the detail reply laid over it (the detail has no customer name).
  RecurringInvoice withDetail(dynamic json) {
    final fresh = fromJson(json);
    if (fresh == null) return this;
    return RecurringInvoice(
      id: id,
      customerName: customerName,
      templateNumber: templateNumber,
      frequency: fresh.frequency,
      interval: fresh.interval,
      startDate: fresh.startDate,
      endDate: fresh.endDate,
      nextRunDate: fresh.nextRunDate,
      lastRunDate: fresh.lastRunDate,
      isActive: fresh.isActive,
      autoFinalize: fresh.autoFinalize,
      lastError: fresh.lastError,
      invoicesRaised: invoicesRaised,
      notes: fresh.notes ?? notes,
    );
  }
}

List<RecurringInvoice> recurringInvoices(dynamic list) =>
    list is List ? list.map(RecurringInvoice.fromJson).whereType<RecurringInvoice>().toList() : const [];

/// Website schedule column: `Every 3 × Monthly until 2027-03-01`.
String recurringSchedule(RecurringInvoice r) =>
    '${r.interval > 1 ? 'Every ${r.interval} × ' : ''}${recurringFrequencyLabel(r.frequency)}${r.endDate != null ? ' until ${r.endDate}' : ''}';

String _show(String? ymd) {
  final d = ymd == null ? null : DateTime.tryParse(ymd);
  return d == null ? (ymd ?? '-') : ddMMMyyyy(d);
}

/// The next run date, or `Paused` (website: `is_active ? next_run_date : 'Paused'`).
String recurringNextRun(RecurringInvoice r) => r.isActive ? _show(r.nextRunDate) : 'Paused';

String recurringDate(String? ymd) => _show(ymd);

/// `PATCH /api/recurring-invoices/[id]` pause (false) and resume (true).
Map<String, dynamic> recurringActiveBody(bool active) => {'is_active': active};

/// `PATCH` the Draft / Final mode.
Map<String, dynamic> recurringModeBody(bool autoFinalize) => {'auto_finalize': autoFinalize};

/// `POST /api/recurring-invoices/[id]`: raise whatever is due today.
Map<String, dynamic> runNowBody() => {'action': 'run_now'};

/// Website create body. The server takes the business and the user from the session.
Map<String, dynamic> recurringCreateBody({
  required String customerId,
  required String templateInvoiceId,
  required String frequency,
  required int interval,
  required DateTime start,
  required DateTime? end,
  required bool autoFinalize,
  required String notes,
}) {
  final note = notes.trim();
  return {
    'customer_id': customerId,
    'template_invoice_id': templateInvoiceId,
    'frequency': frequency,
    'interval_value': interval,
    'start_date': ymd(start),
    'end_date': end == null ? null : ymd(end),
    'auto_finalize': autoFinalize,
    'notes': note.isEmpty ? null : note,
    'items': <Object>[],
  };
}

/// The route takes a whole number of 1 to 36.
String? recurringIntervalError(String text) {
  final n = int.tryParse(text.trim());
  if (n == null || n < 1 || n > 36) return 'Enter a whole number from 1 to 36';
  return null;
}

/// Website toast after Run now.
String runNowMessage(Map<String, dynamic> reply) {
  final created = reply['created'];
  if (created is List && created.isNotEmpty) {
    final numbers = created.map((c) => c is Map ? docText(c['invoice_number']) : '').where((n) => n.isNotEmpty).join(', ');
    final n = created.length;
    return 'Raised $n invoice${n > 1 ? 's' : ''}: $numbers';
  }
  final message = docText(reply['message']);
  return message.isEmpty ? 'Nothing due today' : message;
}

/// One run of a schedule (`history` in `GET /api/recurring-invoices/[id]`).
class RunHistory {
  const RunHistory({required this.runDate, required this.status, this.invoiceNumber, this.error});

  final String? runDate;
  final String status;
  final String? invoiceNumber;
  final String? error;

  String get statusLabel => switch (status) {
        'success' => 'Success',
        'failed' => 'Failed',
        _ => status.isEmpty ? '-' : status[0].toUpperCase() + status.substring(1),
      };
}

List<RunHistory> runHistory(dynamic list) {
  if (list is! List) return const [];
  return [
    for (final r in list)
      if (r is Map)
        RunHistory(
          runDate: RecurringInvoice._day(r['run_date']),
          status: docText(r['status']),
          invoiceNumber: docText(r['invoice_number']).isEmpty ? null : docText(r['invoice_number']),
          error: docText(r['error_message']).isEmpty ? null : docText(r['error_message']),
        ),
  ];
}
