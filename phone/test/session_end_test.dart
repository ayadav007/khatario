import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/main.dart';

void main() {
  test('a wrong password is not a signed-out session', () {
    expect(sessionWasEnded(401, null, 'Invalid phone number or password'), isFalse);
    expect(sessionWasEnded(403, 'FORBIDDEN', 'Authentication required'), isFalse);
  });

  test('another device signing in ends this session', () {
    expect(sessionWasEnded(401, 'SESSION_REVOKED', 'Session revoked or expired'), isTrue);
    expect(sessionWasEnded(401, null, 'Authentication required'), isTrue);
    expect(sessionWasEnded(401, 'UNAUTHENTICATED', 'Authentication required'), isTrue);
  });

  test('the signed-out phone points at the phone that is still signed in', () {
    final note = signedOutNotice(replaced: true);
    expect(note, contains('Plan & billing'));
    expect(note, isNot(contains('http')));
    expect(signedOutNotice(replaced: false), 'Signed out. Sign in again to continue.');
  });

  test('the phone is told once, then returns to sign-in', () async {
    final dio = Dio();
    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        handler.resolve(Response(
          requestOptions: options,
          statusCode: 401,
          data: {'error': 'Session revoked or expired', 'code': 'SESSION_REVOKED'},
        ));
      },
    ));
    final api = KhatarioApi(dio);
    final seen = <String?>[];
    api.watchSession((error) => seen.add(error.code));

    await expectLater(api.getJson('/api/invoices'), throwsA(isA<ApiException>()));
    await expectLater(api.getJson('/api/customers'), throwsA(isA<ApiException>()));
    expect(seen, ['SESSION_REVOKED']);
  });
}
