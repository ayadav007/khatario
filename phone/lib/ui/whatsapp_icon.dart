import 'package:flutter/material.dart';

/// Green phone mark used wherever the app sends a WhatsApp reminder.
class WhatsAppIcon extends StatelessWidget {
  const WhatsAppIcon({super.key, this.size = 22, this.color = const Color(0xFF25D366)});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: DecoratedBox(
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        child: Icon(Icons.phone, size: size * 0.62, color: Colors.white),
      ),
    );
  }
}
