import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';

/// An image behind the signed-in session: WhatsApp media links are relative (`/api/whatsapp/media/...`)
/// and need the app's cookies, so the bytes come through [KhatarioApi.dio] rather than `Image.network`.
/// A `data:` link is decoded in place.
class AuthedImage extends StatefulWidget {
  const AuthedImage({super.key, required this.api, required this.url, this.width, this.height, this.fit = BoxFit.cover, this.failed});

  final KhatarioApi api;
  final String url;
  final double? width;
  final double? height;
  final BoxFit fit;

  /// Shown when the image cannot be loaded.
  final Widget? failed;

  @override
  State<AuthedImage> createState() => _AuthedImageState();
}

class _AuthedImageState extends State<AuthedImage> {
  Uint8List? _bytes;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final url = widget.url;
      if (url.startsWith('data:')) {
        final comma = url.indexOf(',');
        if (comma < 0) throw StateError('bad data url');
        if (!mounted) return;
        setState(() => _bytes = base64Decode(url.substring(comma + 1)));
        return;
      }
      final response = await widget.api.dio.get<List<int>>(url, options: Options(responseType: ResponseType.bytes));
      final data = response.data;
      if ((response.statusCode ?? 500) >= 400 || data == null || data.isEmpty) throw StateError('image not loaded');
      if (!mounted) return;
      setState(() => _bytes = Uint8List.fromList(data));
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_failed) return widget.failed ?? Text('Image could not be shown', style: AppText.caption);
    if (_bytes == null) {
      return SizedBox(
        width: widget.width ?? 160,
        height: widget.height ?? 80,
        child: const Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))),
      );
    }
    return Image.memory(
      _bytes!,
      width: widget.width,
      height: widget.height,
      fit: widget.fit,
      errorBuilder: (_, _, _) => widget.failed ?? Text('Image could not be shown', style: AppText.caption),
    );
  }
}
