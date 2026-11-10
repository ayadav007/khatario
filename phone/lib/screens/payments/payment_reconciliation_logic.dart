import '../../format.dart';
import '../docs/doc_logic.dart';

/// Website status filter, in its order. The key goes to `status`; `all` sends none.
const kReconStatusFilters = <(String, String)>[
  ('requires_review', 'Requires review'),
  ('pending', 'Pending'),
  ('success', 'Success'),
  ('failed', 'Failed'),
  ('all', 'All'),
];

/// One row of `GET /api/payments?reconciliation=1` (`payment_transactions`): a gateway transaction.
class PaymentTx {
  const PaymentTx({
    required this.id,
    required this.orderId,
    required this.amount,
    required this.currency,
    required this.status,
    required this.method,
    required this.provider,
    required this.utr,
    required this.providerPaymentId,
    required this.rawPayload,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String orderId;
  final num amount;
  final String currency;
  final String status;
  final String method;
  final String provider;
  final String? utr;
  final String? providerPaymentId;
  final Map<String, dynamic> rawPayload;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  /// `₹1,180`, or `USD 12.5` for another currency (the website's `formatMoney`).
  String get amountText => currency.isEmpty || currency.toUpperCase() == 'INR'
      ? inr(amount, maxFraction: 2)
      : '${currency.toUpperCase()} ${enIn(amount, maxFraction: 2)}';

  /// The website shows the first 8 characters of the order id.
  String get shortOrderId => orderId.length > 8 ? orderId.substring(0, 8) : orderId;

  /// `utr || provider_payment_id || '-'`.
  String get reference => utr ?? providerPaymentId ?? '-';

  String get statusLabel => switch (status) {
        'requires_review' => 'Requires review',
        'pending' => 'Pending',
        'success' => 'Success',
        'failed' => 'Failed',
        _ => status.isEmpty ? '-' : status[0].toUpperCase() + status.substring(1).replaceAll('_', ' '),
      };

  /// The website's `pickValidation`: `webhook_validation`, else `manual_validation`, else null.
  Object? get validation => rawPayload['webhook_validation'] ?? rawPayload['manual_validation'];

  DateTime? get when => updatedAt ?? createdAt;

  static PaymentTx? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = docText(json['id']);
    if (id.isEmpty) return null;
    String? text(String key) {
      final v = docText(json[key]).trim();
      return v.isEmpty ? null : v;
    }

    final raw = json['raw_payload'];
    return PaymentTx(
      id: id,
      orderId: docText(json['order_id']),
      amount: docNum(json['amount']) ?? 0,
      currency: docText(json['currency']),
      status: docText(json['status']),
      method: docText(json['method']),
      provider: docText(json['provider']),
      utr: text('utr'),
      providerPaymentId: text('provider_payment_id'),
      rawPayload: raw is Map ? Map<String, dynamic>.from(raw) : const {},
      createdAt: docDate(json['created_at']),
      updatedAt: docDate(json['updated_at']),
    );
  }
}

List<PaymentTx> paymentTransactions(dynamic list) =>
    list is List ? list.map(PaymentTx.fromJson).whereType<PaymentTx>().toList() : const [];

/// The three actions of `POST /api/payments/manual-action`.
enum ReconAction {
  markPaid('mark_paid', 'Mark as paid'),
  markFailed('mark_failed', 'Mark as failed'),
  retryVerification('retry_verification', 'Retry verification');

  const ReconAction(this.wire, this.label);

  final String wire;
  final String label;
}

/// The website: `requires_review` can be marked paid or failed; `pending` can be retried; nothing else.
List<ReconAction> reconActions(String status) => switch (status) {
      'requires_review' => const [ReconAction.markPaid, ReconAction.markFailed],
      'pending' => const [ReconAction.retryVerification],
      _ => const [],
    };

/// The server takes the business and the user from the session.
Map<String, dynamic> manualActionBody(String transactionId, ReconAction action) => {
      'transaction_id': transactionId,
      'action': action.wire,
    };

/// What the owner is asked before the action: which payment, how much, and what changes.
String reconConfirmText(ReconAction action, PaymentTx tx) {
  final what = 'the ${tx.amountText}${tx.provider.isEmpty ? '' : ' ${tx.provider}'} payment for order ${tx.shortOrderId}';
  return switch (action) {
    ReconAction.markPaid =>
      'Mark $what as paid? The sales order is updated to match, and this is recorded in the audit trail.',
    ReconAction.markFailed =>
      'Mark $what as failed? The sales order is updated to match, and this is recorded in the audit trail.',
    ReconAction.retryVerification => 'Ask the gateway to verify $what again?',
  };
}
