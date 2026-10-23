import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../api.dart';
import '../../format.dart';
import '../../theme.dart';
import '../../ui/kit.dart';

/// A scanned code resolved to an item (and the variant whose barcode it was).
class ScannedItem {
  const ScannedItem({required this.item, this.variant});

  final Map<String, dynamic> item;
  final Map<String, dynamic>? variant;

  String get name {
    final base = item['name']?.toString() ?? 'Item';
    final v = variant?['variant_name']?.toString();
    return v == null || v.isEmpty ? base : '$base ($v)';
  }

  double get price => toNum(variant?['selling_price'] ?? item['selling_price']).toDouble();
}

String _norm(String s) => s.replaceAll(RegExp(r'\s+'), '').toUpperCase();

/// Same order as the website's bill screen (`handleGlobalBarcodeScan`): an exact item barcode,
/// then an exact item code, then a variant barcode. Null when nothing matches exactly or when
/// several items share the code.
ScannedItem? matchScannedItem(List<Map<String, dynamic>> items, String code) {
  final c = _norm(code);
  if (c.isEmpty) return null;
  final byBarcode = items.where((i) => _norm(i['barcode']?.toString() ?? '') == c).toList();
  if (byBarcode.length == 1) return ScannedItem(item: byBarcode.first);
  if (byBarcode.length > 1) return null;
  final byCode = items.where((i) => _norm(i['code']?.toString() ?? '') == c).toList();
  if (byCode.length == 1) return ScannedItem(item: byCode.first);
  for (final i in items) {
    final variants = i['variants'];
    if (variants is! List) continue;
    for (final v in variants.whereType<Map>()) {
      if (_norm(v['barcode']?.toString() ?? '') == c) return ScannedItem(item: i, variant: Map<String, dynamic>.from(v));
    }
  }
  return null;
}

/// Sizes to choose from when the code is the item's own barcode and the item has sizes
/// (Scan & Add saves extra pack sizes under one barcode). Empty when no choice is needed.
List<Map<String, dynamic>> sizesToPick(ScannedItem hit) {
  if (hit.variant != null || hit.item['has_variants'] != true) return const [];
  final variants = hit.item['variants'];
  if (variants is! List) return const [];
  return variants.whereType<Map>().map((v) => Map<String, dynamic>.from(v)).toList();
}

