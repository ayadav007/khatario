import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart' show Color;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../api.dart';

/// Android channel for every Khatario alert. Must match the server (PUSH_CHANNEL_ALERTS) and the
/// manifest default channel id. Created here before the device is registered, so the first push
/// already lands on it with sound and vibration; Android keeps whatever the user changes later.
const String kPushChannelId = 'khatario_alerts';
const String kPushChannelName = 'Khatario alerts';
const String kPushChannelDescription = 'Payment reminders, orders, Supplier Hub updates and other business alerts';

/// Reported to the server as app_id; the staff flavour is not wired for push in this pass.
const String kPushAppId = 'com.khatario.phone';

/// A tap on a push notification, parsed from the FCM `data` block.
@immutable
class PushTap {
  const PushTap({required this.href, this.businessId, this.notificationId, this.type, this.referenceType, this.referenceId});

  /// Site path the server chose (`/invoices/<id>`, `/supply-orders/<id>`, ...); `/notifications` when absent.
  final String href;
  final String? businessId;
  final String? notificationId;
  final String? type;
  final String? referenceType;
  final String? referenceId;

  /// Only a plain site path is ever followed, whatever the payload says.
  static String safePath(Object? value) {
    final v = value?.toString().trim() ?? '';
    if (!v.startsWith('/') || v.startsWith('//') || v.contains(RegExp(r'''[\s<>"'`]'''))) return '/notifications';
    return v;
  }

  static PushTap fromData(Map<String, dynamic> data) {
    String? s(String key) {
      final v = data[key]?.toString().trim();
      return v == null || v.isEmpty ? null : v;
    }

    return PushTap(
      href: safePath(data['href']),
      businessId: s('business_id'),
      notificationId: s('notification_id'),
      type: s('type'),
      referenceType: s('reference_type'),
      referenceId: s('reference_id'),
    );
  }

  /// True when the alert belongs to a business other than the one the session is on.
  bool isForAnotherBusiness(String? currentBusinessId) =>
      businessId != null && currentBusinessId != null && businessId != currentBusinessId;
}

/// FCM for the tenant app. Everything degrades to "no push" when Firebase is not configured
/// (no google-services.json), when the user denies the permission, or offline: the in-app
/// notification list keeps working either way.
class PushService {
  PushService._();
  static final PushService instance = PushService._();

  /// Taps waiting for the shell. The shell clears it once it has opened the screen.
  final ValueNotifier<PushTap?> pendingTap = ValueNotifier<PushTap?>(null);

  final FlutterLocalNotificationsPlugin _local = FlutterLocalNotificationsPlugin();
  bool _initialised = false;
  bool _firebaseReady = false;
  String? _token;
  KhatarioApi? _api;
  String? _lastError;

  bool get firebaseReady => _firebaseReady;
  String? get lastError => _lastError;

  /// Whether the OS currently lets this app post notifications (null before init or off Android).
  Future<bool?> notificationsAllowed() async {
    if (!Platform.isAndroid) return null;
    try {
      return await _local.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()?.areNotificationsEnabled();
    } catch (_) {
      return null;
    }
  }

  /// Call once at startup. Creates the channel, wires foreground and tap handling, starts
  /// Firebase if the app was built with google-services.json.
  Future<void> init() async {
    if (_initialised || !Platform.isAndroid) return;
    _initialised = true;

    const android = AndroidInitializationSettings('ic_stat_khatario');
    await _local.initialize(
      settings: const InitializationSettings(android: android),
      onDidReceiveNotificationResponse: (response) {
        final data = _decodePayload(response.payload);
        if (data != null) pendingTap.value = PushTap.fromData(data);
      },
    );
    await _local.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()?.createNotificationChannel(
          const AndroidNotificationChannel(
            kPushChannelId,
            kPushChannelName,
            description: kPushChannelDescription,
            importance: Importance.high,
            playSound: true,
            enableVibration: true,
          ),
        );
    // A local-notification tap that launched the app (cold start).
    final launch = await _local.getNotificationAppLaunchDetails();
    if (launch?.didNotificationLaunchApp == true) {
      final data = _decodePayload(launch!.notificationResponse?.payload);
      if (data != null) pendingTap.value = PushTap.fromData(data);
    }

    try {
      await Firebase.initializeApp();
      _firebaseReady = true;
    } catch (e) {
      // No google-services.json in this build, or Firebase refused to start.
      _firebaseReady = false;
      _lastError = 'firebase_not_configured: $e';
      debugPrint('[push] Firebase not available: $e');
      return;
    }

    final messaging = FirebaseMessaging.instance;
    // Foreground: Android shows nothing by itself; show it on our channel.
    FirebaseMessaging.onMessage.listen(_showForeground);
    // Background tap (app was alive) and cold start tap (app was closed).
    FirebaseMessaging.onMessageOpenedApp.listen((m) => pendingTap.value = PushTap.fromData(_dataOf(m)));
    final initial = await messaging.getInitialMessage();
    if (initial != null) pendingTap.value = PushTap.fromData(_dataOf(initial));
    // FCM rotates tokens; keep the server current while someone is signed in.
    messaging.onTokenRefresh.listen((token) {
      _token = token;
      final api = _api;
      if (api != null) _post(api, token);
    });
  }

