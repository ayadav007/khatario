import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart' show ApiException;
import '../../theme.dart';
import '../../ui/kit.dart';
import '../pair_screen.dart' show KInfoBanner;
import '../staff_api.dart';
import 'face_capture.dart';

/// Face setup on the employee's phone, after their manager opened it: the consent notice first,
/// then the angles on camera, then the photos go to the manager for approval. Pops true when sent.
class FaceSetupScreen extends StatefulWidget {
  const FaceSetupScreen({
    super.key,
    required this.api,
    required this.capturer,
    required this.enrollmentId,
    required this.angles,
    required this.employer,
  });

  final StaffApi api;
  final FaceCapturer capturer;
  final String enrollmentId;
  final List<String> angles;
  final String employer;

  @override
  State<FaceSetupScreen> createState() => _FaceSetupScreenState();
}

class _FaceSetupScreenState extends State<FaceSetupScreen> {
  bool _agreed = false;
  bool _sending = false;
  String? _error;

  Future<void> _start() async {
    setState(() => _error = null);
    final photos = await widget.capturer.enroll(widget.angles);
    if (photos == null || !mounted) return;
    setState(() => _sending = true);
    try {
      await widget.api.enrollFace(widget.enrollmentId, faceConsentVersion, [for (final p in photos) p.toJson()]);
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach Khatario. Check the internet and try again.');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Set up face check')),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(AppSpace.gutter),
                children: [
                  Text('Before you start', style: AppText.title),
                  const SizedBox(height: AppSpace.md),
                  Text(faceConsentText(widget.employer), key: const Key('face-consent-text'), style: AppText.body),
                  const SizedBox(height: AppSpace.lg),
                  CheckboxListTile(
                    key: const Key('face-consent-check'),
                    contentPadding: EdgeInsets.zero,
                    controlAffinity: ListTileControlAffinity.leading,
                    value: _agreed,
                    onChanged: _sending ? null : (v) => setState(() => _agreed = v ?? false),
                    title: Text('I have read this and agree', style: AppText.bodyStrong),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: AppSpace.sm),
                    KInfoBanner(text: _error!, tone: KTone.negative),
                  ],
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(AppSpace.gutter),
              child: KButton(
                key: const Key('face-consent-agree'),
                label: 'I agree — take photos',
                icon: LucideIcons.scanFace,
                loading: _sending,
                onPressed: _agreed && !_sending ? _start : null,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
