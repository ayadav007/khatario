import 'device_bridge.dart';
import 'face/face_capture.dart';
import 'location_sampler.dart';
import 'staff_api.dart';

enum PunchStep { starting, face, locating, wifi, sending }

class PunchReason {
  const PunchReason(this.code, this.message);
  final String code;
  final String message;
}

class PunchResult {
  const PunchResult({required this.decision, required this.reasons, this.siteName, this.distanceM, this.wifiMatched = false});

  /// accepted, review or rejected.
  final String decision;
  final List<PunchReason> reasons;
  final String? siteName;
  final int? distanceM;
  final bool wifiMatched;

  factory PunchResult.fromJson(Map<String, dynamic> json) {
    final site = json['site'] is Map ? Map<String, dynamic>.from(json['site'] as Map) : null;
    return PunchResult(
      decision: json['decision']?.toString() ?? 'rejected',
      reasons: [
        for (final r in (json['reasons'] as List? ?? const []))
          if (r is Map) PunchReason('${r['code']}', '${r['message']}'),
      ],
      siteName: site?['name']?.toString(),
      distanceM: (site?['distance_m'] as num?)?.toInt(),
      wifiMatched: json['wifi_matched'] == true,
    );
  }
}

/// Check-in / check-out: server challenge, the face check when the server asks for one, then GPS
/// readings, Wi-Fi and device checks, all signed together.
class PunchFlow {
  PunchFlow({required this.api, required this.device, required this.location, this.face});

  final StaffApi api;
  final StaffDeviceBridge device;
  final LocationSampler location;

  /// Null only where no camera is available; a challenge asking for a face then fails clearly.
  final FaceCapturer? face;

  Future<PunchResult> run(String action, {void Function(PunchStep step, int done, int total)? onStep}) async {
    onStep?.call(PunchStep.starting, 0, 0);
    // Permission first: the challenge expires in two minutes.
    await location.ensureReady();
    final challenge = await api.challenge();
    final sampling = challenge['sampling'] is Map ? Map<String, dynamic>.from(challenge['sampling'] as Map) : const {};
    final count = ((sampling['count'] as num?) ?? 5).toInt().clamp(3, 10);
    final interval = Duration(milliseconds: ((sampling['interval_ms'] as num?) ?? 1500).toInt().clamp(500, 5000));

    // The server decides whether this employee needs the face check, and which actions to ask for.
    FaceCapture? faceCapture;
    final faceChallenge = challenge['face'] is Map ? Map<String, dynamic>.from(challenge['face'] as Map) : null;
    if (faceChallenge != null) {
      final capturer = face;
      if (capturer == null) throw const FaceCheckCancelled('This phone cannot run the face check.');
      onStep?.call(PunchStep.face, 0, 0);
      final steps = [for (final s in (faceChallenge['steps'] as List? ?? const [])) '$s'];
      faceCapture = await capturer.liveness(steps, timeoutMs: ((faceChallenge['timeout_ms'] as num?) ?? 25000).toInt());
      if (faceCapture == null) throw const FaceCheckCancelled();
    }

    final integrity = device.integrity();
    onStep?.call(PunchStep.locating, 0, count);
    final samples = await _sampleWithProgress(count, interval, (n) => onStep?.call(PunchStep.locating, n, count));

    onStep?.call(PunchStep.wifi, 0, 0);
    final wifi = await device.wifiScan().catchError((_) => <Map<String, dynamic>>[]);

    onStep?.call(PunchStep.sending, 0, 0);
    final res = await api.punch({
      'nonce': challenge['nonce'],
      'action': action,
      'samples': samples,
      'wifi': wifi,
      'signals': await integrity.catchError((_) => <String, dynamic>{}),
      if (faceCapture != null) 'face': faceCapture.toJson(),
    });
    return PunchResult.fromJson(res);
  }

  Future<List<Map<String, dynamic>>> _sampleWithProgress(int count, Duration interval, void Function(int) progress) async {
    final out = <Map<String, dynamic>>[];
    for (var i = 0; i < count; i++) {
      final one = await location.sample(count: 1, interval: Duration.zero);
      out.addAll(one);
      progress(i + 1);
      if (i < count - 1) await Future<void>.delayed(interval);
    }
    return out;
  }
}