/// Looks a code up through `/api/items/search` (which ranks exact barcode matches first).
Future<ScannedItem?> lookupBarcode(KhatarioApi api, String code) async {
  final body = await api.getJson(Uri(path: '/api/items/search', queryParameters: {'q': code.trim(), 'scan': '1'}).toString());
  final items = (body['items'] as List? ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  return matchScannedItem(items, code);
}

/// Full-screen continuous scanner. Every recognised item goes straight onto the bill through
/// [onItem]; a wedge scanner or typed code works in the field at the bottom.
class BarcodeScanScreen extends StatefulWidget {
  const BarcodeScanScreen({super.key, required this.api, required this.onItem});

  final KhatarioApi api;
  final void Function(ScannedItem item) onItem;

  @override
  State<BarcodeScanScreen> createState() => _BarcodeScanScreenState();
}

class _BarcodeScanScreenState extends State<BarcodeScanScreen> {
  final _controller = MobileScannerController(detectionSpeed: DetectionSpeed.normal);
  final _typed = TextEditingController();
  final _added = <String>[];
  String? _last;
  DateTime _lastAt = DateTime(2000);
  bool _busy = false;
  String? _message;
  bool _error = false;

  @override
  void dispose() {
    _controller.dispose();
    _typed.dispose();
    super.dispose();
  }

  Future<void> _handle(String code) async {
    final c = code.trim();
    if (c.isEmpty || _busy) return;
    // The camera reports the same code many times a second; one add per 1.5 s per code.
    final now = DateTime.now();
    if (c == _last && now.difference(_lastAt) < const Duration(milliseconds: 1500)) return;
    _last = c;
    _lastAt = now;
    setState(() => _busy = true);
    try {
      var hit = await lookupBarcode(widget.api, c);
      if (!mounted) return;
      final sizes = hit == null ? const <Map<String, dynamic>>[] : sizesToPick(hit);
      if (hit != null && sizes.isNotEmpty) {
        await _controller.stop();
        final picked = await _pickSize(hit.name, sizes);
        if (mounted) await _controller.start();
        if (!mounted) return;
        if (picked == null) {
          setState(() {
            _error = false;
            _message = 'Not added. Scan again and pick a size.';
          });
          return;
        }
        hit = ScannedItem(item: hit.item, variant: picked);
      }
      if (hit == null) {
        HapticFeedback.heavyImpact();
        setState(() {
          _error = true;
          _message = 'No item with code $c. Add the barcode to the item first.';
        });
      } else {
        final added = hit;
        HapticFeedback.mediumImpact();
        widget.onItem(added);
        setState(() {
          _error = false;
          _added.add(added.name);
          _message = 'Added ${added.name} · $rupeeSign${enIn(added.price, maxFraction: 2)}';
        });
      }
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = true;
          _message = e.message;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// "Which size is this?" for a barcode several pack sizes share. Null when cancelled.
  Future<Map<String, dynamic>?> _pickSize(String itemName, List<Map<String, dynamic>> sizes) {
    return showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      backgroundColor: AppColors.surface,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpace.gutter),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(itemName, style: AppText.heading.copyWith(fontSize: 17)),
              const SizedBox(height: 4),
              Text('Which size is this?', style: AppText.label),
              const SizedBox(height: AppSpace.md),
              for (final v in sizes)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: KButton.secondary(
                    label: '${v['variant_name'] ?? ''}'
                        '${v['selling_price'] != null ? ' · $rupeeSign${enIn(toNum(v['selling_price']), maxFraction: 2)}' : ''}'
                        ' · Stock ${toNum(v['current_stock'])}',
                    onPressed: () => Navigator.of(ctx).pop(v),
                  ),
                ),
              KTextButton(label: 'Cancel', onTap: () => Navigator.of(ctx).pop()),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(_added.isEmpty ? 'Scan items' : '${_added.length} scanned'),
        actions: [
          IconButton(
            tooltip: 'Torch',
            icon: const Icon(LucideIcons.flashlight),
            onPressed: () => _controller.toggleTorch(),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                MobileScanner(
                  controller: _controller,
                  onDetect: (capture) {
                    final code = capture.barcodes.map((b) => b.rawValue).whereType<String>().firstOrNull;
                    if (code != null) _handle(code);
                  },
                  errorBuilder: (context, error) => Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        error.errorCode == MobileScannerErrorCode.permissionDenied
                            ? 'Allow camera access for Khatario in phone settings, or type the code below.'
                            : 'The camera is not available. Type or scan the code below.',
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
                if (_busy) const Center(child: CircularProgressIndicator(color: Colors.white)),
              ],
            ),
          ),
          Container(
            color: AppColors.surface,
            padding: EdgeInsets.fromLTRB(16, 12, 16, 12 + MediaQuery.of(context).padding.bottom),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_message != null)
                  Container(
                    padding: const EdgeInsets.all(10),
                    margin: const EdgeInsets.only(bottom: 10),
                    decoration: BoxDecoration(
                      color: _error ? AppColors.negativeSoft : AppColors.positiveSoft,
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                    ),
                    child: Text(_message!, style: AppText.body.copyWith(color: _error ? AppColors.negative : AppColors.positive)),
                  ),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _typed,
                        textInputAction: TextInputAction.done,
                        decoration: const InputDecoration(isDense: true, hintText: 'Type or scan a code', prefixIcon: Icon(LucideIcons.scanBarcode, size: 18)),
                        onSubmitted: (v) {
                          _last = null;
                          _handle(v);
                          _typed.clear();
                        },
                      ),
                    ),
                    const SizedBox(width: 10),
                    KButton(label: 'Done', expand: false, onPressed: () => Navigator.of(context).pop()),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
