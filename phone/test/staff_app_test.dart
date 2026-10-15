import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:khatario_phone/staff/device_bridge.dart';
import 'package:khatario_phone/staff/face/face_capture.dart';
import 'package:khatario_phone/staff/face/face_crop.dart';
import 'package:khatario_phone/staff/face/liveness.dart';
import 'package:khatario_phone/staff/location_sampler.dart';
import 'package:khatario_phone/staff/staff_api.dart';
import 'package:khatario_phone/staff/staff_app.dart';
import 'package:shared_preferences/shared_preferences.dart';

class FakeBridge implements StaffDeviceBridge {
  final signed = <String>[];
  bool deleted = false;
  Map<String, dynamic> signals = {'rooted': false, 'emulator': false, 'developer_options': false, 'adb_enabled': false};

  @override
  Future<(String, bool)> ensureKey() async => ('PUBKEY', true);
  @override
  Future<String> sign(String text) async {
    signed.add(text);
    return 'SIG${signed.length}';
  }

  @override
  Future<void> deleteKey() async => deleted = true;
  @override
  Future<List<Map<String, dynamic>>> wifiScan() async => [
        {'bssid': 'a4:2b:b0:11:22:33', 'ssid': 'ShopWiFi', 'rssi': -50, 'connected': true},
      ];
  @override
  Future<Map<String, dynamic>> integrity() async => signals;
  @override
  Future<Map<String, String>> deviceInfo() async => {'model': 'Test phone', 'os_version': 'Android 15'};
}

class FakeSampler implements LocationSampler {
  int calls = 0;
  bool ready = true;

  @override
  Future<void> ensureReady() async {
    if (!ready) throw LocationUnavailable(LocationProblem.serviceOff);
  }

  @override
  Future<List<Map<String, dynamic>>> sample({required int count, required Duration interval}) async {
    calls++;
    return [
      {'lat': 28.6139, 'lng': 77.209, 'accuracy_m': 8.0, 'altitude_m': 216.0, 'timestamp_ms': 1, 'is_mocked': false},
    ];
  }

  @override
  Future<void> openSettings() async {}
}

/// Stands in for the camera: hands back a passed liveness report and photos, or nothing (closed).
class FakeFaceCapturer implements FaceCapturer {
  bool close = false;
  final asked = <List<String>>[];
  final angles = <List<String>>[];

  static final jpeg = Uint8List.fromList([0xff, 0xd8, 0xff, 1, 2, 3]);

  @override
  Future<FaceCapture?> liveness(List<String> steps, {required int timeoutMs}) async {
    asked.add(steps);
    if (close) return null;
    return FaceCapture(
      liveness: {'steps': steps, 'completed': steps, 'passed': true, 'duration_ms': 4000, 'frames': 60, 'face_changes': 0},
      photos: [FacePhoto('start', jpeg), FacePhoto('turn_left', jpeg), FacePhoto('end', jpeg)],
    );
  }

  @override
  Future<List<FacePhoto>?> enroll(List<String> angles) async {
    this.angles.add(angles);
    if (close) return null;
    return [for (final a in angles.take(3)) FacePhoto(a, jpeg)];
  }
}

/// Answers like the server and keeps what was sent.
class FakeServer {
  final requests = <RequestOptions>[];
  Map<String, dynamic>? today;
  String punchDecision = 'accepted';
  String? statusError;

  /// Liveness steps the challenge asks for; null = this employee has no face check.
  List<String>? faceSteps;

  /// The `face` part of /status.
  Map<String, dynamic>? face;

