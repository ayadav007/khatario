import 'dart:ui' show Rect;

/// One camera frame as ML Kit saw it. Angles in degrees, probabilities 0–1, null when unknown.
class FaceFrame {
  const FaceFrame({
    required this.faces,
    this.trackingId,
    this.leftEyeOpen,
    this.rightEyeOpen,
    this.smiling,
    this.yaw,
    this.pitch,
    this.box,
  });

  /// How many faces were found in the frame.
  final int faces;
  final int? trackingId;
  final double? leftEyeOpen;
  final double? rightEyeOpen;
  final double? smiling;

  /// ML Kit headEulerAngleY: positive = face turned towards the right side of the image.
  final double? yaw;

  /// ML Kit headEulerAngleX: positive = looking up.
  final double? pitch;

  /// Face box in the upright picture.
  final Rect? box;
}

/// The front camera's frames are not mirrored before ML Kit, so a person turning to their own left
/// turns towards the right side of the image (positive yaw). Check on a real phone if this changes.
const bool kOwnLeftIsPositiveYaw = true;

const double kTurnDegrees = 25;
const double kFrontalDegrees = 10;
const double kEyesOpen = 0.65;
const double kEyesClosed = 0.25;
const double kSmile = 0.8;

String livenessPrompt(String step) => switch (step) {
      'blink' => 'Blink your eyes',
      'turn_left' => 'Turn your head to your left',
      'turn_right' => 'Turn your head to your right',
      'smile' => 'Smile',
      _ => 'Look at the camera',
    };

enum LivenessState { lookAtCamera, doingStep, finishing, passed, failed }

/// Follows the server's liveness steps across frames. Pure, so tests can feed it frames.
///
/// Photos are taken at three moments: looking straight before the first step (`start`), when a
/// head turn is reached (that step's name), and looking straight again at the end (`end`).
class LivenessTracker {
  LivenessTracker(this.steps, {this.timeoutMs = 25000});

  final List<String> steps;
  final int timeoutMs;

  LivenessState state = LivenessState.lookAtCamera;
  final completed = <String>[];
  int frames = 0;
  int faceChanges = 0;
  String? failure;
  int? _startMs;
  int? _lastMs;
  int? _trackingId;
  int _held = 0;
  bool _sawOpen = false;
  bool _sawClosed = false;
  bool _tookTurnPhoto = false;

  String? get currentStep => state == LivenessState.doingStep ? steps[completed.length] : null;

  String get prompt => switch (state) {
        LivenessState.lookAtCamera => 'Look straight at the camera',
        LivenessState.doingStep => livenessPrompt(currentStep!),
        LivenessState.finishing => 'Look straight at the camera',
        LivenessState.passed => 'Done',
        LivenessState.failed => failure ?? 'Face check failed',
      };

  bool get finished => state == LivenessState.passed || state == LivenessState.failed;

  void _fail(String message) {
    state = LivenessState.failed;
    failure = message;
  }

  bool _frontal(FaceFrame f) =>
      (f.yaw ?? 99).abs() < kFrontalDegrees &&
      (f.pitch ?? 0).abs() < 15 &&
      (f.leftEyeOpen ?? 0) > kEyesOpen &&
      (f.rightEyeOpen ?? 0) > kEyesOpen;

  /// Takes the next frame. Returns a photo label when this frame should be saved, else null.
  String? feed(FaceFrame f, int nowMs) {
    if (finished) return null;
    _startMs ??= nowMs;
    _lastMs = nowMs;
    frames++;
    if (nowMs - _startMs! > timeoutMs) {
      _fail('Took too long. Try again.');
      return null;
    }
    if (f.faces != 1) return null;
    if (f.trackingId != null) {
      if (_trackingId != null && f.trackingId != _trackingId) {
        faceChanges++;
        _fail('Keep your face in view the whole time. Try again.');
        return null;
      }
      _trackingId = f.trackingId;
    }

    switch (state) {
      case LivenessState.lookAtCamera:
        if (_hold(_frontal(f), 3)) {
          state = LivenessState.doingStep;
          return 'start';
        }
        return null;
      case LivenessState.doingStep:
        final step = currentStep!;
        if (_stepDone(step, f)) {
          completed.add(step);
          final label = step.startsWith('turn_') && !_tookTurnPhoto ? step : null;
          if (label != null) _tookTurnPhoto = true;
          state = completed.length == steps.length ? LivenessState.finishing : LivenessState.doingStep;
          return label;
        }
        return null;
      case LivenessState.finishing:
        if (_hold(_frontal(f), 2)) {
          state = LivenessState.passed;
          return 'end';
        }
        return null;
      case LivenessState.passed:
      case LivenessState.failed:
        return null;
    }
  }

