import 'dart:async';

import 'package:flutter/material.dart';

import '../theme.dart';
import 'kit.dart';

/// Short message at the top of the screen, under the status bar. It goes after 3 seconds and a
/// new toast replaces the one on screen. Without an [Overlay] it falls back to a SnackBar.
void showKToast(BuildContext context, String message, {KTone tone = KTone.neutral}) {
  final overlay = Overlay.maybeOf(context, rootOverlay: true);
  if (overlay == null) {
    ScaffoldMessenger.maybeOf(context)
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
    return;
  }
  _current?.dismiss();
  late final _ToastHandle handle;
  final entry = OverlayEntry(builder: (_) => _ToastView(message: message, tone: tone, onDone: () => handle.dismiss()));
  handle = _ToastHandle(entry);
  _current = handle;
  overlay.insert(entry);
}

_ToastHandle? _current;

class _ToastHandle {
  _ToastHandle(this.entry);

  final OverlayEntry entry;
  bool _gone = false;

  void dismiss() {
    if (_gone) return;
    _gone = true;
    if (identical(_current, this)) _current = null;
    if (entry.mounted) entry.remove();
  }
}

class _ToastView extends StatefulWidget {
  const _ToastView({required this.message, required this.tone, required this.onDone});

  final String message;
  final KTone tone;
  final VoidCallback onDone;

  @override
  State<_ToastView> createState() => _ToastViewState();
}

class _ToastViewState extends State<_ToastView> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer(const Duration(seconds: 3), widget.onDone);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final neutral = widget.tone == KTone.neutral;
    final bg = neutral ? AppColors.surface : widget.tone.bg;
    final fg = neutral ? AppColors.ink : widget.tone.fg;
    return Positioned(
      top: MediaQuery.paddingOf(context).top + AppSpace.sm,
      left: AppSpace.gutter,
      right: AppSpace.gutter,
      child: IgnorePointer(
        child: Semantics(
          liveRegion: true,
          container: true,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.lg, vertical: AppSpace.md),
            decoration: BoxDecoration(
              color: bg,
              borderRadius: BorderRadius.circular(AppRadius.md),
              boxShadow: neutral ? AppShadow.raised : AppShadow.card,
            ),
            child: Text(widget.message, style: AppText.bodyStrong.copyWith(color: fg, decoration: TextDecoration.none)),
          ),
        ),
      ),
    );
  }
}
