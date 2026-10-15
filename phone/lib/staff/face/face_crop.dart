import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' show Rect;

import 'package:image/image.dart' as img;

/// A raw NV21 camera frame (Android): Y rows of [stride] bytes, then interleaved V/U rows.
class Nv21Frame {
  const Nv21Frame({required this.bytes, required this.width, required this.height, required this.stride, required this.rotation});

  final Uint8List bytes;
  final int width;
  final int height;
  final int stride;

  /// Clockwise degrees (0, 90, 180, 270) that turn the raw frame upright, as given to ML Kit.
  final int rotation;

  int get uprightWidth => rotation % 180 == 0 ? width : height;
  int get uprightHeight => rotation % 180 == 0 ? height : width;

  /// Raw pixel position for an upright one.
  (int, int) rawOf(int x, int y) => switch (rotation) {
        90 => (y, height - 1 - x),
        180 => (width - 1 - x, height - 1 - y),
        270 => (width - 1 - y, x),
        _ => (x, y),
      };

  /// RGB of an upright pixel (BT.601, full range as Android cameras give it).
  (int, int, int) rgbAt(int x, int y) {
    final (rx, ry) = rawOf(x, y);
    final yv = bytes[ry * stride + rx];
    final uvRow = height * stride + (ry >> 1) * stride + (rx & ~1);
    final v = bytes[uvRow] - 128;
    final u = bytes[uvRow + 1] - 128;
    int c(double n) => n < 0 ? 0 : (n > 255 ? 255 : n.round());
    return (c(yv + 1.402 * v), c(yv - 0.344136 * u - 0.714136 * v), c(yv + 1.772 * u));
  }
}

/// The face plus a margin, cut from the frame, turned upright and saved as a small JPEG.
/// The server needs the whole face with some room around it, not the full camera picture.
Uint8List cropFaceJpeg(Nv21Frame frame, Rect box, {double margin = 0.45, int maxSide = 320, int quality = 85}) {
  final side = math.max(box.width, box.height) * (1 + margin * 2);
  final cx = box.center.dx;
  final cy = box.center.dy;
  final left = math.max(0.0, cx - side / 2);
  final top = math.max(0.0, cy - side / 2);
  final right = math.min(frame.uprightWidth.toDouble(), cx + side / 2);
  final bottom = math.min(frame.uprightHeight.toDouble(), cy + side / 2);
  final w = right - left;
  final h = bottom - top;
  final scale = math.min(1.0, maxSide / math.max(w, h));
  final outW = math.max(1, (w * scale).round());
  final outH = math.max(1, (h * scale).round());

  final out = img.Image(width: outW, height: outH);
  for (var oy = 0; oy < outH; oy++) {
    final uy = math.min(frame.uprightHeight - 1, (top + (oy + 0.5) / scale).floor());
    for (var ox = 0; ox < outW; ox++) {
      final ux = math.min(frame.uprightWidth - 1, (left + (ox + 0.5) / scale).floor());
      final (r, g, b) = frame.rgbAt(ux, uy);
      out.setPixelRgb(ox, oy, r, g, b);
    }
  }
  return img.encodeJpg(out, quality: quality);
}
