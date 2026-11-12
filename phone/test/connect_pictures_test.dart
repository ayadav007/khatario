import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/chats/contact_picker.dart';
import 'package:khatario_phone/screens/chats/send_message_parts.dart';
import 'package:khatario_phone/screens/chats/send_message_screen.dart';

import 'support/recorded_session.dart';

const _dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
final _png = base64Decode(_dataUrl.split(',').last);

Future<void> _tapText(WidgetTester t, String text, {bool last = false}) async {
  final f = last ? find.text(text).last : find.text(text).first;
  await t.ensureVisible(f);
  await t.tap(f);
  await t.pumpAndSettle();
}

Future<void> _type(WidgetTester t, String label, String text) async {
  final f = find.descendant(of: find.ancestor(of: find.text(label), matching: find.byType(Column)).first, matching: find.byType(TextField)).first;
  await t.ensureVisible(f);
  await t.enterText(f, text);
  await t.pump();
}

Future<void> _fromPhone(WidgetTester t) async {
  await _tapText(t, 'Choose picture');
  await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('From this phone')));
  await t.pumpAndSettle();
}

Reply _handler(RequestOptions o, Map b, {Reply? upload}) {
  final p = o.uri.path;
  if (p == '/api/whatsapp/media' && o.method == 'POST') {
    return upload ?? (200, {'success': true, 'media': {'id': 'm1', 'original_filename': 'a.png', 'file_type': 'image/png', 'media_url': _dataUrl}});
  }
  if (p == '/api/whatsapp/media' && o.method == 'GET') {
    return (200, {'media': [{'id': 'm2', 'original_filename': 'logo.png', 'file_type': 'image/png', 'file_size': 2048, 'media_url': _dataUrl}]});
  }
  if (p == '/api/whatsapp/status') return (200, {'status': 'connected'});
  if (p == '/api/whatsapp/send') return (200, {'success': true});
  if (p == '/api/whatsapp/campaigns' && o.method == 'POST') return (200, {'total_recipients': 1, 'unsubscribed_count': 0, 'status': 'running', 'auto_started': true});
  return (200, <String, dynamic>{});
}

