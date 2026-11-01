import '../../format.dart';
import '../../ui/kit.dart';

/// Orders & delivery: labels, tones and next steps. Mirrors `lib/fulfilment/rules.ts` on the web.

const deliveryLabels = <String, String>{
  'new': 'New',
  'confirmed': 'Confirmed',
  'packed': 'Packed',
  'ready_for_pickup': 'Ready for pickup',
  'shipped': 'Shipped',
  'out_for_delivery': 'Out for delivery',
  'delivered': 'Delivered',
  'delivery_failed': 'Delivery failed',
  'returned': 'Returned',
  'cancelled': 'Cancelled',
};

/// Delivery status as a pill. Untracked sales show "Not tracked".
(KTone, String) deliveryTone(String? status) {
  final s = status ?? '';
  final label = deliveryLabels[s] ?? 'Not tracked';
  return switch (s) {
    'delivered' => (KTone.positive, label),
    'delivery_failed' || 'cancelled' => (KTone.negative, label),
    'returned' || 'new' => (KTone.due, label),
    'shipped' || 'out_for_delivery' || 'ready_for_pickup' || 'packed' || 'confirmed' => (KTone.brand, label),
    _ => (KTone.neutral, label),
  };
}

const channelLabels = <String, String>{
  'online_store': 'Online store',
  'whatsapp': 'WhatsApp',
  'counter': 'Counter',
  'manual': 'Manual',
  'sales_order': 'Sales order',
};

/// The "needs action" buckets, in the order the web shows them.
const needsBuckets = <(String, String)>[
  ('to_confirm', 'To confirm'),
  ('payment_pending', 'Payment pending'),
  ('to_pack', 'To pack'),
  ('to_dispatch', 'To dispatch'),
  ('delivery_failed', 'Delivery failed'),
  ('stale', 'Paid, not dispatched'),
  ('in_transit_late', 'Late in transit'),
];

const fulfilmentTransitions = <String, List<String>>{
  'new': ['confirmed', 'cancelled'],
  'confirmed': ['packed', 'ready_for_pickup', 'shipped', 'cancelled'],
  'packed': ['ready_for_pickup', 'shipped', 'cancelled'],
  'ready_for_pickup': ['delivered', 'cancelled'],
  'shipped': ['out_for_delivery', 'delivered', 'delivery_failed', 'returned'],
  'out_for_delivery': ['delivered', 'delivery_failed', 'returned'],
  'delivery_failed': ['out_for_delivery', 'shipped', 'delivered', 'returned'],
  'delivered': ['returned'],
  'returned': [],
  'cancelled': [],
};

/// The one main next step for a parcel, shown as the primary button.
(String, String)? primaryStep(String? status) => switch (status) {
      'new' => ('confirmed', 'Confirm order'),
      'confirmed' => ('packed', 'Mark packed'),
      'packed' => ('shipped', 'Dispatch'),
      'shipped' => ('out_for_delivery', 'Out for delivery'),
      'out_for_delivery' => ('delivered', 'Mark delivered'),
      'ready_for_pickup' => ('delivered', 'Handed over'),
      _ => null,
    };

const returnStatusLabels = <String, String>{
  'requested': 'Requested',
  'approved': 'Awaiting goods',
  'received': 'Refund due',
  'closed': 'Closed',
  'rejected': 'Rejected',
  'cancelled': 'Cancelled',
};

(KTone, String) returnTone(String status) => switch (status) {
      'requested' => (KTone.due, returnStatusLabels[status]!),
      'approved' => (KTone.brand, returnStatusLabels[status]!),
      'received' => (KTone.due, returnStatusLabels[status]!),
      'closed' => (KTone.positive, returnStatusLabels[status]!),
      'rejected' || 'cancelled' => (KTone.negative, returnStatusLabels[status]!),
      _ => (KTone.neutral, status),
    };

const returnReasonLabels = <String, String>{
  'damaged': 'Damaged or defective',
  'wrong_item': 'Wrong item sent',
  'not_as_described': 'Not as described',
  'size_fit': 'Size or fit',
  'not_needed': 'No longer needed',
  'not_delivered': 'Not delivered (came back)',
  'other': 'Other',
};

String orderMoney(dynamic v) => '₹${enIn(toNum(v), maxFraction: 2)}';

/// "2h", "3d" since a timestamp.
String ageOf(dynamic iso, {DateTime? now}) {
  final t = DateTime.tryParse(iso?.toString() ?? '');
  if (t == null) return '';
  final d = (now ?? DateTime.now()).difference(t.toLocal());
  if (d.inHours < 1) return '${d.inMinutes < 1 ? 1 : d.inMinutes}m';
  if (d.inHours < 48) return '${d.inHours}h';
  return '${d.inDays}d';
}

/// Payment state of an order as a pill: COD reads "COD", not a raw code.
(KTone, String) paymentTone(String? status) => switch (status ?? 'unpaid') {
      'cod' => (KTone.due, 'COD'),
      'paid' => (KTone.positive, 'Paid'),
      'failed' => (KTone.negative, 'Payment failed'),
      final s => statusTone(s),
    };

