import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api.dart' show ApiException, apiBaseUrl;
import 'device_bridge.dart';

const staffAppVersion = '1.0.0';
const pairingQrPrefix = 'KHSTAFF1:';

/// Text the server checks the signature against (see lib/hr/staff-app/device-auth.ts).
String canonicalRequest(String method, String path, int timestampMs, String body) {
  final hash = sha256.convert(utf8.encode(body)).toString();
  return '${method.toUpperCase()}\n$path\n$timestampMs\n$hash';
}

/// "khstaff1:ABCDEFGHJK", "abcde-fghjk" and "ABCDE FGHJK" all become "ABCDEFGHJK".
String normalizePairingCode(String raw) {
  var text = raw.trim();
  if (text.toUpperCase().startsWith(pairingQrPrefix)) text = text.substring(pairingQrPrefix.length);
  return text.toUpperCase().replaceAll(RegExp('[^A-Z0-9]'), '');
}

class StaffLink {
  const StaffLink({required this.deviceId, required this.employeeName, required this.businessName});
  final String deviceId;
  final String employeeName;
  final String businessName;
}

/// Khatario Staff server calls. After linking, every request is signed by the keystore key.
class StaffApi {
  StaffApi(this.dio, this.device, this.prefs);

  final Dio dio;
  final StaffDeviceBridge device;
  final SharedPreferences prefs;

  static const _kDevice = 'staff.device_id';
  static const _kEmployee = 'staff.employee_name';
  static const _kBusiness = 'staff.business_name';
  static const _kOffset = 'staff.clock_offset_ms';

  static Future<StaffApi> open({StaffDeviceBridge? device}) async {
    final dio = Dio(
      BaseOptions(
        baseUrl: apiBaseUrl,
        connectTimeout: const Duration(seconds: 20),
        receiveTimeout: const Duration(seconds: 40),
        headers: const {'Accept': 'application/json'},
        validateStatus: (status) => status != null && status < 600,
      ),
    );
    return StaffApi(dio, device ?? PlatformStaffDeviceBridge(), await SharedPreferences.getInstance());
  }

  StaffLink? get link {
    final id = prefs.getString(_kDevice);
    if (id == null) return null;
    return StaffLink(
      deviceId: id,
      employeeName: prefs.getString(_kEmployee) ?? '',
      businessName: prefs.getString(_kBusiness) ?? '',
    );
  }

  int get _now => DateTime.now().millisecondsSinceEpoch + (prefs.getInt(_kOffset) ?? 0);

  void _learnClock(Object? data) {
    if (data is Map && data['server_time'] is num) {
      final offset = (data['server_time'] as num).toInt() - DateTime.now().millisecondsSinceEpoch;
      prefs.setInt(_kOffset, offset);
    }
  }

  Future<void> forget() async {
    await prefs.remove(_kDevice);
    await prefs.remove(_kEmployee);
    await prefs.remove(_kBusiness);
    await device.deleteKey();
  }

  Map<String, dynamic> _body(Response<dynamic> res) {
    final data = res.data;
    _learnClock(data);
    final body = data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
    final status = res.statusCode ?? 500;
    if (status >= 400) {
      final message = body['error']?.toString();
      throw ApiException(
        (message == null || message.isEmpty) ? 'Request failed ($status)' : message,
        status: status,
        code: body['code']?.toString(),
      );
    }
    return body;
  }

  /// Links this phone with the owner's one-time code.
  Future<StaffLink> pair(String code) async {
    final (publicKey, hardware) = await device.ensureKey();
    final info = await device.deviceInfo();
    final res = await dio.post<dynamic>('/api/staff-app/pair', data: {
      'code': normalizePairingCode(code),
      'public_key': publicKey,
      'hardware_backed': hardware,
      'device': {...info, 'app_version': staffAppVersion},
    });
    final body = _body(res);
    final link = StaffLink(
      deviceId: body['device_id'] as String,
      employeeName: (body['employee'] as Map?)?['name']?.toString() ?? '',
      businessName: (body['business'] as Map?)?['name']?.toString() ?? '',
    );
    await prefs.setString(_kDevice, link.deviceId);
    await prefs.setString(_kEmployee, link.employeeName);
    await prefs.setString(_kBusiness, link.businessName);
    return link;
  }

  Future<Map<String, dynamic>> _signed(String method, String path, [Map<String, dynamic>? json]) async {
    final link = this.link;
    if (link == null) throw ApiException('This phone is not linked.', status: 401, code: 'STAFF_UNSIGNED');
    Future<Response<dynamic>> send() async {
      final body = json == null ? '' : jsonEncode(json);
      final ts = _now;
      final signature = await device.sign(canonicalRequest(method, path, ts, body));
      return dio.request<dynamic>(
        path,
        data: json == null ? null : body,
        options: Options(method: method, contentType: json == null ? null : 'application/json', headers: {
          'x-staff-device': link.deviceId,
          'x-staff-timestamp': '$ts',
          'x-staff-signature': signature,
        }),
      );
    }

    var res = await send();
    // The phone clock was off: the reply carried the server time, so one retry fixes it.
    if (res.statusCode == 401 && res.data is Map && (res.data as Map)['code'] == 'CLOCK_SKEW') {
      _learnClock(res.data);
      res = await send();
    }
    return _body(res);
  }

  Future<Map<String, dynamic>> status() => _signed('GET', '/api/staff-app/status');

  Future<Map<String, dynamic>> challenge() => _signed('POST', '/api/staff-app/challenge', const {});

  /// Sends the setup photos for the enrollment a manager opened. The manager approves them after.
  Future<Map<String, dynamic>> enrollFace(String enrollmentId, String consentVersion, List<Map<String, dynamic>> photos) =>
      _signed('POST', '/api/staff-app/face/enroll', {
        'enrollment_id': enrollmentId,
        'consent': {'version': consentVersion, 'accepted': true},
        'photos': photos,
      });

  /// `client_time_ms` is the raw phone clock, the same clock the GPS timestamps use.
  Future<Map<String, dynamic>> punch(Map<String, dynamic> evidence) => _signed('POST', '/api/staff-app/punch', {
        ...evidence,
        'client_time_ms': DateTime.now().millisecondsSinceEpoch,
      });
}
