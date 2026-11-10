import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/session.dart';

const forbiddenIdentityKeys = ['business_id', 'user_id', 'created_by', 'approved_by', 'rejected_by'];

typedef Reply = (int, Object?);
typedef Handler = FutureOr<Reply> Function(RequestOptions o, Map body);

/// A session whose server answers through [handler] and records every request.
(AppSession, List<RequestOptions>) recordedSession(Handler handler) {
  final sent = <RequestOptions>[];
  final dio = Dio(BaseOptions(baseUrl: 'https://x.test', validateStatus: (s) => s != null && s < 500));
  dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) async {
    sent.add(o);
    final body = o.data is Map ? Map<String, dynamic>.from(o.data as Map) : <String, dynamic>{};
    final r = await handler(o, body);
    h.resolve(Response(requestOptions: o, statusCode: r.$1, data: r.$2));
  }));
  return (AppSession(KhatarioApi(dio), {'user': {'id': 'u'}, 'business': {'id': 'b'}}), sent);
}

Iterable<RequestOptions> requestsOf(List<RequestOptions> sent, String method, String path) =>
    sent.where((o) => o.method == method && o.uri.path == path);
int requestCount(List<RequestOptions> sent, String method, String path) => requestsOf(sent, method, path).length;
Map lastBody(List<RequestOptions> sent, String method, String path) => requestsOf(sent, method, path).last.data as Map;

void expectNoIdentity(Map body) {
  for (final k in forbiddenIdentityKeys) {
    expect(body.containsKey(k), isFalse, reason: '$k must not be sent');
  }
}

Future<void> pumpScreen(WidgetTester t, Widget screen) async {
  t.view.physicalSize = const Size(800, 2400);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.resetPhysicalSize);
  addTearDown(t.view.resetDevicePixelRatio);
  // A fresh key, so a second screen in the same test starts from its own state.
  await t.pumpWidget(MaterialApp(home: KeyedSubtree(key: UniqueKey(), child: screen)));
  await t.pumpAndSettle();
}

/// Text inside the open bottom sheet (the screen behind may show the same words).
Finder inSheet(String text) => find.descendant(of: find.byType(BottomSheet), matching: find.text(text));
