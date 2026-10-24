import 'package:flutter/material.dart';

/// Wraps a modal bottom sheet so its SnackBars (the website's toasts) show above the sheet
/// instead of behind the modal barrier. Tapping above the sheet closes it.
class SheetMessenger extends StatelessWidget {
  const SheetMessenger({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ScaffoldMessenger(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: Column(
          children: [
            Expanded(
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () => Navigator.of(context).pop(),
              ),
            ),
            child,
          ],
        ),
      ),
    );
  }
}