  /// After sign-in (and on every app start with a session): ask for the Android 13 permission
  /// once, then register the token for the signed-in user. Safe to call repeatedly.
  Future<void> registerForSession(KhatarioApi api) async {
    _api = api;
    if (!_firebaseReady) return;
    try {
      final messaging = FirebaseMessaging.instance;
      final settings = await messaging.requestPermission(alert: true, sound: true, badge: true);
      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        _lastError = 'permission_denied';
        return;
      }
      final token = await messaging.getToken();
      if (token == null || token.isEmpty) {
        _lastError = 'no_token';
        return;
      }
      _token = token;
      await _post(api, token);
    } catch (e) {
      _lastError = 'register_failed: $e';
      debugPrint('[push] register failed: $e');
    }
  }

  /// Before sign-out, while the session cookie is still valid: the server stops sending to
  /// this device. The token stays on the phone and the next sign-in registers it again.
  Future<void> unregister(KhatarioApi api) async {
    final token = _token;
    _api = null;
    if (token == null) return;
    try {
      await api.deleteJson('/api/push/devices', body: {'token': token});
    } catch (e) {
      debugPrint('[push] unregister failed (server drops the device when the session version changes): $e');
    }
  }

  Future<void> _post(KhatarioApi api, String token) async {
    try {
      await api.postJson('/api/push/devices', {
        'token': token,
        'app_id': kPushAppId,
        'platform': 'android',
        'device_label': 'Android ${Platform.operatingSystemVersion}'.substring(0, 60),
      });
      _lastError = null;
    } catch (e) {
      _lastError = 'register_failed: $e';
      debugPrint('[push] device registration failed: $e');
    }
  }

  Future<void> _showForeground(RemoteMessage message) async {
    final data = _dataOf(message);
    final title = (data['title']?.toString().trim().isNotEmpty ?? false) ? data['title'].toString() : (message.notification?.title ?? 'Khatario');
    final body = (data['body']?.toString().trim().isNotEmpty ?? false) ? data['body'].toString() : (message.notification?.body ?? '');
    final key = (data['notification_id'] ?? data['job_id'] ?? message.messageId ?? DateTime.now().millisecondsSinceEpoch).toString();
    await _local.show(
      id: key.hashCode & 0x7fffffff,
      title: title,
      body: body,
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          kPushChannelId,
          kPushChannelName,
          channelDescription: kPushChannelDescription,
          importance: Importance.high,
          priority: Priority.high,
          icon: 'ic_stat_khatario',
          color: const Color(0xFF0F2E24),
          visibility: NotificationVisibility.private,
          // The tag keeps a repeat of the same notification from stacking a second card.
          tag: 'n-$key',
          styleInformation: BigTextStyleInformation(body),
        ),
      ),
      payload: _encodePayload(data),
    );
  }

  static Map<String, dynamic> _dataOf(RemoteMessage m) => Map<String, dynamic>.from(m.data);

  static String _encodePayload(Map<String, dynamic> data) =>
      data.entries.map((e) => '${Uri.encodeComponent(e.key)}=${Uri.encodeComponent(e.value.toString())}').join('&');

  static Map<String, dynamic>? _decodePayload(String? payload) {
    if (payload == null || payload.isEmpty) return null;
    try {
      return Uri.splitQueryString(payload);
    } catch (_) {
      return null;
    }
  }
}
