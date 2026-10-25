import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image/image.dart' as img;
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../theme.dart';
import '../../ui/kit.dart';
import 'bill_camera.dart';

/// Reads the bill and fills the form. Returns the number of items read, or null when it
/// failed (the form shows why).
typedef BillReader = Future<int?> Function(BillCapture capture);

/// The website's scan (`components/purchases/ScanRecordBillsScreen.tsx` and `scan-flow/`):
/// camera, crop, page preview, the reading timer, then the finish animation.
class BillScanFlow extends StatefulWidget {
  const BillScanFlow({super.key, required this.read});

  final BillReader read;

  @override
  State<BillScanFlow> createState() => _BillScanFlowState();
}

enum _Phase { camera, cropping, preview, reading, success }

class _BillScanFlowState extends State<BillScanFlow> {
  _Phase _phase = _Phase.camera;
  final _pages = <Uint8List>[];
  BillPhoto? _photo;
  String? _photoError;
  DateTime _startedAt = DateTime.now();
  Duration _elapsed = Duration.zero;
  int _items = 0;
  bool _done = false;

  /// The camera was opened from the preview to add a page.
  bool get _addingPage => _pages.isNotEmpty;

  Future<void> _captured(BillCapture capture) async {
    if (capture.isPdf) {
      // The preview shows pages as images, so a PDF goes straight to reading.
      unawaited(_readBill(capture));
      return;
    }
    setState(() { _phase = _Phase.cropping; _photo = null; _photoError = null; });
    try {
      final photo = await compute(normalizeBillPhoto, capture.bytes);
      if (mounted && _phase == _Phase.cropping) setState(() => _photo = photo);
    } catch (_) {
      if (mounted && _phase == _Phase.cropping) setState(() => _photoError = 'Could not open this photo. Retake it or upload another.');
    }
  }

  void _cropped(Uint8List page) => setState(() { _pages.add(page); _phase = _Phase.preview; });

  void _close() {
    if (!_done) {
      _done = true;
      Navigator.of(context).pop();
    }
  }

  void _back() {
    switch (_phase) {
      case _Phase.camera:
        _addingPage ? setState(() => _phase = _Phase.preview) : _close();
      case _Phase.cropping:
        setState(() => _phase = _Phase.camera);
      case _Phase.preview:
        _close();
      case _Phase.reading:
        break;
      case _Phase.success:
        _close();
    }
  }

  Future<void> _readBill(BillCapture capture) async {
    setState(() { _phase = _Phase.reading; _startedAt = DateTime.now(); });
    final items = await widget.read(capture);
    if (!mounted) return;
    if (items == null) {
      _close();
      return;
    }
    setState(() { _phase = _Phase.success; _elapsed = DateTime.now().difference(_startedAt); _items = items; });
  }

  @override
  Widget build(BuildContext context) {
    final child = switch (_phase) {
      _Phase.camera => BillCameraScreen(key: ValueKey('camera${_pages.length}'), onCapture: _captured, onClose: _back, allowPdf: !_addingPage),
      _Phase.cropping => BillCropScreen(photo: _photo, error: _photoError, onCrop: _cropped, onRetake: () => setState(() => _phase = _Phase.camera)),
      _Phase.preview => BillPreviewScreen(
          pages: _pages,
          onAddPage: () => setState(() => _phase = _Phase.camera),
          onRemovePage: (i) => setState(() {
            _pages.removeAt(i);
            if (_pages.isEmpty) _phase = _Phase.camera;
          }),
          // As on the website, only the first page is read for now.
          onProceed: () => _readBill(BillCapture(bytes: _pages.first, name: 'bill.jpg')),
          onBack: _close,
        ),
      _Phase.reading => BillReadingScreen(startedAt: _startedAt),
      _Phase.success => BillReadSuccessScreen(elapsed: _elapsed, itemCount: _items, onDismiss: _close),
    };
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: AnimatedSwitcher(duration: const Duration(milliseconds: 200), child: KeyedSubtree(key: ValueKey(_phase), child: child)),
    );
  }
}

