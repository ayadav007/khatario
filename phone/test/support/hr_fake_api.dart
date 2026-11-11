
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/session.dart';

/// Answers `(method, path, body)` with a JSON map, a list, a Future of either, or an [ApiException] to throw.
typedef HrHandler = Object? Function(String method, String path, Map<String, dynamic>? body);

/// A fake server for the attendance, shift and leave screens. Every request is recorded.
class FakeHrApi extends KhatarioApi {
  FakeHrApi(this.handler) : super(Dio());

  final HrHandler handler;
  final calls = <(String method, String path, Map<String, dynamic>? body)>[];

  Future<dynamic> _go(String method, String path, Map<String, dynamic>? body) async {
    calls.add((method, path, body));
    var reply = handler(method, path, body);
    if (reply is Future) reply = await reply;
    if (reply is ApiException) throw reply;
    return reply ?? <String, dynamic>{};
  }

  /// Paths of every call with [method] whose path starts with [prefix].
  List<String> paths(String method, [String prefix = '']) =>
      [for (final c in calls) if (c.$1 == method && c.$2.startsWith(prefix)) c.$2];

  /// Bodies of every call with [method] whose path starts with [prefix].
  List<Map<String, dynamic>?> bodies(String method, String prefix) =>
      [for (final c in calls) if (c.$1 == method && c.$2.startsWith(prefix)) c.$3];

  @override
  Future<Map<String, dynamic>> getJson(String path) async => Map<String, dynamic>.from(await _go('GET', path, null) as Map);

  @override
  Future<dynamic> getData(String path) => _go('GET', path, null);

  @override
  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body, {Map<String, String>? headers}) async =>
      Map<String, dynamic>.from(await _go('POST', path, body) as Map);

  @override
  Future<Map<String, dynamic>> patchJson(String path, Map<String, dynamic> body) async =>
      Map<String, dynamic>.from(await _go('PATCH', path, body) as Map);

  @override
  Future<Map<String, dynamic>> deleteJson(String path, {Map<String, dynamic>? body}) async =>
      Map<String, dynamic>.from(await _go('DELETE', path, body) as Map);

  @override
  Future<Map<String, dynamic>> putJson(String path, Map<String, dynamic> body) async =>
      Map<String, dynamic>.from(await _go('PUT', path, body) as Map);
}

AppSession hrSession(FakeHrApi api) => AppSession(api, {'user': {'id': 'u'}, 'business': {'id': 'b'}});

/// Features the plan gives, in the shape of `GET /api/features/enabled`, and a primary-admin role.
Object? planReply(String path, List<String> features) {
  if (path == '/api/features/enabled') return {'enabledIds': features};
  if (path == '/api/settings/permissions') return {'permissions': <String, dynamic>{}, 'isPrimaryAdmin': true};
  return null;
}

Future<void> openScreen(WidgetTester t, Widget screen) async {
  t.view.physicalSize = const Size(800, 3600);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
  await t.pumpWidget(MaterialApp(home: screen));
  await t.pumpAndSettle();
}
