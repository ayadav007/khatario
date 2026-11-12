import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../theme.dart';
import '../../ui/kit.dart';

/// Camera screen that hands one scanned (or typed) code back to the caller and closes.
/// Same scanner package and look as the Scan & Add screen, without its shop lookup.
class BarcodeCaptureScreen extends StatefulWidget {
  const BarcodeCaptureScreen({super.key});

  /// Opens the scanner; null when closed without a code.
  static Future<String?> open(BuildContext context) =>
      Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const BarcodeCaptureScreen()));

  @override
  State<BarcodeCaptureScreen> createState() => _BarcodeCaptureScreenState();
}

class _BarcodeCaptureScreenState extends State<BarcodeCaptureScreen> {
  final _controller = MobileScannerController(detectionSpeed: DetectionSpeed.normal);
  final _typed = TextEditingController();
  bool _done = false;

  @override
  void dispose() {
    _controller.dispose();
    _typed.dispose();
    super.dispose();
  }

  void _finish(String code) {
    final c = code.replaceAll(RegExp(r'\s+'), '');
    if (c.isEmpty || _done) return;
    _done = true;
    HapticFeedback.mediumImpact();
    Navigator.of(context).pop(c);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Column(
          children: [
            SizedBox(
              height: 64,
              child: Row(
                children: [
                  const SizedBox(width: 4),
                  KIconButton(icon: LucideIcons.x, tooltip: 'Close', onTap: () => Navigator.of(context).pop()),
                  const SizedBox(width: 4),
                  Expanded(child: Text('Scan barcode', style: AppText.heading.copyWith(fontSize: 18, color: Colors.white))),
                  KIconButton(icon: LucideIcons.flashlight, tooltip: 'Torch', onTap: () => _controller.toggleTorch()),
                  const SizedBox(width: 4),
                ],
              ),
            ),
            Expanded(
              child: Stack(
                fit: StackFit.expand,
                children: [
                  MobileScanner(
                    controller: _controller,
                    onDetect: (capture) {
                      final code = capture.barcodes.map((b) => b.rawValue).whereType<String>().firstOrNull;
                      if (code != null) _finish(code);
                    },
                    errorBuilder: (context, error) => Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(
                          error.errorCode == MobileScannerErrorCode.permissionDenied
                              ? 'Allow camera access for Khatario in phone settings, or type the code below.'
                              : 'The camera is not available. Type the code below.',
                          textAlign: TextAlign.center,
                          style: AppText.body.copyWith(color: Colors.white),
                        ),
                      ),
                    ),
                  ),
                  Center(
                    child: Container(
                      width: 260,
                      height: 150,
                      decoration: BoxDecoration(
                        border: Border.all(color: Colors.white.withValues(alpha: 0.85), width: 2),
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Container(
              color: AppColors.surface,
              padding: EdgeInsets.fromLTRB(16, 12, 16, 12 + MediaQuery.of(context).padding.bottom),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _typed,
                      textInputAction: TextInputAction.done,
                      style: AppText.body,
                      decoration: const InputDecoration(isDense: true, hintText: 'Or type the barcode', prefixIcon: Icon(LucideIcons.scanBarcode, size: 18)),
                      onSubmitted: _finish,
                    ),
                  ),
                  const SizedBox(width: 10),
                  KButton(label: 'Use code', expand: false, onPressed: () => _finish(_typed.text)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
