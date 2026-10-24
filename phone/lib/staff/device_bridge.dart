import 'package:flutter/services.dart';

/// What the phone itself can tell us: a keystore signing key, nearby Wi-Fi, root / emulator hints.
/// Backed by `StaffDeviceChannel.kt`. Tests swap in a fake.
abstract class StaffDeviceBridge {
  /// Creates the key on first use. Returns `(publicKeyBase64, hardwareBacked)`.
  Future<(String, bool)> ensureKey();
  Future<String> sign(String text);
  Future<void> deleteKey();
  Future<List<Map<String, dynamic>>> wifiScan();
  Future<Map<String, dynamic>> integrity();
  Future<Map<String, String>> deviceInfo();
}

class PlatformStaffDeviceBridge implements StaffDeviceBridge {
  static const _channel = MethodChannel('khatario/staff_device');

  @override
  Future<(String, bool)> ensureKey() async {
    final res = Map<String, dynamic>.from(await _channel.invokeMethod<Map>('ensureKey') ?? const {});
    return (res['public_key'] as String, res['hardware_backed'] == true);
  }

  @override
  Future<String> sign(String text) async => (await _channel.invokeMethod<String>('sign', {'text': text}))!;

  @override
  Future<void> deleteKey() => _channel.invokeMethod<void>('deleteKey');

  @override
  Future<List<Map<String, dynamic>>> wifiScan() async {
    final list = await _channel.invokeMethod<List>('wifiScan') ?? const [];
    return [for (final w in list) Map<String, dynamic>.from(w as Map)];
  }

  @override
  Future<Map<String, dynamic>> integrity() async =>
      Map<String, dynamic>.from(await _channel.invokeMethod<Map>('integrity') ?? const {});

  @override
  Future<Map<String, String>> deviceInfo() async {
    final res = await _channel.invokeMethod<Map>('deviceInfo') ?? const {};
    return {for (final e in res.entries) '${e.key}': '${e.value}'};
  }
}
