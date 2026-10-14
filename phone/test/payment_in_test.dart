import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/payments/payment_in_logic.dart';

void main() {
  test('an unlinked receipt is one on-account job and omits identity fields', () {
    final jobs = buildPaymentJobs(const PaymentInDraft(
      customerId: 'c1',
      amount: 100,
      paymentMode: 'upi',
      paymentDate: '2026-10-13',
    ));
    expect(jobs, hasLength(1));
    expect(jobs.single.referenceType, isNull);
    expect(jobs.single.toJson().containsKey('created_by'), isFalse);
    expect(jobs.single.toJson().containsKey('business_id'), isFalse);
    expect(jobs.single.toJson()['type'], 'receivable');
  });

  test('one invoice link keeps TDS on that invoice and parks the unused cash', () {
    final jobs = buildPaymentJobs(const PaymentInDraft(
      customerId: 'c1',
      amount: 80,
      tdsAmount: 10,
      tdsSection: '194C',
      paymentDate: '2026-10-13',
      links: [PaymentLinkDraft(id: 'inv', amount: 50, balance: 70, number: 'INV-1')],
    ));
    expect(jobs, hasLength(2));
    expect(jobs.first.referenceId, 'inv');
    expect(jobs.first.tdsAmount, 10);
    expect(jobs.last.amount, 30);
    expect(jobs.last.tdsAmount, 0);
  });

  test('validation matches the website copy', () {
    expect(
      validatePaymentIn(const PaymentInDraft(amount: 0, tdsAmount: 0)),
      'Please enter a valid amount',
    );
    expect(
      validatePaymentIn(const PaymentInDraft(
        amount: 10,
        tdsAmount: 5,
        links: [
          PaymentLinkDraft(id: 'a', amount: 5, balance: 5),
          PaymentLinkDraft(id: 'b', amount: 5, balance: 5),
        ],
      )),
      'TDS can be recorded when the receipt is linked to one invoice',
    );
    expect(paymentMatches({'customer_name': 'Ravi', 'payment_mode': 'cash', 'amount': 10}, 'rav'), isTrue);
    expect(paymentReferenceLabel({'reference_type': 'invoice'}), 'Invoice');
  });
}
