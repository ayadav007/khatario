import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/session.dart';

import 'walk_fixtures.dart';

/// One request the phone sent during the walk.
class WalkRequest {
  WalkRequest(this.method, this.path, this.where, this.body);

  final String method;
  final String path;

  /// The page path the walker was on (`More › Reports › GST reports`).
  final String where;

  /// The JSON body sent, empty for a GET.
  final String body;
}

/// A fake server for the walk. It answers every GET from [WalkFixtures], records every request,
/// and answers any write with a bare success so a stray write is seen, not hidden.
class WalkApi {
  WalkApi(this.fixtures) {
    final dio = Dio(BaseOptions(baseUrl: 'https://x.test', validateStatus: (s) => s != null && s < 500));
    dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
      final path = o.uri.hasQuery ? '${o.uri.path}?${o.uri.query}' : o.uri.path;
      requests.add(WalkRequest(o.method, path, where, o.data is Map ? jsonEncode(o.data) : ''));
      if (o.method != 'GET') {
        h.resolve(Response(requestOptions: o, statusCode: 200, data: <String, dynamic>{'success': true}));
        return;
      }
      if (o.responseType == ResponseType.bytes) {
        h.resolve(Response(requestOptions: o, statusCode: 200, data: <int>[0x25, 0x50, 0x44, 0x46]));
        return;
      }
      final reply = fixtures.reply(o.uri);
      if (reply == null) {
        missing.putIfAbsent(o.uri.path, () => where);
        h.resolve(Response(requestOptions: o, statusCode: 200, data: <String, dynamic>{}));
        return;
      }
      // A JSON round trip, so the screens get the plain maps and lists a real reply decodes to.
      h.resolve(Response(requestOptions: o, statusCode: 200, data: jsonDecode(jsonEncode(reply))));
    }));
    api = KhatarioApi(dio);
  }

  final WalkFixtures fixtures;
  late final KhatarioApi api;
  final requests = <WalkRequest>[];

  /// GET paths with no fixture: path to the page that asked first.
  final missing = <String, String>{};

  /// Set by the walker as it moves, so a request carries the page that sent it.
  String where = '';

  Iterable<WalkRequest> get writes => requests.where((r) => r.method != 'GET');

  AppSession session({required Map<String, dynamic> raw}) => AppSession(api, raw);
}
