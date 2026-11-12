import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/session.dart';

/// A fixture from `test/fixtures/reports`, written from the route's reply (see the task report).
Map<String, dynamic> gstFixture(String name) =>
    jsonDecode(File('test/fixtures/reports/$name.json').readAsStringSync()) as Map<String, dynamic>;

/// One reply of the fake server: [body] with [status]. A bare body is a 200.
class GstReply {
  const GstReply(this.body, {this.status = 200});

  final Object? body;
  final int status;
}

/// A session whose server answers each request by [reply] (a [GstReply] or a bare body) and keeps what was sent.
/// Unlike `fakeSession`, the status can differ per request, so a refused action can sit beside good loads.
(AppSession, List<RequestOptions>) gstSession(Object? Function(RequestOptions o) reply, {Map<String, dynamic>? raw}) {
  final sent = <RequestOptions>[];
  final dio = Dio(BaseOptions(baseUrl: 'https://x.test', validateStatus: (s) => s != null && s < 500));
  dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
    sent.add(o);
    final r = reply(o);
    final one = r is GstReply ? r : GstReply(r);
    h.resolve(Response(requestOptions: o, statusCode: one.status, data: one.body));
  }));
  return (AppSession(KhatarioApi(dio), raw ?? {'user': {'id': 'u'}, 'business': {'id': 'b'}}), sent);
}

/// Requests of [method] to [path].
List<RequestOptions> gstCalls(List<RequestOptions> sent, String method, String path) =>
    [for (final o in sent) if (o.method == method && o.uri.path == path) o];