/// A bill photo turned upright and kept small enough to show and crop quickly.
class BillPhoto {
  const BillPhoto({required this.bytes, required this.width, required this.height});

  final Uint8List bytes;
  final int width;
  final int height;
}

/// Turns the photo upright and caps it at 4000px, so a narrow till roll cropped out of it
/// still has its full width of pixels. Runs in an isolate.
BillPhoto normalizeBillPhoto(Uint8List bytes) {
  final decoded = img.decodeImage(bytes);
  if (decoded == null) throw const FormatException('Not an image');
  var photo = img.bakeOrientation(decoded);
  const cap = 4000;
  if (math.max(photo.width, photo.height) > cap) {
    photo = photo.width >= photo.height ? img.copyResize(photo, width: cap) : img.copyResize(photo, height: cap);
  }
  return BillPhoto(bytes: img.encodeJpg(photo, quality: 90), width: photo.width, height: photo.height);
}

/// `computeInvoiceVisionTargetSize` in `lib/invoice-extract/latency/compute-vision-image-size.ts`:
/// 1600px long side, except a long narrow bill keeps an 800px short side, up to 3200px long.
({int width, int height}) billVisionSize(int width, int height) {
  const maxLong = 1600, minShort = 800, tallMaxLong = 3200;
  final long = math.max(width, height);
  final short = math.min(width, height);
  final scale = math.min(1.0, math.max(maxLong / long, math.min(minShort / short, tallMaxLong / long)));
  if (scale >= 1) return (width: width, height: height);
  return (width: math.max(1, (width * scale).round()), height: math.max(1, (height * scale).round()));
}

/// The box around the four corners, cut and sized the way the website sends a bill to be
/// read (`prepareInvoiceVisionImageClient`, JPEG 80). Runs in an isolate.
Uint8List cropBillPhoto((Uint8List, Rect) job) {
  final (bytes, box) = job;
  final photo = img.decodeImage(bytes)!;
  final x0 = (box.left * photo.width).floor().clamp(0, photo.width - 1);
  final y0 = (box.top * photo.height).floor().clamp(0, photo.height - 1);
  final x1 = (box.right * photo.width).ceil().clamp(x0 + 1, photo.width);
  final y1 = (box.bottom * photo.height).ceil().clamp(y0 + 1, photo.height);
  var page = img.copyCrop(photo, x: x0, y: y0, width: x1 - x0, height: y1 - y0);
  final size = billVisionSize(page.width, page.height);
  if (size.width != page.width || size.height != page.height) {
    page = img.copyResize(page, width: size.width, height: size.height, interpolation: img.Interpolation.average);
  }
  return img.encodeJpg(page, quality: 80);
}

/// `DocumentCropScreen`: drag the four corners round the bill, then use the photo.
class BillCropScreen extends StatefulWidget {
  const BillCropScreen({super.key, required this.photo, required this.error, required this.onCrop, required this.onRetake});

  /// Null while the photo is still being opened.
  final BillPhoto? photo;
  final String? error;
  final ValueChanged<Uint8List> onCrop;
  final VoidCallback onRetake;

  @override
  State<BillCropScreen> createState() => _BillCropScreenState();
}

class _BillCropScreenState extends State<BillCropScreen> {
  static const _handle = 44.0;
  var _corners = const [Offset(0.05, 0.05), Offset(0.95, 0.05), Offset(0.95, 0.95), Offset(0.05, 0.95)];
  bool _applying = false;

