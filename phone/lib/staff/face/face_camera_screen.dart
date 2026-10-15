import 'dart:async';
import 'dart:io' show Platform;

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../theme.dart';
import 'face_capture.dart';
import 'face_crop.dart';
import 'liveness.dart';

/// Front camera with ML Kit face detection, all on the phone (bundled model, no network).
/// Liveness mode pops a [FaceCapture]; setup mode pops a `List<FacePhoto>`; closing pops null.
class FaceCameraScreen extends StatefulWidget {
  const FaceCameraScreen.liveness({super.key, required List<String> this.steps, this.timeoutMs = 25000}) : angles = null;
  const FaceCameraScreen.enroll({super.key, required List<String> this.angles})
      : steps = null,
        timeoutMs = 60000;

  final List<String>? steps;
  final List<String>? angles;
  final int timeoutMs;

  @override
  State<FaceCameraScreen> createState() => _FaceCameraScreenState();
}

class _FaceCameraScreenState extends State<FaceCameraScreen> {
  CameraController? _camera;
  late final FaceDetector _detector = FaceDetector(
    options: FaceDetectorOptions(
      enableClassification: true,
      enableTracking: true,
      performanceMode: FaceDetectorMode.fast,
      minFaceSize: 0.25,
    ),
  );
  LivenessTracker? _liveness;
  EnrollTracker? _enroll;
  final _photos = <FacePhoto>[];
  bool _busy = false;
  bool _closing = false;
  String? _error;
  String _hint = '';

  @override
  void initState() {
    super.initState();
    if (widget.steps != null) _liveness = LivenessTracker(widget.steps!, timeoutMs: widget.timeoutMs);
    if (widget.angles != null) _enroll = EnrollTracker(widget.angles!, timeoutMs: widget.timeoutMs);
    _start();
  }

