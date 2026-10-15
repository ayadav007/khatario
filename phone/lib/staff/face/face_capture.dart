import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'face_camera_screen.dart';

class FacePhoto {
  const FacePhoto(this.label, this.jpeg);

  /// `start`, a liveness step or `end` for check-in; an angle (`front`, `left`, …) for setup.
  final String label;
  final Uint8List jpeg;

  Map<String, dynamic> toJson() => {'label': label, 'jpeg': base64Encode(jpeg)};
}

/// What the face check produced for one punch: the liveness report and 2–3 face photos.
class FaceCapture {
  const FaceCapture({required this.liveness, required this.photos});

  final Map<String, dynamic> liveness;
  final List<FacePhoto> photos;

  Map<String, dynamic> toJson() => {'liveness': liveness, 'photos': [for (final p in photos) p.toJson()]};
}

/// The employee backed out of the face check.
class FaceCheckCancelled implements Exception {
  const FaceCheckCancelled([this.message = 'Face check was cancelled.']);
  final String message;
}

/// Opens the front camera for a check-in liveness challenge or for face setup. Tests swap in a fake.
abstract class FaceCapturer {
  /// Null when the employee closed the camera.
  Future<FaceCapture?> liveness(List<String> steps, {required int timeoutMs});

  /// One photo per angle taken, or null when closed.
  Future<List<FacePhoto>?> enroll(List<String> angles);
}

class CameraFaceCapturer implements FaceCapturer {
  CameraFaceCapturer(this.navigatorKey);

  final GlobalKey<NavigatorState> navigatorKey;

  @override
  Future<FaceCapture?> liveness(List<String> steps, {required int timeoutMs}) async {
    final result = await navigatorKey.currentState!.push<Object?>(
      MaterialPageRoute(fullscreenDialog: true, builder: (_) => FaceCameraScreen.liveness(steps: steps, timeoutMs: timeoutMs)),
    );
    return result is FaceCapture ? result : null;
  }

  @override
  Future<List<FacePhoto>?> enroll(List<String> angles) async {
    final result = await navigatorKey.currentState!.push<Object?>(
      MaterialPageRoute(fullscreenDialog: true, builder: (_) => FaceCameraScreen.enroll(angles: angles)),
    );
    return result is List<FacePhoto> ? result : null;
  }
}

/// Must match FACE_CONSENT_VERSION in lib/hr/staff-app/face/store.ts; bump both when the text changes.
const faceConsentVersion = '2026-10';

/// Consent notice under India's Digital Personal Data Protection Act, 2023, shown before face setup.
String faceConsentText(String employer) => '''
$employer uses Khatario to check that it is really you when you check in or out with this app.

What is collected
• While you set up: a few photos of your face from different angles.
• At each check-in or check-out: a short camera check (blink, turn, smile) and 2–3 photos of your face.

How it is used
• Your photos are turned into face templates — a list of numbers describing your face. Each check-in is compared only with your own templates, to confirm it is you.
• The comparison runs on Khatario's own servers. Your face data is not sold, not shared with any other company, and not used for anything other than your attendance.

How long it is kept
• Setup photos are deleted once your manager approves or rejects them. Check-in photos are kept only when a check-in needs your manager's review, and are deleted when they decide (at most 14 days).
• Your face templates are kept while you work for $employer and deleted when you leave, or earlier if you withdraw consent.

Your rights
• You may withdraw this consent at any time by telling $employer; your face data will then be deleted and you may be asked to mark attendance another way.
• You may ask $employer to see, correct or erase your data, and raise a grievance with them. If it is not resolved, you may complain to the Data Protection Board of India.

This notice is given under the Digital Personal Data Protection Act, 2023. By tapping "I agree" you give $employer your free and specific consent to use your face data for attendance as described above.''';