/// How a returned parcel comes back to the shop. Mirrors `lib/returns/labels.ts`.
const returnMethodLabels = <String, String>{
  'courier_pickup': 'Courier pickup',
  'customer_sends': 'Customer sends it',
  'no_return': 'No need to send it back',
};

const returnMethodHints = <String, String>{
  'courier_pickup': 'Shiprocket collects the parcel from the customer and brings it to your shop.',
  'customer_sends': 'The customer gets your instructions and sends or brings the parcel.',
  'no_return': 'Nothing comes back. The credit note is posted now and no stock is added back.',
};

const pickupStatusLabels = <String, String>{
  'booked': 'Pickup booked',
  'out_for_pickup': 'Out for pickup',
  'pickup_issue': 'Pickup problem',
  'in_transit': 'On the way back',
  'arrived': 'Arrived at shop',
  'cancelled': 'Pickup cancelled',
};

KTone pickupTone(String status) => switch (status) {
      'pickup_issue' => KTone.due,
      'arrived' => KTone.positive,
      'cancelled' => KTone.neutral,
      _ => KTone.brand,
    };

const refundMethodLabels = <String, String>{
  'original_payment': 'Back to original payment',
  'cash': 'Cash',
  'upi': 'UPI',
  'bank': 'Bank',
  'store_credit': 'Keep as credit',
};

const returnEventLabels = <String, String>{
  'requested': 'Return requested',
  'approved': 'Approved',
  'rejected': 'Rejected',
  'pickup_booked': 'Pickup booked',
  'pickup_status': 'Pickup update',
  'pickup_cancelled': 'Pickup cancelled',
  'received': 'Received at the shop',
  'refund_pending': 'Refund on its way',
  'refunded': 'Refunded',
  'refund_failed': 'Refund failed',
  'cancelled': 'Cancelled',
};

const _livePickupStatuses = ['booked', 'out_for_pickup', 'pickup_issue'];

/// True while a booked courier can still be called off (not yet picked up).
bool hasLivePickup(Map<String, dynamic> r) {
  final id = r['carrier_order_id']?.toString() ?? '';
  return id.isNotEmpty && _livePickupStatuses.contains(r['pickup_status']);
}

/// What the shop types when choosing how a return comes back (approving, or starting a return).
class ReturnWayForm {
  ReturnWayForm({this.method = 'customer_sends', this.instructions = '', this.address = '', this.pincode = '', this.phone = '', this.weightKg = ''});

  String method;
  String instructions;
  String address;
  String pincode;
  String phone;
  String weightKg;

  /// The form to start with. Courier pickup only when Shiprocket is connected and the pickup
  /// address and PIN are known (or the server fills them in, as when starting a return).
  factory ReturnWayForm.initial({
    required bool shiprocketConnected,
    Map<String, dynamic>? pickup,
    String? defaultInstructions,
    bool serverFillsPickup = false,
  }) {
    final address = pickup?['address']?.toString() ?? '';
    final pin = pickup?['pincode']?.toString() ?? '';
    final known = serverFillsPickup || (address.trim().isNotEmpty && RegExp(r'^\d{6}$').hasMatch(pin));
    final weight = pickup?['weight_kg'];
    return ReturnWayForm(
      method: shiprocketConnected && known ? 'courier_pickup' : 'customer_sends',
      instructions: defaultInstructions ?? '',
      address: address,
      pincode: pin,
      phone: pickup?['phone']?.toString() ?? '',
      weightKg: weight == null ? '' : plainNumber(weight),
    );
  }

  /// Why the form cannot be sent. Only a typed PIN must be 6 digits; blanks are filled by the server.
  String? get error {
    if (method != 'courier_pickup') return null;
    if (pincode.trim().isNotEmpty && !RegExp(r'^\d{6}$').hasMatch(pincode.trim())) return 'Enter a 6-digit PIN code';
    if (weightKg.trim().isNotEmpty && !((num.tryParse(weightKg.trim()) ?? 0) > 0)) return 'Enter the parcel weight in kg';
    return null;
  }

  /// The pickup details alone (for booking again).
  Map<String, dynamic> get pickupBody => {
        if (address.trim().isNotEmpty) 'address': address.trim(),
        if (pincode.trim().isNotEmpty) 'pincode': pincode.trim(),
        if (phone.trim().isNotEmpty) 'phone': phone.trim(),
        if (weightKg.trim().isNotEmpty) 'weight_kg': weightKg.trim(),
      };

  /// The request fields for the chosen way back.
  Map<String, dynamic> get body => switch (method) {
        'courier_pickup' => {'method': method, 'pickup': pickupBody},
        'customer_sends' => {'method': method, if (instructions.trim().isNotEmpty) 'instructions': instructions.trim()},
        _ => {'method': method},
      };
}

/// `"2.5"` stays, `"1.000"` or `1.0` becomes `1`.
String plainNumber(dynamic v) {
  final n = num.tryParse('$v');
  if (n == null) return '$v';
  return n == n.roundToDouble() ? '${n.toInt()}' : '$n';
}

/// The least of what is left to refund and what the gateway can still take back.
num originalRefundAmount(num refundable, num max) => refundable < max ? refundable : max;