  Future<void> _start() async {
    try {
      final cameras = await availableCameras();
      final front = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.front,
        orElse: () => throw CameraException('no_front', 'This phone has no front camera.'),
      );
      final controller = CameraController(
        front,
        ResolutionPreset.medium,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.nv21,
      );
      await controller.initialize();
      await controller.lockCaptureOrientation(DeviceOrientation.portraitUp);
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() => _camera = controller);
      await controller.startImageStream(_onFrame);
    } on CameraException catch (e) {
      if (mounted) {
        setState(() => _error = e.code == 'CameraAccessDenied'
            ? 'Allow camera access for Khatario Staff in Settings to use the face check.'
            : (e.description ?? 'Could not open the camera.'));
      }
    }
  }

  int get _rotation {
    final camera = _camera!;
    // Locked to portrait, so the device adds nothing; the front sensor is usually mounted at 270°.
    return Platform.isAndroid ? camera.description.sensorOrientation % 360 : 0;
  }

  Future<void> _onFrame(CameraImage image) async {
    if (_busy || _closing || image.planes.isEmpty) return;
    _busy = true;
    try {
      final rotation = _rotation;
      final frame = Nv21Frame(
        bytes: image.planes.first.bytes,
        width: image.width,
        height: image.height,
        stride: image.planes.first.bytesPerRow,
        rotation: rotation,
      );
      final input = InputImage.fromBytes(
        bytes: frame.bytes,
        metadata: InputImageMetadata(
          size: Size(image.width.toDouble(), image.height.toDouble()),
          rotation: InputImageRotationValue.fromRawValue(rotation) ?? InputImageRotation.rotation0deg,
          format: InputImageFormat.nv21,
          bytesPerRow: frame.stride,
        ),
      );
      final faces = await _detector.processImage(input);
      final face = faces.length == 1 ? faces.first : null;
      final f = FaceFrame(
        faces: faces.length,
        trackingId: face?.trackingId,
        leftEyeOpen: face?.leftEyeOpenProbability,
        rightEyeOpen: face?.rightEyeOpenProbability,
        smiling: face?.smilingProbability,
        yaw: face?.headEulerAngleY,
        pitch: face?.headEulerAngleX,
        box: face?.boundingBox,
      );
      final now = DateTime.now().millisecondsSinceEpoch;
      final label = _liveness?.feed(f, now) ?? _enroll?.feed(f, now);
      if (label != null && face != null) {
        _photos.add(FacePhoto(label, cropFaceJpeg(frame, face.boundingBox)));
        HapticFeedback.selectionClick();
      }
      if (!mounted) return;
      setState(() => _hint = faces.isEmpty
          ? 'Keep your face inside the circle'
          : faces.length > 1
              ? 'Only you should be in the picture'
              : '');
      await _maybeFinish();
    } catch (_) {
      // A dropped frame is fine; the next one is a few milliseconds away.
    } finally {
      _busy = false;
    }
  }

  Future<void> _maybeFinish() async {
    final liveness = _liveness;
    final enroll = _enroll;
    if (liveness != null && liveness.finished) {
      if (liveness.state == LivenessState.passed) {
        await _close(FaceCapture(liveness: liveness.report(), photos: List.of(_photos)));
      } else {
        await _stopStream();
        setState(() => _error = liveness.failure);
      }
    } else if (enroll != null && enroll.done) {
      if (enroll.failure == null && enroll.taken.length >= 3) {
        await _close(List<FacePhoto>.of(_photos));
      } else {
        await _stopStream();
        setState(() => _error = enroll.failure ?? 'Could not get enough angles. Try again in good light.');
      }
    }
  }

  Future<void> _stopStream() async {
    final camera = _camera;
    if (camera != null && camera.value.isStreamingImages) await camera.stopImageStream();
  }

  Future<void> _close(Object? result) async {
    if (_closing) return;
    _closing = true;
    await _stopStream();
    if (mounted) Navigator.of(context).pop(result);
  }

  void _retry() {
    _photos.clear();
    setState(() {
      _error = null;
      if (widget.steps != null) _liveness = LivenessTracker(widget.steps!, timeoutMs: widget.timeoutMs);
      if (widget.angles != null) _enroll = EnrollTracker(widget.angles!, timeoutMs: widget.timeoutMs);
    });
    _camera?.startImageStream(_onFrame);
  }

  @override
  void dispose() {
    _camera?.dispose();
    _detector.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final camera = _camera;
    final prompt = _liveness?.prompt ?? _enroll?.prompt ?? '';
    final progress = _liveness != null
        ? '${_liveness!.completed.length} of ${_liveness!.steps.length}'
        : '${_enroll!.taken.length} of ${_enroll!.angles.length}';
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Column(
          children: [
            Row(
              children: [
                IconButton(
                  icon: const Icon(LucideIcons.x, color: Colors.white),
                  tooltip: 'Close',
                  onPressed: () => _close(null),
                ),
                Expanded(
                  child: Text(
                    widget.steps != null ? 'Face check' : 'Set up face check',
                    style: AppText.heading.copyWith(color: Colors.white),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(right: AppSpace.lg),
                  child: Text(progress, style: AppText.label.copyWith(color: Colors.white70)),
                ),
              ],
            ),
            Expanded(
              child: Center(
                child: camera == null || !camera.value.isInitialized
                    ? (_error == null ? const CircularProgressIndicator() : const SizedBox.shrink())
                    : ClipOval(
                        child: SizedBox(
                          width: 280,
                          height: 360,
                          child: FittedBox(
                            fit: BoxFit.cover,
                            child: SizedBox(
                              width: camera.value.previewSize?.height ?? 280,
                              height: camera.value.previewSize?.width ?? 360,
                              child: CameraPreview(camera),
                            ),
                          ),
                        ),
                      ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(AppSpace.lg),
              child: Column(
                children: [
                  Text(
                    _error ?? prompt,
                    key: const Key('face-prompt'),
                    textAlign: TextAlign.center,
                    style: AppText.title.copyWith(color: _error == null ? Colors.white : const Color(0xFFFFB4A9)),
                  ),
                  const SizedBox(height: AppSpace.sm),
                  Text(_error == null ? _hint : '', style: AppText.label.copyWith(color: Colors.white70)),
                  if (_error != null && camera != null) ...[
                    const SizedBox(height: AppSpace.md),
                    FilledButton(onPressed: _retry, child: const Text('Try again')),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
