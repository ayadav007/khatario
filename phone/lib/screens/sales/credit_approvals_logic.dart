import '../docs/doc_logic.dart';
import '../../format.dart';

/// One row of `GET /api/credit-approvals/pending` (website `/credit-approvals`).
class CreditApproval {
  const CreditApproval({
    required this.id,
    required this.status,
    required this.entityName,
    required this.referenceType,
    required this.referenceNumber,
    required this.amount,
    this.requestedBy,
    this.reason,
  });

  final String id;
  final String status;
  final String entityName;

  /// `invoice` or `purchase`.
  final String referenceType;
  final String referenceNumber;
  final num amount;
  final String? requestedBy;
  final String? reason;

  bool get isPending => status == 'pending';

  /// The website heading: `Asha - Invoice INV-9` / `Mehta - Purchase PB-4`.
  String get title => '$entityName - $referenceLabel';

  String get referenceLabel => '${referenceType == 'invoice' ? 'Invoice' : 'Purchase'} $referenceNumber'.trim();

  static CreditApproval? fromJson(dynamic json) {
    if (json is! Map) return null;
    final id = docText(json['id']);
    if (id.isEmpty) return null;
    String? text(String key) {
      final v = docText(json[key]).trim();
      return v.isEmpty ? null : v;
    }

    return CreditApproval(
      id: id,
      status: text('status') ?? 'pending',
      entityName: text('entity_name') ?? 'Party',
      referenceType: text('reference_type') ?? 'invoice',
      referenceNumber: text('reference_number') ?? '',
      amount: docNum(json['reference_amount']) ?? 0,
      requestedBy: text('requested_by_name'),
      reason: text('reason'),
    );
  }
}

List<CreditApproval> creditApprovals(dynamic list) =>
    list is List ? list.map(CreditApproval.fromJson).whereType<CreditApproval>().toList() : const [];

/// `POST /api/credit-approvals/approve`. The signed-in user is the approver; the server takes it from the session.
Map<String, dynamic> approveBody(String approvalId) => {'approval_id': approvalId};

/// `POST /api/credit-approvals/reject`.
Map<String, dynamic> rejectBody(String approvalId, String reason) => {
      'approval_id': approvalId,
      'rejection_reason': reason.trim(),
    };

/// The website refuses a blank reason ("Please provide a rejection reason").
String? rejectReasonError(String reason) => reason.trim().isEmpty ? 'Please provide a rejection reason' : null;

String approveConfirmText(CreditApproval a) =>
    '${a.title} for ${inr(a.amount, maxFraction: 2)} will be allowed past the credit limit.';