  bool _hold(bool ok, int frames) {
    _held = ok ? _held + 1 : 0;
    if (_held >= frames) {
      _held = 0;
      return true;
    }
    return false;
  }

  bool _stepDone(String step, FaceFrame f) {
    final yaw = f.yaw ?? 0;
    final ownLeft = kOwnLeftIsPositiveYaw ? yaw : -yaw;
    switch (step) {
      case 'blink':
        final l = f.leftEyeOpen ?? 0.5;
        final r = f.rightEyeOpen ?? 0.5;
        if (l > kEyesOpen && r > kEyesOpen) {
          if (_sawClosed) {
            _sawOpen = _sawClosed = false;
            return true;
          }
          _sawOpen = true;
        } else if (_sawOpen && l < kEyesClosed && r < kEyesClosed) {
          _sawClosed = true;
        }
        return false;
      case 'turn_left':
        return _hold(ownLeft >= kTurnDegrees, 2);
      case 'turn_right':
        return _hold(ownLeft <= -kTurnDegrees, 2);
      case 'smile':
        return _hold((f.smiling ?? 0) >= kSmile, 2);
    }
    return false;
  }

  /// What the server checks against the challenge (lib/hr/staff-app/face/liveness.ts).
  Map<String, dynamic> report() => {
        'steps': steps,
        'completed': completed,
        'passed': state == LivenessState.passed,
        'duration_ms': _startMs == null ? 0 : _lastMs! - _startMs!,
        'frames': frames,
        'face_changes': faceChanges,
      };
}

/// Guides the employee through the setup angles; one photo per angle.
/// `up` and `down` are skipped if not reached in [optionalMs]; the server needs at least three.
class EnrollTracker {
  EnrollTracker(this.angles, {this.optionalMs = 8000, this.timeoutMs = 60000});

  final List<String> angles;
  final int optionalMs;
  final int timeoutMs;

  final taken = <String>[];
  final skipped = <String>[];
  String? failure;
  int _held = 0;
  int? _startMs;
  int? _angleStartMs;

  String? get current {
    for (final a in angles) {
      if (!taken.contains(a) && !skipped.contains(a)) return a;
    }
    return null;
  }

  bool get done => current == null || failure != null;

  String get prompt => switch (current) {
        'front' => 'Look straight at the camera',
        'left' => 'Slowly turn your head to your left',
        'right' => 'Slowly turn your head to your right',
        'up' => 'Tilt your head up a little',
        'down' => 'Tilt your head down a little',
        null => failure ?? 'Done',
        _ => 'Hold still',
      };

  static bool optional(String angle) => angle == 'up' || angle == 'down';

  bool _matches(String angle, FaceFrame f) {
    final yaw = f.yaw ?? 0;
    final ownLeft = kOwnLeftIsPositiveYaw ? yaw : -yaw;
    final pitch = f.pitch ?? 0;
    return switch (angle) {
      'front' => ownLeft.abs() < 8 && pitch.abs() < 8 && (f.leftEyeOpen ?? 0) > kEyesOpen && (f.rightEyeOpen ?? 0) > kEyesOpen,
      'left' => ownLeft >= 20 && ownLeft <= 45,
      'right' => ownLeft <= -20 && ownLeft >= -45,
      'up' => pitch >= 10 && ownLeft.abs() < 15,
      'down' => pitch <= -10 && ownLeft.abs() < 15,
      _ => false,
    };
  }

  /// Returns the angle to photograph with this frame, or null.
  String? feed(FaceFrame f, int nowMs) {
    final angle = current;
    if (angle == null || failure != null) return null;
    _startMs ??= nowMs;
    _angleStartMs ??= nowMs;
    if (nowMs - _startMs! > timeoutMs) {
      failure = 'Took too long. Try again.';
      return null;
    }
    if (optional(angle) && nowMs - _angleStartMs! > optionalMs) {
      skipped.add(angle);
      _angleStartMs = nowMs;
      _held = 0;
      return null;
    }
    if (f.faces != 1) {
      _held = 0;
      return null;
    }
    _held = _matches(angle, f) ? _held + 1 : 0;
    if (_held >= 3) {
      taken.add(angle);
      _held = 0;
      _angleStartMs = nowMs;
      return angle;
    }
    return null;
  }
}
