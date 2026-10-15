import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../api.dart';
import '../theme.dart';
import '../ui/kit.dart';
import 'staff_api.dart';

/// First run: link this phone to the employee with the owner's one-time code.
class StaffPairScreen extends StatefulWidget {
  const StaffPairScreen({super.key, required this.api, required this.onLinked, this.notice});

  final StaffApi api;
  final void Function(StaffLink link) onLinked;

  /// Shown above the form, e.g. after the owner unlinked this phone.
  final String? notice;

  @override
  State<StaffPairScreen> createState() => _StaffPairScreenState();
}

class _StaffPairScreenState extends State<StaffPairScreen> {
  final _code = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _link(String raw) async {
    final code = normalizePairingCode(raw);
    if (code.length != 10) {
      setState(() => _error = 'The code has 10 letters and numbers.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final link = await widget.api.pair(code);
      if (mounted) widget.onLinked(link);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } on PlatformException catch (e) {
      if (mounted) setState(() => _error = 'This phone could not create its security key (${e.message}).');
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach Khatario. Check the internet and try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _scan() async {
    final value = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const _PairingQrScanner()),
    );
    if (value != null) {
      _code.text = normalizePairingCode(value);
      await _link(value);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(AppSpace.gutter),
          children: [
            const SizedBox(height: AppSpace.xl),
            Icon(LucideIcons.smartphone, size: 40, color: AppColors.brand),
            const SizedBox(height: AppSpace.md),
            Text('Khatario Staff', style: AppText.title),
            const SizedBox(height: AppSpace.xs),
            Text(
              'Ask your employer to open your profile in Khatario and tap "Link staff phone". '
              'Then scan the QR code or type the code.',
              style: AppText.body.copyWith(color: AppColors.ink2),
            ),
            if (widget.notice != null) ...[
              const SizedBox(height: AppSpace.lg),
              KInfoBanner(text: widget.notice!, tone: KTone.due),
            ],
            const SizedBox(height: AppSpace.xl),
            KButton(label: 'Scan QR code', icon: LucideIcons.scanQrCode, onPressed: _busy ? null : _scan),
            const SizedBox(height: AppSpace.lg),
            Text('Or type the code', style: AppText.label),
            const SizedBox(height: AppSpace.sm),
            TextField(
              key: const Key('pair-code'),
              controller: _code,
              textCapitalization: TextCapitalization.characters,
              autocorrect: false,
              decoration: const InputDecoration(hintText: 'ABCDE-FGHJK'),
              onSubmitted: _link,
            ),
            const SizedBox(height: AppSpace.md),
            KButton.secondary(label: 'Link this phone', loading: _busy, onPressed: () => _link(_code.text)),
            if (_error != null) ...[
              const SizedBox(height: AppSpace.md),
              KInfoBanner(text: _error!, tone: KTone.negative),
            ],
            const SizedBox(height: AppSpace.xl),
            Text(
              'Khatario Staff reads your location and nearby Wi-Fi only when you tap Check in or Check out, '
              'and sends them to your employer with the check-in.',
              style: AppText.caption,
            ),
          ],
        ),
      ),
    );
  }
}

/// Small coloured message box.
class KInfoBanner extends StatelessWidget {
  const KInfoBanner({super.key, required this.text, required this.tone});

  final String text;
  final KTone tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpace.md),
      decoration: BoxDecoration(color: tone.bg, borderRadius: BorderRadius.circular(AppRadius.sm)),
      child: Text(text, style: AppText.body.copyWith(color: tone.fg)),
    );
  }
}

class _PairingQrScanner extends StatefulWidget {
  const _PairingQrScanner();

  @override
  State<_PairingQrScanner> createState() => _PairingQrScannerState();
}

class _PairingQrScannerState extends State<_PairingQrScanner> {
  final _controller = MobileScannerController(formats: const [BarcodeFormat.qrCode]);
  bool _done = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, title: const Text('Scan the code')),
      body: Stack(
        fit: StackFit.expand,
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: (capture) {
              final value = capture.barcodes.map((b) => b.rawValue).whereType<String>().firstOrNull;
              // Ignore QR codes that are not a Khatario Staff link.
              if (_done || value == null || !value.toUpperCase().startsWith(pairingQrPrefix)) return;
              _done = true;
              HapticFeedback.mediumImpact();
              Navigator.of(context).pop(value);
            },
            errorBuilder: (context, error) => Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  error.errorCode == MobileScannerErrorCode.permissionDenied
                      ? 'Allow camera access in phone settings, or go back and type the code.'
                      : 'The camera is not available. Go back and type the code.',
                  textAlign: TextAlign.center,
                  style: AppText.body.copyWith(color: Colors.white),
                ),
              ),
            ),
          ),
          Center(
            child: Container(
              width: 240,
              height: 240,
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white.withValues(alpha: 0.85), width: 2),
                borderRadius: BorderRadius.circular(14),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
