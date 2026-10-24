import '../../format.dart';

/// `lib/party-balance-ui.ts` and the list rules in `app/(app)/customers/page.tsx`.
const balanceEps = 0.005;

const partyPageSize = 50;

bool isPartyBalanceSettled(num balance) => balance.abs() < balanceEps;

String customerBalanceHint(num balance) {
  if (balance > balanceEps) return 'Due';
  if (balance < -balanceEps) return 'Credit';
  return 'Settled';
}

String supplierBalanceHint(num balance) {
  if (balance > balanceEps) return 'Due';
  if (balance < -balanceEps) return 'Prepaid';
  return 'Settled';
}

num partyBalance(dynamic value, [dynamic fallback]) => toNum(value ?? fallback ?? 0);

enum PartyKind { customers, suppliers }

/// Same body as the website reminder button. The server uses the signed-in business
/// when that id does not match the session.
Map<String, dynamic> reminderRequestBody(String? businessId) {
  final id = businessId?.trim() ?? '';
  if (id.isEmpty) return const {};
  return {'business_id': id};
}

/// Toast copy for POST `/api/customers/:id/send-reminder`, matching the website page.
({String message, String type}) reminderOutcome({required bool ok, required Map<String, dynamic> data}) {
  if (ok && data['success'] == true) {
    final sent = toNum(data['sent']).toInt();
    final failed = toNum(data['failed']).toInt();
    if (sent > 0) return (message: 'Reminders sent! $sent invoice(s) notified.', type: 'success');
    if (failed > 0) {
      final errors = data['errors'];
      final first = errors is List && errors.isNotEmpty ? errors.first.toString() : '';
      return (
        message: first.isEmpty ? 'Could not send WhatsApp reminders. Check connection and settings.' : first,
        type: 'error',
      );
    }
    final msg = data['message'];
    return (
      message: msg is String ? msg : 'No outstanding invoices to send reminders for.',
      type: 'info',
    );
  }
  return (message: data['error']?.toString() ?? 'Failed to send reminders', type: 'error');
}

/// Active rows, then name / phone (and company for customers), then the balance chip.
List<Map<String, dynamic>> filterParties(
  List<Map<String, dynamic>> all, {
  required PartyKind kind,
  required String search,
  required String balanceFilter,
}) {
  var list = all.where((row) => row['is_active'] != false);
  final q = search.trim().toLowerCase();
  if (q.isNotEmpty) {
    list = list.where((row) {
      final name = row['name']?.toString().toLowerCase().contains(q) ?? false;
      final phone = row['phone']?.toString().contains(q) ?? false;
      final company = kind == PartyKind.customers && (row['company_name']?.toString().toLowerCase().contains(q) ?? false);
      return name || phone || company;
    });
  }
  return list.where((row) {
    final balance = partyBalance(row['current_balance'], row['opening_balance']);
    return balanceFilter == 'all' ||
        (balanceFilter == 'with-balance' && !isPartyBalanceSettled(balance)) ||
        (balanceFilter == 'zero-balance' && isPartyBalanceSettled(balance));
  }).toList();
}

List<Map<String, dynamic>> pageOfParties(List<Map<String, dynamic>> rows, int page) {
  final start = (page - 1) * partyPageSize;
  if (start >= rows.length) return const [];
  final end = start + partyPageSize;
  return rows.sublist(start, end > rows.length ? rows.length : end);
}

int partyPageCount(int filteredCount) => filteredCount == 0 ? 1 : (filteredCount + partyPageSize - 1) ~/ partyPageSize;

/// `customerVoucherLabel` in `lib/party-statement-print.ts`.
String customerVoucherLabel(String transactionType) => switch (transactionType) {
      'opening_balance' => 'Opening balance',
      'invoice' => 'Sales invoice',
      'payment' => 'Payment-in',
      'advance' => 'Advance received',
      _ => transactionType,
    };

/// 1 April of the Indian financial year that contains [today].
DateTime indianFinancialYearStart(DateTime today) =>
    today.month >= 4 ? DateTime(today.year, 4, 1) : DateTime(today.year - 1, 4, 1);

/// Ledger duration presets from `CustomerLedgerView`.
({String? fromDate, String? toDate, String label}) ledgerRange(String preset, DateTime today) {
  String span(DateTime from, DateTime to) => '${ddMMMyyyy(from)} – ${ddMMMyyyy(to)}';
  switch (preset) {
    case 'last_30':
      final from = DateTime(today.year, today.month, today.day).subtract(const Duration(days: 30));
      final to = DateTime(today.year, today.month, today.day);
      return (fromDate: ymd(from), toDate: ymd(to), label: span(from, to));
    case 'fy':
      final from = indianFinancialYearStart(today);
      final to = DateTime(today.year, today.month, today.day);
      return (fromDate: ymd(from), toDate: ymd(to), label: span(from, to));
    case 'all':
      return (fromDate: null, toDate: null, label: 'All periods');
    default:
      final from = DateTime(today.year, today.month, 1);
      final to = DateTime(today.year, today.month + 1, 0);
      return (fromDate: ymd(from), toDate: ymd(to), label: span(from, to));
  }
}

/// `customerStatementSummary`: net card on the ledger tab.
({String title, num amount, String subtitle, num signedClosing}) customerStatementSummary(num closing) {
  if (closing > balanceEps) {
    return (
      title: 'Amount due (net)',
      amount: closing,
      subtitle: 'Customer owes this amount',
      signedClosing: closing,
    );
  }
  if (closing < -balanceEps) {
    return (
      title: 'Net credit balance',
      amount: closing.abs(),
      subtitle: 'Advance / overpayment with customer',
      signedClosing: closing,
    );
  }
  return (title: 'Account balance', amount: 0, subtitle: 'No net amount due', signedClosing: closing);
}

/// Date-only strings stay on that calendar day. Timestamps become local time.
DateTime? parsePartyDate(dynamic value) {
  final s = value?.toString();
  if (s == null || s.isEmpty) return null;
  final day = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(s);
  if (day != null) return DateTime(int.parse(day[1]!), int.parse(day[2]!), int.parse(day[3]!));
  return DateTime.tryParse(s)?.toLocal();
}

String partyDay(dynamic value) {
  final d = parsePartyDate(value);
  return d == null ? '—' : ddMMMyyyy(d);
}

const ledgerRangeLabels = {
  'current_month': 'Current month',
  'last_30': 'Last 30 days',
  'fy': 'This FY',
  'all': 'All time',
};
