import 'dart:typed_data';

import 'package:camera/camera.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../theme.dart';
import '../../ui/kit.dart';

/// A photo or uploaded file ready for bill reading.
class BillCapture {
  const BillCapture({required this.bytes, required this.name});

  final Uint8List bytes;
  final String name;

  bool get isPdf => name.toLowerCase().endsWith('.pdf');
}

/// Rear camera for a supplier bill. Upload stays available for a PDF or a saved photo.
class BillCameraScreen extends StatefulWidget {
  const BillCameraScreen({super.key, required this.onCapture, required this.onClose, this.allowPdf = true});

  final ValueChanged<BillCapture> onCapture;
  final VoidCallback onClose;

  /// An extra page of a bill is a photo, so its upload leaves PDFs out.
  final bool allowPdf;

  @override
  State<BillCameraScreen> createState() => _BillCameraScreenState();
}

class _BillCameraScreenState extends State<BillCameraScreen> {
  CameraController? _camera;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _open();
  }

  Future<void> _open() async {
    try {
      final cameras = await availableCameras();
      final back = cameras.where((c) => c.lensDirection == CameraLensDirection.back).firstOrNull ?? cameras.firstOrNull;
      if (back == null) {
        if (mounted) setState(() => _error = 'This phone has no camera. Upload the bill instead.');
        return;
      }
      final controller = CameraController(back, ResolutionPreset.high, enableAudio: false);
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() => _camera = controller);
    } on CameraException catch (e) {
      if (!mounted) return;
      final denied = e.code == 'CameraAccessDenied' || e.code == 'CameraAccessDeniedWithoutPrompt' || e.code == 'CameraAccessRestricted';
      setState(() => _error = denied ? 'Allow camera access for Khatario in phone settings, or upload the bill.' : 'Could not open the camera. Upload the bill instead.');
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not open the camera. Upload the bill instead.');
    }
  }

  Future<void> _shoot() async {
    final camera = _camera;
    if (camera == null || _busy || !camera.value.isInitialized) return;
    setState(() => _busy = true);
    try {
      final shot = await camera.takePicture();
      final bytes = await shot.readAsBytes();
      if (mounted) widget.onCapture(BillCapture(bytes: bytes, name: 'bill.jpg'));
    } catch (_) {
      if (mounted) setState(() { _busy = false; _error = 'Could not take the photo.'; });
    }
  }

  Future<void> _upload() async {
    final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: [if (widget.allowPdf) 'pdf', 'jpg', 'jpeg', 'png']);
    if (file == null || !mounted) return;
    final bytes = await file.readAsBytes();
    if (mounted) widget.onCapture(BillCapture(bytes: bytes, name: file.name));
  }

  @override
  void dispose() {
    _camera?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final camera = _camera;
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Column(
          children: [
            Row(
              children: [
                KIconButton(icon: LucideIcons.x, tooltip: 'Close', color: Colors.white, onTap: widget.onClose),
                const Expanded(child: Text('Scan bill', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w600))),
              ],
            ),
            Expanded(
              child: camera == null || !camera.value.isInitialized
                  ? Center(child: _error == null ? const KSpinner() : Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white))))
                  : ClipRect(
                      child: FittedBox(
                        fit: BoxFit.cover,
                        child: SizedBox(
                          width: camera.value.previewSize?.height ?? 1,
                          height: camera.value.previewSize?.width ?? 1,
                          child: CameraPreview(camera),
                        ),
                      ),
                    ),
            ),
            if (_error != null && camera != null)
              Padding(padding: const EdgeInsets.fromLTRB(24, 8, 24, 0), child: Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white))),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 16, 24, 20),
              child: Row(
                children: [
                  KTextButton(label: 'Upload a file', color: Colors.white, onTap: _busy ? () {} : _upload),
                  const Spacer(),
                  GestureDetector(
                    onTap: camera == null ? null : _shoot,
                    child: Container(
                      width: 68,
                      height: 68,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 4),
                        color: _busy ? AppColors.ink3 : Colors.white,
                      ),
                    ),
                  ),
                  const Spacer(),
                  const SizedBox(width: 96),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
