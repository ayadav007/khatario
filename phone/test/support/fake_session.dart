import 'package:dio/dio.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/session.dart';

/// A session whose server answers every request with [reply] and records what was sent.
/// [status] is the HTTP status of every reply (use 403 to test the no-access state).
(AppSession, List<RequestOptions>) fakeSession(Object? Function(RequestOptions o) reply, {int status = 200}) {
  final sent = <RequestOptions>[];
  final dio = Dio(BaseOptions(baseUrl: 'https://x.test', validateStatus: (s) => s != null && s < 500));
  dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
    sent.add(o);
    h.resolve(Response(requestOptions: o, statusCode: status, data: reply(o)));
  }));
  return (AppSession(KhatarioApi(dio), {'user': {'id': 'u'}, 'business': {'id': 'b'}}), sent);
}