  Dio dio() {
    final dio = Dio(BaseOptions(validateStatus: (s) => s != null && s < 600));
    dio.interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
      requests.add(options);
      handler.resolve(Response(requestOptions: options, statusCode: _status(options), data: _reply(options)));
    }));
    return dio;
  }

  int _status(RequestOptions o) => o.path == '/api/staff-app/status' && statusError != null ? 401 : 200;

  Map<String, dynamic> _reply(RequestOptions o) {
    switch (o.path) {
      case '/api/staff-app/pair':
        return {'device_id': 'dev-1', 'employee': {'name': 'Asha'}, 'business': {'name': 'Gupta Stores'}, 'server_time': 0};
      case '/api/staff-app/status':
        if (statusError != null) return {'error': statusError, 'code': 'DEVICE_REVOKED'};
        return {
          'employee': {'name': 'Asha'},
          'business': {'name': 'Gupta Stores'},
          'today': today,
          'history': [if (today != null) {...today!, 'date': '2026-10-15'}],
          'pending_reviews': 0,
          'face': face,
        };
      case '/api/staff-app/challenge':
        return {
          'nonce': 'nonce-1234567890123456789',
          'sampling': {'count': 3, 'interval_ms': 500},
          'face': faceSteps == null ? null : {'steps': faceSteps, 'photos': 3, 'timeout_ms': 25000},
        };
      case '/api/staff-app/face/enroll':
        face = {'enrolled': false, 'enrollment': null, 'waiting_for_manager': true};
        return {'angles': ['front', 'left', 'right'], 'status': 'captured'};
      case '/api/staff-app/punch':
        today = {'check_in_time': '2026-10-15T04:12:00.000Z', 'check_out_time': null, 'status': 'present'};
        return {
          'decision': punchDecision,
          'reasons': punchDecision == 'accepted' ? [] : [{'code': 'outside_site', 'message': 'You are about 900 m from Main shop.'}],
          'site': {'name': 'Main shop', 'distance_m': 12},
          'wifi_matched': true,
        };
    }
    return {};
  }
}

Future<StaffApi> makeApi(FakeServer server, FakeBridge bridge, {bool linked = false}) async {
  SharedPreferences.setMockInitialValues(linked
      ? {'staff.device_id': 'dev-1', 'staff.employee_name': 'Asha', 'staff.business_name': 'Gupta Stores'}
      : {});
  return StaffApi(server.dio(), bridge, await SharedPreferences.getInstance());
}

