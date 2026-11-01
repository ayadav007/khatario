import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/push/push_service.dart';

void main() {
  const biz = '22222222-2222-4222-8222-222222222222';
  const other = '33333333-3333-4333-8333-333333333333';

  test('a push tap carries the server path and the notification fields', () {
    final tap = PushTap.fromData({
      'href': '/invoices/abc',
      'business_id': biz,
      'notification_id': 'n1',
      'type': 'invoice_overdue',
      'reference_type': 'invoice',
      'reference_id': 'abc',
    });
    expect(tap.href, '/invoices/abc');
    expect(tap.businessId, biz);
    expect(tap.type, 'invoice_overdue');
    expect(tap.referenceId, 'abc');
    expect(tap.isForAnotherBusiness(biz), isFalse);
    expect(tap.isForAnotherBusiness(other), isTrue);
    expect(tap.isForAnotherBusiness(null), isFalse);
  });

  test('only a plain site path is followed; anything else opens the notification list', () {
    expect(PushTap.safePath('https://evil.example/x'), '/notifications');
    expect(PushTap.safePath('//evil.example/x'), '/notifications');
    expect(PushTap.safePath('javascript:alert(1)'), '/notifications');
    expect(PushTap.safePath(null), '/notifications');
    expect(PushTap.safePath('/supply-orders/1?x=1'), '/supply-orders/1?x=1');
    expect(PushTap.fromData(const {}).href, '/notifications');
    expect(PushTap.fromData(const {'business_id': ''}).businessId, isNull);
  });
}