  Future<void> _crop() async {
    final photo = widget.photo;
    if (photo == null || _applying) return;
    setState(() => _applying = true);
    final xs = _corners.map((c) => c.dx);
    final ys = _corners.map((c) => c.dy);
    final box = Rect.fromLTRB(xs.reduce(math.min), ys.reduce(math.min), xs.reduce(math.max), ys.reduce(math.max));
    try {
      final page = await compute(cropBillPhoto, (photo.bytes, box));
      if (mounted) widget.onCrop(page);
    } catch (_) {
      if (mounted) setState(() => _applying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final photo = widget.photo;
    return Scaffold(
      backgroundColor: Colors.black,
      body: Column(
        children: [
          Expanded(
            child: SafeArea(
              bottom: false,
              child: photo == null
                  ? Center(
                      child: widget.error == null
                          ? const KSpinner()
                          : Padding(padding: const EdgeInsets.all(24), child: Text(widget.error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white))),
                    )
                  : LayoutBuilder(builder: (context, box) {
                      // The photo fitted inside the area, with room for the corner handles.
                      const pad = _handle / 2;
                      final room = Size(box.maxWidth - pad * 2, box.maxHeight - pad * 2);
                      final scale = math.min(room.width / photo.width, room.height / photo.height);
                      final size = Size(photo.width * scale, photo.height * scale);
                      void drag(int i, Offset delta) => setState(() {
                            final c = _corners[i] + Offset(delta.dx / size.width, delta.dy / size.height);
                            _corners = [..._corners]..[i] = Offset(c.dx.clamp(0, 1), c.dy.clamp(0, 1));
                          });
                      return Center(
                        child: SizedBox(
                          width: size.width + _handle,
                          height: size.height + _handle,
                          child: Stack(
                            children: [
                              Positioned(
                                left: pad,
                                top: pad,
                                width: size.width,
                                height: size.height,
                                child: CustomPaint(
                                  foregroundPainter: _CropPainter(_corners),
                                  child: Image.memory(photo.bytes, fit: BoxFit.fill, gaplessPlayback: true),
                                ),
                              ),
                              for (final (i, c) in _corners.indexed)
                                Positioned(
                                  left: c.dx * size.width,
                                  top: c.dy * size.height,
                                  width: _handle,
                                  height: _handle,
                                  child: GestureDetector(
                                    behavior: HitTestBehavior.opaque,
                                    onPanUpdate: (d) => drag(i, d.delta),
                                    child: Center(
                                      child: Container(
                                        width: 20,
                                        height: 20,
                                        decoration: BoxDecoration(
                                          color: Colors.white,
                                          shape: BoxShape.circle,
                                          border: Border.all(color: Colors.white.withValues(alpha: 0.4), width: 2),
                                          boxShadow: const [BoxShadow(color: Colors.black45, blurRadius: 8)],
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      );
                    }),
            ),
          ),
          Container(
            color: Colors.black.withValues(alpha: 0.9),
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 16, 24, 16),
                child: Row(
                  children: [
                    OutlinedButton.icon(
                      onPressed: widget.onRetake,
                      icon: const Icon(LucideIcons.rotateCcw, size: 16),
                      label: const Text('Retake'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.white,
                        side: BorderSide(color: Colors.white.withValues(alpha: 0.2)),
                        minimumSize: const Size(0, 48),
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: photo == null || _applying ? null : _crop,
                        icon: _applying
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Tw.gray900))
                            : const Icon(LucideIcons.check, size: 16),
                        label: const Text('Use Photo', style: TextStyle(fontWeight: FontWeight.w600)),
                        style: FilledButton.styleFrom(
                          backgroundColor: Colors.white,
                          foregroundColor: Tw.gray900,
                          disabledBackgroundColor: Colors.white.withValues(alpha: 0.5),
                          disabledForegroundColor: Tw.gray900,
                          minimumSize: const Size(0, 48),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Darkens outside the four corners, outlines them and dots each edge's middle.
class _CropPainter extends CustomPainter {
  const _CropPainter(this.corners);

  final List<Offset> corners;

  @override
  void paint(Canvas canvas, Size size) {
    final points = [for (final c in corners) Offset(c.dx * size.width, c.dy * size.height)];
    final shape = Path()..addPolygon(points, true);
    final outside = Path.combine(PathOperation.difference, Path()..addRect(Offset.zero & size), shape);
    canvas.drawPath(outside, Paint()..color = Colors.black.withValues(alpha: 0.55));
    canvas.drawPath(shape, Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5);
    final dot = Paint()..color = Colors.white.withValues(alpha: 0.7);
    for (var i = 0; i < 4; i++) {
      canvas.drawCircle(Offset.lerp(points[i], points[(i + 1) % 4], 0.5)!, 3, dot);
    }
  }

  @override
  bool shouldRepaint(_CropPainter old) => old.corners != corners;
}

/// `ScanPreviewScreen`: the first page large, every page as a thumbnail, then Proceed.
class BillPreviewScreen extends StatelessWidget {
  const BillPreviewScreen({super.key, required this.pages, required this.onAddPage, required this.onRemovePage, required this.onProceed, required this.onBack});

  final List<Uint8List> pages;
  final VoidCallback onAddPage;
  final ValueChanged<int> onRemovePage;
  final VoidCallback onProceed;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      body: SafeArea(
        child: Column(
          children: [
            Container(
              height: 56,
              decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.hairline))),
              child: Row(children: [
                const SizedBox(width: 4),
                KIconButton(icon: LucideIcons.arrowLeft, tooltip: 'Back', onTap: onBack),
                const SizedBox(width: 4),
                Expanded(child: Text('Purchase Bill Preview', style: AppText.heading)),
              ]),
            ),
            Expanded(
              child: Container(
                width: double.infinity,
                color: Tw.slate100,
                child: Image.memory(pages.first, fit: BoxFit.contain, gaplessPlayback: true),
              ),
            ),
            Container(
              decoration: const BoxDecoration(border: Border(top: BorderSide(color: AppColors.hairline))),
              padding: const EdgeInsets.all(AppSpace.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    clipBehavior: Clip.none,
                    padding: const EdgeInsets.only(top: 8, right: 8),
                    child: Row(
                      children: [
                        for (final (i, page) in pages.indexed) ...[
                          _PageThumb(page: page, onRemove: () => onRemovePage(i)),
                          const SizedBox(width: AppSpace.md),
                        ],
                        if (pages.length < 5)
                          GestureDetector(
                            onTap: onAddPage,
                            child: CustomPaint(
                              painter: const _DashedBorder(),
                              child: SizedBox(
                                width: 64,
                                height: 80,
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    const Icon(LucideIcons.plus, size: 20, color: AppColors.ink3),
                                    const SizedBox(height: 4),
                                    Text('Add', style: AppText.caption.copyWith(fontSize: 11)),
                                  ],
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpace.lg),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(color: Tw.amber50, borderRadius: BorderRadius.circular(12)),
                    child: Text.rich(
                      const TextSpan(children: [
                        TextSpan(text: 'ⓘ ', style: TextStyle(fontWeight: FontWeight.w700)),
                        TextSpan(text: 'Please ensure all pages belong to the '),
                        TextSpan(text: 'same invoice', style: TextStyle(fontWeight: FontWeight.w700)),
                        TextSpan(text: '. Multi-invoice uploads are not supported yet.'),
                      ]),
                      style: AppText.caption.copyWith(fontSize: 12, color: Tw.amber800),
                    ),
                  ),
                  const SizedBox(height: AppSpace.md),
                  KButton(label: 'Proceed (${pages.length} ${pages.length == 1 ? 'page' : 'pages'})', onPressed: onProceed),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PageThumb extends StatelessWidget {
  const _PageThumb({required this.page, required this.onRemove});

  final Uint8List page;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        Container(
          width: 64,
          height: 80,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: AppColors.hairline),
            boxShadow: AppShadow.card,
          ),
          clipBehavior: Clip.antiAlias,
          child: Image.memory(page, fit: BoxFit.cover, cacheWidth: 192, gaplessPlayback: true),
        ),
        Positioned(
          right: -8,
          top: -8,
          child: Semantics(
            button: true,
            label: 'Remove page',
            child: GestureDetector(
              onTap: onRemove,
              child: Container(
                width: 22,
                height: 22,
                decoration: const BoxDecoration(color: Tw.gray700, shape: BoxShape.circle, boxShadow: [BoxShadow(color: Colors.black26, blurRadius: 3)]),
                child: const Icon(LucideIcons.x, size: 12, color: Colors.white),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _DashedBorder extends CustomPainter {
  const _DashedBorder();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppColors.ink3.withValues(alpha: 0.6)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    final outline = Path()..addRRect(RRect.fromRectAndRadius(Offset.zero & size, const Radius.circular(8)));
    for (final metric in outline.computeMetrics()) {
      for (var d = 0.0; d < metric.length; d += 9) {
        canvas.drawPath(metric.extractPath(d, d + 5), paint);
      }
    }
  }

  @override
  bool shouldRepaint(_DashedBorder old) => false;
}

/// `ScanLoadingScreen`: a ticking timer and rotating tips while the bill is read.
class BillReadingScreen extends StatefulWidget {
  const BillReadingScreen({super.key, required this.startedAt});

  final DateTime startedAt;

  @override
  State<BillReadingScreen> createState() => _BillReadingScreenState();
}

class _BillReadingScreenState extends State<BillReadingScreen> with SingleTickerProviderStateMixin {
  static const _tips = [
    'will be created and added to your books.',
    'Discounts, GST rates and HSN codes are extracted automatically.',
    'IGST vs CGST+SGST is detected from the invoice — no manual entry needed.',
    'Always verify the extracted details before saving.',
    'Got a multi-page invoice? Add all pages before proceeding.',
  ];

  late final AnimationController _spin = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200))..repeat();
  late final Timer _clock;
  late final Timer _tipTimer;
  Duration _elapsed = Duration.zero;
  int _tip = 0;

  @override
  void initState() {
    super.initState();
    _clock = Timer.periodic(const Duration(milliseconds: 100), (_) => setState(() => _elapsed = DateTime.now().difference(widget.startedAt)));
    _tipTimer = Timer.periodic(const Duration(seconds: 3), (_) => setState(() => _tip = (_tip + 1) % _tips.length));
  }

  @override
  void dispose() {
    _clock.cancel();
    _tipTimer.cancel();
    _spin.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tipStyle = AppText.label.copyWith(fontSize: 14, height: 1.35, fontWeight: FontWeight.w400);
    return Scaffold(
      backgroundColor: AppColors.surface,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 96,
                  height: 96,
                  decoration: BoxDecoration(color: Tw.slate100, borderRadius: BorderRadius.circular(16)),
                  child: AnimatedBuilder(
                    animation: _spin,
                    builder: (context, _) => Center(child: CustomPaint(size: const Size(48, 48), painter: _ReadingIcon(_spin.value))),
                  ),
                ),
                const SizedBox(height: 32),
                Text('Reading invoice…', style: AppText.heading.copyWith(fontSize: 20)),
                const SizedBox(height: 4),
                Text(
                  '${(_elapsed.inMilliseconds / 1000).toStringAsFixed(1)}s',
                  style: AppText.amount.copyWith(color: KhatarioColors.primary600),
                ),
                const SizedBox(height: 24),
                Container(
                  width: double.infinity,
                  constraints: const BoxConstraints(maxWidth: 320),
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(color: Tw.slate50, borderRadius: BorderRadius.circular(12)),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        const Icon(LucideIcons.sparkles, size: 14, color: Tw.amber600),
                        const SizedBox(width: 6),
                        Text('Quick Tip', style: AppText.small.copyWith(color: Tw.amber600)),
                      ]),
                      const SizedBox(height: 4),
                      AnimatedSwitcher(
                        duration: const Duration(milliseconds: 300),
                        transitionBuilder: (child, anim) => FadeTransition(
                          opacity: anim,
                          child: SlideTransition(position: Tween(begin: const Offset(0, 0.3), end: Offset.zero).animate(anim), child: child),
                        ),
                        layoutBuilder: (current, previous) => current ?? const SizedBox.shrink(),
                        child: Text.rich(
                          key: ValueKey(_tip),
                          TextSpan(children: [
                            if (_tip == 0) ...[
                              const TextSpan(text: 'Any Party / Item tagged '),
                              WidgetSpan(
                                alignment: PlaceholderAlignment.middle,
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                                  decoration: BoxDecoration(color: Tw.green100, borderRadius: BorderRadius.circular(4)),
                                  child: Text('New', style: AppText.small.copyWith(color: Tw.green800, fontWeight: FontWeight.w700)),
                                ),
                              ),
                              const TextSpan(text: ' '),
                            ],
                            TextSpan(text: _tips[_tip]),
                          ]),
                          style: tipStyle,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          for (var i = 0; i < _tips.length; i++)
                            AnimatedContainer(
                              duration: const Duration(milliseconds: 200),
                              margin: const EdgeInsets.symmetric(horizontal: 2),
                              width: 6,
                              height: 6,
                              decoration: BoxDecoration(shape: BoxShape.circle, color: i == _tip ? KhatarioColors.primary500 : Tw.slate300),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
                Text('Powered by Mira AI', style: AppText.caption.copyWith(fontSize: 12)),
                const SizedBox(height: 32),
                Text.rich(
                  const TextSpan(children: [
                    TextSpan(text: 'Please check the details wisely before proceeding, as '),
                    TextSpan(text: 'AI can make mistakes.', style: TextStyle(color: Tw.amber600, fontWeight: FontWeight.w500)),
                  ]),
                  textAlign: TextAlign.center,
                  style: AppText.caption.copyWith(fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The bill with a lens whose ring spins, pulsing like the website's icon.
class _ReadingIcon extends CustomPainter {
  const _ReadingIcon(this.t);

  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 48);
    // Tailwind's animate-pulse: full, then half opacity, every 2s.
    final pulse = 0.75 + 0.25 * math.cos(2 * math.pi * ((t * 1.2) % 2) / 2);
    final ink = AppColors.ink3.withValues(alpha: pulse);
    final stroke = Paint()
      ..color = ink
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5;
    final fill = Paint()..color = ink;
    canvas.drawRRect(RRect.fromLTRBR(6, 4, 42, 44, const Radius.circular(4)), stroke);
    for (final (y, w) in [(14.0, 22.0), (21.0, 16.0), (28.0, 19.0)]) {
      canvas.drawRRect(RRect.fromLTRBR(13, y, 13 + w, y + 2.5, const Radius.circular(1.25)), fill);
    }
    const lens = Offset(34, 34);
    canvas.drawCircle(lens, 9, Paint()..color = AppColors.surface);
    canvas.drawCircle(lens, 9, Paint()..color = ink.withValues(alpha: 0.08 * pulse));
    canvas.drawCircle(lens, 9, stroke..strokeWidth = 2..color = ink.withValues(alpha: 0.35 * pulse));
    canvas.drawArc(Rect.fromCircle(center: lens, radius: 9), 2 * math.pi * t, 2 * math.pi * 0.75, false, stroke..color = ink);
  }

  @override
  bool shouldRepaint(_ReadingIcon old) => old.t != t;
}

/// `ScanSuccessScreen`: confetti, a check that pops in, the time taken and the minutes saved.
class BillReadSuccessScreen extends StatefulWidget {
  const BillReadSuccessScreen({super.key, required this.elapsed, required this.itemCount, required this.onDismiss});

  final Duration elapsed;
  final int itemCount;
  final VoidCallback onDismiss;

  @override
  State<BillReadSuccessScreen> createState() => _BillReadSuccessScreenState();
}

class _BillReadSuccessScreenState extends State<BillReadSuccessScreen> with SingleTickerProviderStateMixin {
  /// Long enough for the slowest confetti piece (0.6s delay + 2.2s fall).
  late final AnimationController _motion = AnimationController(vsync: this, duration: const Duration(milliseconds: 2800))..forward();
  late final Timer _autoDismiss;

  @override
  void initState() {
    super.initState();
    _autoDismiss = Timer(const Duration(milliseconds: 2800), widget.onDismiss);
  }

  @override
  void dispose() {
    _autoDismiss.cancel();
    _motion.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.of(context).disableAnimations;
    final seconds = (widget.elapsed.inMilliseconds / 1000).toStringAsFixed(1);
    final minutesSaved = math.max(2, (widget.itemCount * 1.2).round());
    return Scaffold(
      backgroundColor: AppColors.surface,
      body: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: widget.onDismiss,
        child: AnimatedBuilder(
          animation: _motion,
          builder: (context, _) {
            final ms = _motion.value * 2800;
            // scan-success-pop: 0.45s, overshooting to 1.12.
            final pop = reduceMotion ? 1.0 : const Cubic(0.34, 1.56, 0.64, 1).transform((ms / 450).clamp(0, 1));
            // scan-fade-up: 0.3s after a 0.15s wait.
            final fade = reduceMotion ? 1.0 : Curves.easeOut.transform(((ms - 150) / 300).clamp(0, 1));
            return Stack(
              fit: StackFit.expand,
              children: [
                if (!reduceMotion) CustomPaint(painter: _Confetti(ms / 1000)),
                Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Opacity(
                      opacity: (ms / 450 / 0.7).clamp(0, 1),
                      child: Transform.scale(
                        scale: 0.4 + 0.6 * pop,
                        child: Container(
                          width: 80,
                          height: 80,
                          decoration: const BoxDecoration(
                            color: Tw.green500,
                            shape: BoxShape.circle,
                            boxShadow: [BoxShadow(color: Color(0x33000000), blurRadius: 15, offset: Offset(0, 10))],
                          ),
                          child: const Icon(LucideIcons.check, size: 40, color: Colors.white, weight: 700),
                        ),
                      ),
                    ),
                    const SizedBox(height: 24),
                    Opacity(
                      opacity: fade,
                      child: Transform.translate(
                        offset: Offset(0, 14 * (1 - fade)),
                        child: Column(children: [
                          Text('Scanned in ${seconds}s!', style: AppText.amount),
                          const SizedBox(height: 4),
                          Text('✨ We saved you ~$minutesSaved mins of typing', style: AppText.label.copyWith(color: Tw.amber600)),
                        ]),
                      ),
                    ),
                  ],
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// The website's 48 confetti pieces, spread by index so every run looks the same.
class _Confetti extends CustomPainter {
  _Confetti(this.seconds);

  final double seconds;

  static const _colors = [
    Color(0xFF9B59B6), Color(0xFFE74C3C), Color(0xFFF39C12), Color(0xFF2ECC71),
    Color(0xFF3498DB), Color(0xFFE67E22), Color(0xFF1ABC9C), Color(0xFFE91E63),
    Color(0xFFFF5722), Color(0xFF4CAF50), Color(0xFF2196F3), Color(0xFFFF9800),
  ];

  @override
  void paint(Canvas canvas, Size size) {
    const count = 48;
    for (var i = 0; i < count; i++) {
      final t = i / count;
      final jitter = ((i * 7919) % 100) / 100;
      final delay = jitter * 0.6;
      final duration = 1.4 + jitter * 0.8;
      final p = ((seconds - delay) / duration).clamp(0.0, 1.0);
      if (seconds < delay || p >= 1) continue;
      final left = ((t * 100 + jitter * 8 - 4 + 2) % 100) / 100 * size.width;
      final w = 6.0 + (i % 3) * 3;
      final h = 8.0 + (i % 4) * 3;
      // confetti-fall: from 16px above the top to a screen lower, turning 600°, fading after 80%.
      final y = -20 - 16 + p * (size.height + 16);
      final opacity = p < 0.8 ? 1.0 : (1 - p) / 0.2;
      canvas.save();
      canvas.translate(left + w / 2, y + h / 2);
      canvas.rotate(((i * 37) % 360 + 600 * p) * math.pi / 180);
      final paint = Paint()..color = _colors[i % _colors.length].withValues(alpha: opacity);
      final rect = Rect.fromCenter(center: Offset.zero, width: w, height: h);
      if (i % 3 == 0) {
        canvas.drawOval(rect, paint);
      } else {
        canvas.drawRRect(RRect.fromRectAndRadius(rect, const Radius.circular(2)), paint);
      }
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(_Confetti old) => old.seconds != seconds;
}