void main() {
  livenessTests();

  test('signed text matches the server format', () {
    // Same body hashed by Node: crypto.createHash('sha256').update('{"nonce":"x","n":1}')
    expect(
      canonicalRequest('post', '/api/staff-app/punch', 1760500000000, '{"nonce":"x","n":1}'),
      'POST\n/api/staff-app/punch\n1760500000000\n073b834088b2b9ebbe045c49b75a4d5a5f2d0336fd3d9cec66b332160def947b',
    );
  });

  test('pairing codes from QR or typing come out the same', () {
    expect(normalizePairingCode('KHSTAFF1:ABCDEFGHJK'), 'ABCDEFGHJK');
    expect(normalizePairingCode(' abcde-fghjk '), 'ABCDEFGHJK');
  });

  test('every linked request carries the device id, time and a signature over its body', () async {
    final server = FakeServer();
    final bridge = FakeBridge();
    final api = await makeApi(server, bridge, linked: true);
    await api.punch({'nonce': 'n', 'action': 'check_in'});
    final sent = server.requests.single;
    expect(sent.headers['x-staff-device'], 'dev-1');
    expect(sent.headers['x-staff-signature'], 'SIG1');
    final ts = sent.headers['x-staff-timestamp'] as String;
    expect(bridge.signed.single, canonicalRequest('POST', '/api/staff-app/punch', int.parse(ts), sent.data as String));
  });

  testWidgets('link with a typed code, then check in', (tester) async {
    final server = FakeServer();
    final bridge = FakeBridge();
    final sampler = FakeSampler();
    final api = await makeApi(server, bridge);
    await tester.pumpWidget(StaffApp(api: api, device: bridge, location: sampler));
    await tester.pumpAndSettle();

    expect(find.text('Khatario Staff'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('pair-code')), 'abcde-fghjk');
    await tester.tap(find.text('Link this phone'));
    await tester.pumpAndSettle();

    final pair = server.requests.firstWhere((r) => r.path == '/api/staff-app/pair');
    expect((pair.data as Map)['code'], 'ABCDEFGHJK');
    expect((pair.data as Map)['public_key'], 'PUBKEY');
    expect(find.text('Asha'), findsOneWidget);
    expect(find.text('Not checked in'), findsOneWidget);

    await tester.tap(find.byKey(const Key('punch-button')));
    await tester.pumpAndSettle(const Duration(seconds: 1));

    expect(sampler.calls, 3);
    final punch = server.requests.firstWhere((r) => r.path == '/api/staff-app/punch');
    expect(punch.data, contains('"nonce":"nonce-1234567890123456789"'));
    expect(punch.data, contains('"bssid":"a4:2b:b0:11:22:33"'));
    expect(find.text('Done at Main shop.'), findsOneWidget);
    expect(find.text('Check out'), findsOneWidget);
  });

  testWidgets('a rejected check-in shows why', (tester) async {
    final server = FakeServer()..punchDecision = 'rejected';
    final bridge = FakeBridge();
    final api = await makeApi(server, bridge, linked: true);
    await tester.pumpWidget(StaffApp(api: api, device: bridge, location: FakeSampler()));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('punch-button')));
    await tester.pumpAndSettle(const Duration(seconds: 1));
    expect(find.text('Not recorded.'), findsOneWidget);
    expect(find.text('• You are about 900 m from Main shop.'), findsOneWidget);
  });

  testWidgets('location off stops before asking the server', (tester) async {
    final server = FakeServer();
    final bridge = FakeBridge();
    final api = await makeApi(server, bridge, linked: true);
    await tester.pumpWidget(StaffApp(api: api, device: bridge, location: FakeSampler()..ready = false));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('punch-button')));
    await tester.pumpAndSettle();
    expect(find.text('Turn on location (GPS) to check in.'), findsOneWidget);
    expect(server.requests.where((r) => r.path == '/api/staff-app/challenge'), isEmpty);
  });

  testWidgets('an unlinked phone goes back to the link screen and drops its key', (tester) async {
    final server = FakeServer()..statusError = 'This phone was unlinked. Ask your employer for a new code.';
    final bridge = FakeBridge();
    final api = await makeApi(server, bridge, linked: true);
    await tester.pumpWidget(StaffApp(api: api, device: bridge, location: FakeSampler()));
    await tester.pumpAndSettle();
    expect(find.text('This phone was unlinked. Ask your employer for a new code.'), findsOneWidget);
    expect(find.text('Link this phone'), findsOneWidget);
    expect(bridge.deleted, isTrue);
    expect(api.link, isNull);
  });

  testWidgets('when the server asks, the face check runs first and its photos go with the punch', (tester) async {
    final server = FakeServer()..faceSteps = ['blink', 'turn_left', 'smile'];
    final bridge = FakeBridge();
    final face = FakeFaceCapturer();
    final api = await makeApi(server, bridge, linked: true);
    await tester.pumpWidget(StaffApp(api: api, device: bridge, location: FakeSampler(), face: face));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('punch-button')));
    await tester.pumpAndSettle(const Duration(seconds: 1));

    expect(face.asked.single, ['blink', 'turn_left', 'smile']);
    final punch = server.requests.firstWhere((r) => r.path == '/api/staff-app/punch');
    final body = jsonDecode(punch.data as String) as Map<String, dynamic>;
    expect(body['face']['liveness']['completed'], ['blink', 'turn_left', 'smile']);
    expect([for (final p in body['face']['photos'] as List) p['label']], ['start', 'turn_left', 'end']);
    expect(base64Decode(body['face']['photos'][0]['jpeg'] as String), FakeFaceCapturer.jpeg);
    expect(find.text('Done at Main shop.'), findsOneWidget);
  });

  testWidgets('no face check is shown when the server does not ask for one', (tester) async {
    final server = FakeServer();
    final bridge = FakeBridge();
    final face = FakeFaceCapturer();
    final api = await makeApi(server, bridge, linked: true);
    await tester.pumpWidget(StaffApp(api: api, device: bridge, location: FakeSampler(), face: face));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('punch-button')));
    await tester.pumpAndSettle(const Duration(seconds: 1));
    expect(face.asked, isEmpty);
    final punch = server.requests.firstWhere((r) => r.path == '/api/staff-app/punch');
    expect((jsonDecode(punch.data as String) as Map).containsKey('face'), isFalse);
  });

  testWidgets('closing the camera sends nothing and says so', (tester) async {
    final server = FakeServer()..faceSteps = ['smile', 'blink', 'turn_right'];
    final bridge = FakeBridge();
    final api = await makeApi(server, bridge, linked: true);
    await tester.pumpWidget(StaffApp(api: api, device: bridge, location: FakeSampler(), face: FakeFaceCapturer()..close = true));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('punch-button')));
    await tester.pumpAndSettle(const Duration(seconds: 1));
    expect(find.text('Face check was cancelled.'), findsOneWidget);
    expect(server.requests.where((r) => r.path == '/api/staff-app/punch'), isEmpty);
  });

  testWidgets('face setup: consent first, then the angles go to the manager', (tester) async {
    final server = FakeServer()
      ..face = {
        'enrolled': false,
        'waiting_for_manager': false,
        'enrollment': {
          'id': 'enr-1',
          'expires_at': '2026-10-15T05:00:00.000Z',
          'angles': ['front', 'left', 'right', 'up', 'down'],
          'consent_version': faceConsentVersion,
        },
      };
    final bridge = FakeBridge();
    final face = FakeFaceCapturer();
    final api = await makeApi(server, bridge, linked: true);
    await tester.pumpWidget(StaffApp(api: api, device: bridge, location: FakeSampler(), face: face));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('face-setup-button')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Digital Personal Data Protection Act, 2023'), findsOneWidget);
    expect(find.textContaining('Gupta Stores uses Khatario'), findsOneWidget);
    expect(find.textContaining('Data Protection Board of India'), findsOneWidget);

    // The button does nothing until the employee ticks the box.
    await tester.tap(find.byKey(const Key('face-consent-agree')));
    await tester.pumpAndSettle();
    expect(face.angles, isEmpty);

    await tester.scrollUntilVisible(find.byKey(const Key('face-consent-check')), 300);
    await tester.tap(find.byKey(const Key('face-consent-check')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('face-consent-agree')));
    await tester.pumpAndSettle();

    expect(face.angles.single, ['front', 'left', 'right', 'up', 'down']);
    final sent = server.requests.firstWhere((r) => r.path == '/api/staff-app/face/enroll');
    final body = jsonDecode(sent.data as String) as Map<String, dynamic>;
    expect(body['enrollment_id'], 'enr-1');
    expect(body['consent'], {'version': faceConsentVersion, 'accepted': true});
    expect([for (final p in body['photos'] as List) p['label']], ['front', 'left', 'right']);
    expect(find.text('Face photos sent. Your manager will check and approve them.'), findsOneWidget);
  });

  testWidgets('an old app asks to update instead of showing outdated terms', (tester) async {
    final server = FakeServer()
      ..face = {
        'enrolled': false,
        'waiting_for_manager': false,
        'enrollment': {'id': 'enr-1', 'angles': ['front'], 'consent_version': '2099-01'},
      };
    final bridge = FakeBridge();
    final api = await makeApi(server, bridge, linked: true);
    await tester.pumpWidget(StaffApp(api: api, device: bridge, location: FakeSampler(), face: FakeFaceCapturer()));
    await tester.pumpAndSettle();
    expect(find.text('Update Khatario Staff to set up the face check.'), findsOneWidget);
    expect(find.byKey(const Key('face-setup-button')), findsNothing);
  });
}