void main() {
  tearDown(() => pickPhonePicture = defaultPickPhonePicture);

  Future<List<RequestOptions>> open(WidgetTester t, {Reply? upload, bool campaign = false}) async {
    final (session, sent) = recordedSession((o, b) => _handler(o, b, upload: upload));
    await pumpScreen(t, SendMessageScreen(session: session));
    if (campaign) await _tapText(t, 'Bulk campaign');
    return sent;
  }

  testWidgets('single Image: pick from the phone, uploads with its type, shows the name, sends mediaUrl once', (t) async {
    pickPhonePicture = () async => PickedPicture('a.png', _png);
    final sent = await open(t);
    await _tapText(t, 'Image');
    await _type(t, 'Phone number (with country code)', '919876543210');
    await _type(t, 'Caption', 'Look at this');
    await _fromPhone(t);
    final upload = requestsOf(sent, 'POST', '/api/whatsapp/media').single;
    final form = upload.data as FormData;
    expect(form.files.single.key, 'file');
    expect(form.files.single.value.contentType.toString(), 'image/png');
    expect(find.text('a.png'), findsOneWidget);
    await _tapText(t, 'Send message');
    await t.tap(inSheet('Send'));
    await t.tap(inSheet('Send'), warnIfMissed: false);
    await t.pumpAndSettle();
    final posts = requestsOf(sent, 'POST', '/api/whatsapp/send').toList();
    expect(posts.length, 1);
    expect(posts.single.data, {'to': '919876543210', 'message': 'Look at this', 'message_type': 'image', 'mediaUrl': _dataUrl});
    expectNoIdentity(posts.single.data as Map);
    expect(find.text('Message sent successfully!'), findsOneWidget);
    expect(find.text('a.png'), findsNothing);
  });

  testWidgets('single Image without a picture is refused first', (t) async {
    final sent = await open(t);
    await _tapText(t, 'Image');
    await _type(t, 'Phone number (with country code)', '919876543210');
    await _tapText(t, 'Send message');
    expect(find.text('Please select an image'), findsOneWidget);
    expect(requestCount(sent, 'POST', '/api/whatsapp/send'), 0);
  });

  testWidgets('a wrong type or an oversized picture is refused before uploading', (t) async {
    pickPhonePicture = () async => PickedPicture('a.bmp', _png);
    final sent = await open(t);
    await _tapText(t, 'Image');
    await _fromPhone(t);
    expect(find.text('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'), findsOneWidget);
    pickPhonePicture = () async => PickedPicture('big.png', List.filled(5 * 1024 * 1024 + 1, 0));
    await _fromPhone(t);
    expect(find.text('File size too large. Maximum size is 5MB.'), findsOneWidget);
    expect(requestCount(sent, 'POST', '/api/whatsapp/media'), 0);
  });

  testWidgets('an upload the server refuses shows its words and leaves no picture', (t) async {
    pickPhonePicture = () async => PickedPicture('a.png', _png);
    await open(t, upload: (400, {'error': 'Failed to upload media'}));
    await _tapText(t, 'Image');
    await _fromPhone(t);
    expect(find.text('Failed to upload media'), findsOneWidget);
    expect(find.text('a.png'), findsNothing);
    expect(find.text('Choose picture'), findsOneWidget);
  });

  testWidgets('a picture can be taken from the media library and removed again', (t) async {
    final sent = await open(t);
    await _tapText(t, 'Image');
    await _tapText(t, 'Choose picture');
    await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('From media library')));
    await t.pumpAndSettle();
    expect(requestsOf(sent, 'GET', '/api/whatsapp/media').single.uri.query, '');
    expect(find.text('logo.png'), findsOneWidget);
    await _tapText(t, 'logo.png');
    expect(find.text('logo.png'), findsOneWidget);
    expect(requestCount(sent, 'POST', '/api/whatsapp/media'), 0);
    await _tapText(t, 'Remove picture');
    expect(find.text('Choose picture'), findsOneWidget);
  });

  testWidgets('media library: empty, error with Try again, no plan', (t) async {
    final (empty, _) = recordedSession((o, b) => (200, {'media': []}));
    await pumpScreen(t, MediaLibraryScreen(session: empty));
    expect(find.text('No pictures yet'), findsOneWidget);
    var fail = true;
    final (session, _) = recordedSession((o, b) => fail ? (400, {'error': 'Failed to fetch media library'}) : _handler(o, b));
    await pumpScreen(t, MediaLibraryScreen(session: session));
    expect(find.text('Failed to fetch media library'), findsOneWidget);
    fail = false;
    await t.tap(find.text('Try again'));
    await t.pumpAndSettle();
    expect(find.text('logo.png'), findsOneWidget);
    final (locked, _) = recordedSession((o, b) => (403, {'error': 'x', 'code': 'FEATURE_NOT_IN_PLAN'}));
    await pumpScreen(t, MediaLibraryScreen(session: locked));
    expect(find.text('Not included in your current plan'), findsOneWidget);
  });

  testWidgets('campaign Image: message_type image with media_url; a picture is needed', (t) async {
    pickPhonePicture = () async => PickedPicture('a.png', _png);
    final sent = await open(t, campaign: true);
    await _tapText(t, 'Image');
    await _type(t, 'Campaign name', 'n');
    await _type(t, 'Caption', 'cap');
    await _type(t, 'Phone numbers (one per line)', '919876543210');
    await _tapText(t, 'Create campaign');
    expect(find.text('Please select an image'), findsOneWidget);
    expect(requestCount(sent, 'POST', '/api/whatsapp/campaigns'), 0);
    await _fromPhone(t);
    await _tapText(t, 'Create campaign');
    await t.tap(inSheet('Start campaign'));
    await t.pumpAndSettle();
    final body = requestsOf(sent, 'POST', '/api/whatsapp/campaigns').single.data as Map;
    expect(body['message_type'], 'image');
    expect(body['media_url'], _dataUrl);
    expectNoIdentity(body);
  });

  testWidgets('a buttons campaign can carry an optional picture header', (t) async {
    pickPhonePicture = () async => PickedPicture('a.png', _png);
    final sent = await open(t, campaign: true);
    await _tapText(t, 'Buttons');
    await _type(t, 'Campaign name', 'n');
    await _type(t, 'Message', 'm');
    await _tapText(t, 'Add quick reply');
    await _type(t, 'Quick reply 1', 'Yes');
    await _type(t, 'Phone numbers (one per line)', '919876543210');
    await _fromPhone(t);
    await _tapText(t, 'Create campaign');
    await t.tap(inSheet('Start campaign'));
    await t.pumpAndSettle();
    final body = requestsOf(sent, 'POST', '/api/whatsapp/campaigns').single.data as Map;
    expect(body['message_type'], 'button');
    expect(body['media_url'], _dataUrl);
  });

  testWidgets('the contact picker shows the plan state', (t) async {
    final (locked, _) = recordedSession((o, b) => (403, {'error': 'x', 'code': 'FEATURE_NOT_IN_PLAN'}));
    await pumpScreen(t, ContactPickerScreen(session: locked, confirmLabel: (n) => 'Use $n'));
    expect(find.text('Not included in your current plan'), findsOneWidget);
    expect(find.text('Try again'), findsNothing);
  });
}
