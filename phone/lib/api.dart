import 'dart:convert';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:path_provider/path_provider.dart';

/// Talks to the existing Khatario server. Identity stays in the session cookies.
/// Override the host with `--dart-define=API_BASE_URL=https://khatario.com`.
const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'https://staging.khatario.com',
);

class KhatarioApi {
  KhatarioApi(this.dio, {this.cookies});

  final Dio dio;
  final CookieJar? cookies;

  /// Set while a user is signed in. A revoked session calls this once, then the app returns to sign-in.
  void Function(ApiException error)? onSessionEnded;
  bool _sessionEndSent = false;

  void watchSession(void Function(ApiException error)? onEnded) {
    onSessionEnded = onEnded;
    _sessionEndSent = false;
  }

  Future<void> clearCookies() async {
    await cookies?.deleteAll();
  }

  static Future<KhatarioApi> open() async {
    final dir = await getApplicationSupportDirectory();
    final jar = PersistCookieJar(
      ignoreExpires: false,
      storage: FileStorage('${dir.path}/khatario-cookies'),
    );
    final dio = Dio(
      BaseOptions(
        baseUrl: apiBaseUrl,
        connectTimeout: const Duration(seconds: 20),
        receiveTimeout: const Duration(seconds: 40),
        headers: const {'Accept': 'application/json'},
        validateStatus: (status) => status != null && status < 500,
      ),
    );
    dio.interceptors.add(CookieManager(jar));
    return KhatarioApi(dio, cookies: jar);
  }

  Future<Map<String, dynamic>> getJson(String path) async {
    final res = await dio.get<dynamic>(path);
    return _map(res);
  }

  /// JSON object or list. List responses are returned as-is.
  Future<dynamic> getData(String path) async {
    final res = await dio.get<dynamic>(path);
    if ((res.statusCode ?? 500) >= 400) {
      final data = res.data;
      final body = data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
      throw _fail(res.statusCode, body['error']?.toString(), body['code']?.toString());
    }
    return res.data;
  }

  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body, {Map<String, String>? headers}) async {
    final res = await dio.post<dynamic>(path, data: body, options: Options(headers: headers));
    return _map(res);
  }

  Future<Map<String, dynamic>> putJson(String path, Map<String, dynamic> body) async {
    final res = await dio.put<dynamic>(path, data: body);
    return _map(res);
  }

  Future<Map<String, dynamic>> patchJson(String path, Map<String, dynamic> body) async {
    final res = await dio.patch<dynamic>(path, data: body);
    return _map(res);
  }

  /// Uploads one image (logo, signature…) and returns the server's JSON (`{ url }`).
  Future<Map<String, dynamic>> uploadImage(String path, {required List<int> bytes, required String fileName, Map<String, String> fields = const {}}) async {
    final form = FormData.fromMap({...fields, 'file': MultipartFile.fromBytes(bytes, filename: fileName)});
    final res = await dio.post<dynamic>(path, data: form);
    return _map(res);
  }

  Future<Map<String, dynamic>> deleteJson(String path) async {
    final res = await dio.delete<dynamic>(path, data: const <String, dynamic>{});
    return _map(res);
  }

  /// Binary download (invoice PDF / PNG). Errors come back as JSON `{ error }`.
  Future<List<int>> getBytes(String path) async {
    final res = await dio.get<List<int>>(path, options: Options(responseType: ResponseType.bytes));
    final bytes = res.data ?? const <int>[];
    if ((res.statusCode ?? 500) >= 400) {
      final parsed = _errorFromBytes(bytes);
      throw _fail(res.statusCode, parsed?.$1, parsed?.$2);
    }
    return bytes;
  }

  static (String?, String?)? _errorFromBytes(List<int> bytes) {
    try {
      final decoded = jsonDecode(utf8.decode(bytes));
      if (decoded is! Map) return null;
      return (decoded['error']?.toString(), decoded['code']?.toString());
    } catch (_) {
      return null;
    }
  }

  ApiException _fail(int? status, String? error, String? code) {
    final message = (error == null || error.isEmpty) ? 'Request failed ($status)' : error;
    final exception = ApiException(message, status: status, code: code);
    final ended = onSessionEnded;
    if (ended != null && !_sessionEndSent && sessionWasEnded(status, code, message)) {
      _sessionEndSent = true;
      ended(exception);
    }
    return exception;
  }

  Map<String, dynamic> _map(Response<dynamic> res) {
    final data = res.data;
    final body = data is Map<String, dynamic> ? data : (data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{});
    if ((res.statusCode ?? 500) >= 400) {
      throw _fail(res.statusCode, body['error']?.toString(), body['code']?.toString());
    }
    return body;
  }
}

/// True when the server rejected this device's login. A wrong password is not this.
bool sessionWasEnded(int? status, String? code, String message) {
  if (status != 401) return false;
  const codes = {'SESSION_REVOKED', 'UNAUTHENTICATED', 'USER_NOT_FOUND', 'BUSINESS_NOT_FOUND'};
  if (code != null && codes.contains(code)) return true;
  final text = message.trim().toLowerCase();
  return text == 'authentication required' ||
      text == 'not authenticated' ||
      text.startsWith('session revoked');
}

class ApiException implements Exception {
  ApiException(this.message, {this.status, this.code});
  final String message;
  final int? status;
  final String? code;

  @override
  String toString() => message;
}

num asNum(dynamic value) {
  if (value is num) return value;
  if (value is String) return num.tryParse(value) ?? 0;
  return 0;
}
