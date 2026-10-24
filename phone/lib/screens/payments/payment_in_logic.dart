/// Ids returned by POST /api/payments after a receipt is saved.
class RecordedPayments {
  const RecordedPayments(this.ids);

  final List<String> ids;
}

/// Payment In job split from `app/(app)/payments/in/page.tsx`.
/// Identity fields (`business_id`, `created_by`, `user_id`) are omitted; the session owns them.
class PaymentLinkDraft {
  const PaymentLinkDraft({required this.id, required this.amount, required this.balance, this.number = ''});

  final String id;
  final double amount;
  final double balance;
  final String number;
}

class PaymentJob {
  const PaymentJob({
    required this.customerId,
    required this.referenceType,
    required this.referenceId,
    required this.amount,
    required this.tdsAmount,
    required this.tdsSection,
    required this.paymentMode,
    required this.paymentDate,
    required this.notes,
  });

  final String? customerId;
  final String? referenceType;
  final String? referenceId;
  final double amount;
  final double tdsAmount;
  final String? tdsSection;
  final String paymentMode;
  final String paymentDate;
  final String? notes;

  Map<String, dynamic> toJson() => {
        'type': 'receivable',
        'customer_id': customerId,
        'reference_type': referenceType,
        'reference_id': referenceId,
        'amount': amount,
        'tds_amount': tdsAmount,
        'tds_section': tdsSection,
        'payment_mode': paymentMode,
        'payment_date': paymentDate,
        'notes': notes,
      };

  String get fingerprint => [
        'receivable',
        customerId,
        referenceType,
        referenceId,
        amount,
        tdsAmount,
        tdsSection,
        paymentMode,
        paymentDate,
        notes,
      ].join('|');
}

class PaymentInDraft {
  const PaymentInDraft({
    this.customerId,
    this.amount = 0,
    this.tdsAmount = 0,
    this.tdsSection = '194C',
    this.paymentMode = 'cash',
    this.paymentDate = '',
    this.notes,
    this.links = const [],
  });

  final String? customerId;
  final double amount;
  final double tdsAmount;
  final String tdsSection;
  final String paymentMode;
  final String paymentDate;
  final String? notes;
  final List<PaymentLinkDraft> links;
}

double roundMoney(double n) => (n * 100).round() / 100;

/// Website validation messages. Null means the draft can be posted.
String? validatePaymentIn(PaymentInDraft draft) {
  final links = draft.links.where((l) => l.amount > 0).toList();
  final linkedSum = roundMoney(links.fold<double>(0, (s, l) => s + l.amount));
  if (draft.amount < 0 || draft.tdsAmount < 0 || draft.amount + draft.tdsAmount <= 0) {
    return 'Please enter a valid amount';
  }
  if (linkedSum - draft.amount > 0.01) {
    return 'Linked amounts cannot exceed the amount received';
  }
  if (links.length > 1 && draft.tdsAmount > 0) {
    return 'TDS can be recorded when the receipt is linked to one invoice';
  }
  if (links.length == 1 && links.first.amount + draft.tdsAmount > links.first.balance + 0.01) {
    return 'Amount received plus TDS cannot exceed balance of ₹${links.first.balance}';
  }
  return null;
}

List<PaymentJob> buildPaymentJobs(PaymentInDraft draft) {
  final links = draft.links.where((l) => l.amount > 0).toList();
  final linkedSum = roundMoney(links.fold<double>(0, (s, l) => s + l.amount));
  final unused = roundMoney(draft.amount - linkedSum);
  PaymentJob job({String? referenceType, String? referenceId, required double amount, required double tds, String? section}) {
    return PaymentJob(
      customerId: (draft.customerId == null || draft.customerId!.isEmpty) ? null : draft.customerId,
      referenceType: referenceType,
      referenceId: referenceId,
      amount: amount,
      tdsAmount: tds,
      tdsSection: tds > 0 ? section : null,
      paymentMode: draft.paymentMode,
      paymentDate: draft.paymentDate,
      notes: (draft.notes == null || draft.notes!.trim().isEmpty) ? null : draft.notes!.trim(),
    );
  }

  if (links.isEmpty) {
    return [job(amount: draft.amount, tds: draft.tdsAmount, section: draft.tdsSection)];
  }
  final jobs = <PaymentJob>[
    for (var i = 0; i < links.length; i++)
      job(
        referenceType: 'invoice',
        referenceId: links[i].id,
        amount: links[i].amount,
        tds: links.length == 1 && i == 0 ? draft.tdsAmount : 0,
        section: draft.tdsSection,
      ),
  ];
  if (unused > 0.009) {
    jobs.add(job(amount: unused, tds: 0));
  }
  return jobs;
}

/// Sum of the amounts typed against invoices. That sum is the amount received.
double linkedPaymentTotal(List<PaymentLinkDraft> links) =>
    roundMoney(links.where((l) => l.amount > 0).fold<double>(0, (s, l) => s + l.amount));

/// `200` for a whole rupee amount, otherwise two decimals.
String formatEnteredAmount(double amount) {
  final rounded = roundMoney(amount);
  if (rounded == rounded.roundToDouble()) return rounded.toInt().toString();
  return rounded.toStringAsFixed(2);
}

/// Customer or supplier picker: name, phone number, or address.
bool partyMatches(Map<String, dynamic> party, String search) {
  final q = search.trim().toLowerCase();
  if (q.isEmpty) return true;
  const fields = [
    'name',
    'company_name',
    'phone',
    'email',
    'address',
    'billing_address',
    'shipping_address',
    'city',
    'state',
    'pincode',
  ];
  return fields.any((key) => (party[key]?.toString().toLowerCase() ?? '').contains(q));
}

bool paymentMatches(Map<String, dynamic> payment, String search) {
  final q = search.trim().toLowerCase();
  if (q.isEmpty) return true;
  final name = payment['customer_name']?.toString().toLowerCase() ?? '';
  final mode = payment['payment_mode']?.toString().toLowerCase() ?? '';
  final amount = payment['amount']?.toString() ?? '';
  return name.contains(q) || mode.contains(q) || amount.contains(q);
}

String paymentReferenceLabel(Map<String, dynamic> payment) {
  if (payment['reference_type'] == 'invoice') return 'Invoice';
  return 'On account';
}
