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
  KhatarioApi(this.dio);

  final Dio dio;

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
    return KhatarioApi(dio);
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
      throw ApiException(body['error']?.toString() ?? 'Request failed (${res.statusCode})', status: res.statusCode, code: body['code']?.toString());
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
      throw ApiException(_errorFromBytes(bytes) ?? 'Request failed (${res.statusCode})', status: res.statusCode);
    }
    return bytes;
  }

  static String? _errorFromBytes(List<int> bytes) {
    try {
      final decoded = jsonDecode(utf8.decode(bytes));
      return decoded is Map ? decoded['error']?.toString() : null;
    } catch (_) {
      return null;
    }
  }

  Map<String, dynamic> _map(Response<dynamic> res) {
    final data = res.data;
    final body = data is Map<String, dynamic> ? data : <String, dynamic>{};
    if ((res.statusCode ?? 500) >= 400) {
      throw ApiException(
        body['error']?.toString() ?? 'Request failed (${res.statusCode})',
        status: res.statusCode,
        code: body['code']?.toString(),
      );
    }
    return body;
  }
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