/// Frames for [LivenessTracker]: one face, tracking id 7, looking straight unless told otherwise.
FaceFrame frame({double yaw = 0, double eyes = 0.95, double smile = 0.1, int faces = 1, int id = 7}) => FaceFrame(
      faces: faces,
      trackingId: id,
      leftEyeOpen: eyes,
      rightEyeOpen: eyes,
      smiling: smile,
      yaw: yaw,
      pitch: 0,
      box: const Rect.fromLTWH(100, 100, 150, 180),
    );

/// A head turned to the person's own left (or right) by [deg] degrees, as ML Kit reports it.
double ownLeft(double deg) => kOwnLeftIsPositiveYaw ? deg : -deg;

void livenessTests() {
  group('liveness', () {
    test('follows the server steps in order and takes start, turn and end photos', () {
      final t = LivenessTracker(['smile', 'turn_left', 'blink']);
      var ms = 0;
      final labels = <String>[];
      void feed(FaceFrame f, [int times = 1]) {
        for (var i = 0; i < times; i++) {
          final l = t.feed(f, ms += 100);
          if (l != null) labels.add(l);
        }
      }

      feed(frame(), 3);
      expect(t.currentStep, 'smile');
      feed(frame(yaw: ownLeft(40)), 3); // turning first does not count
      expect(t.completed, isEmpty);
      feed(frame(smile: 0.95), 2);
      expect(t.currentStep, 'turn_left');
      feed(frame(yaw: ownLeft(-30)), 3); // the other way
      expect(t.currentStep, 'turn_left');
      feed(frame(yaw: ownLeft(30)), 2);
      expect(t.currentStep, 'blink');
      feed(frame());
      feed(frame(eyes: 0.05));
      feed(frame());
      expect(t.state, LivenessState.finishing);
      feed(frame(), 2);

      expect(t.state, LivenessState.passed);
      expect(labels, ['start', 'turn_left', 'end']);
      final r = t.report();
      expect(r['completed'], ['smile', 'turn_left', 'blink']);
      expect(r['passed'], true);
      expect(r['face_changes'], 0);
      expect(r['duration_ms'], greaterThan(1200));
    });

    test('a different face mid-way fails the check', () {
      final t = LivenessTracker(['blink', 'smile', 'turn_right']);
      for (var i = 0; i < 3; i++) {
        t.feed(frame(), i * 100);
      }
      t.feed(frame(id: 8), 400);
      expect(t.state, LivenessState.failed);
      expect(t.report()['face_changes'], 1);
      expect(t.report()['passed'], false);
    });

    test('two faces in the picture never count, and the check times out', () {
      final t = LivenessTracker(['smile', 'blink', 'turn_left'], timeoutMs: 1000);
      for (var i = 0; i < 5; i++) {
        t.feed(frame(faces: 2), i * 100);
      }
      expect(t.state, LivenessState.lookAtCamera);
      t.feed(frame(), 1500);
      expect(t.state, LivenessState.failed);
    });

    test('setup takes front, left and right, and skips up/down that are not reached', () {
      final t = EnrollTracker(['front', 'left', 'right', 'up', 'down'], optionalMs: 1000);
      var ms = 0;
      final taken = <String>[];
      void feed(FaceFrame f, int times) {
        for (var i = 0; i < times; i++) {
          final a = t.feed(f, ms += 100);
          if (a != null) taken.add(a);
        }
      }

      feed(frame(), 3);
      feed(frame(yaw: ownLeft(30)), 3);
      feed(frame(yaw: ownLeft(-30)), 3);
      feed(frame(), 25); // never tilts
      expect(taken, ['front', 'left', 'right']);
      expect(t.skipped, ['up', 'down']);
      expect(t.done, isTrue);
    });
  });

  group('face photo', () {
    test('upright positions map back to the raw frame for each rotation', () {
      Nv21Frame f(int r) => Nv21Frame(bytes: Uint8List(0), width: 640, height: 480, stride: 640, rotation: r);
      expect(f(270).uprightWidth, 480);
      expect(f(270).rawOf(0, 0), (639, 0));
      expect(f(90).rawOf(0, 0), (0, 479));
      expect(f(180).rawOf(10, 20), (629, 459));
      expect(f(0).rawOf(10, 20), (10, 20));
    });

    test('cuts the face with a margin, upright, as a small JPEG', () {
      const w = 640, h = 480;
      final bytes = Uint8List(w * h * 3 ~/ 2);
      bytes.fillRange(0, w * h, 180); // grey picture
      bytes.fillRange(w * h, bytes.length, 128);
      final frame = Nv21Frame(bytes: bytes, width: w, height: h, stride: w, rotation: 270);
      final jpeg = cropFaceJpeg(frame, const Rect.fromLTWH(140, 200, 200, 240));
      expect(jpeg.sublist(0, 2), [0xff, 0xd8]);
      final decoded = img.decodeJpg(jpeg)!;
      expect(decoded.width, lessThanOrEqualTo(320));
      expect(decoded.height, lessThanOrEqualTo(320));
      final p = decoded.getPixel(decoded.width ~/ 2, decoded.height ~/ 2);
      expect((p.r - 180).abs(), lessThan(4));
      expect((p.g - 180).abs(), lessThan(4));
      expect(jpeg.length, lessThan(300 * 1024));
    });
  });
}
