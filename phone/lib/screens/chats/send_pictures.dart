import 'dart:convert';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import 'campaigns_logic.dart';
import 'chat_thread_logic.dart' show mimeForFileName;

/// A picture chosen on the phone, before it is uploaded.
class PickedPicture {
  const PickedPicture(this.name, this.bytes);

  final String name;
  final List<int> bytes;
}

Future<PickedPicture?> defaultPickPhonePicture() async {
  final file = await FilePicker.pickFile(type: FileType.image);
  if (file == null) return null;
  return PickedPicture(file.name, await file.readAsBytes());
}

/// How a picture is picked on the phone. Tests replace it; the app uses the system file picker.
Future<PickedPicture?> Function() pickPhonePicture = defaultPickPhonePicture;

Uint8List? _bytesOf(String dataUrl) {
  final comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) return null;
  try {
    return base64Decode(dataUrl.substring(comma + 1));
  } catch (_) {
    return null;
  }
}

Widget _placeholder() => const ColoredBox(color: AppColors.sunken, child: Icon(LucideIcons.image, color: AppColors.ink3));

Widget _thumb(String url, double size) {
  final bytes = _bytesOf(url);
  return ClipRRect(
    borderRadius: BorderRadius.circular(AppRadius.sm),
    child: SizedBox(
      width: size,
      height: size,
      child: bytes == null ? _placeholder() : Image.memory(bytes, fit: BoxFit.cover, cacheWidth: 160, errorBuilder: (_, _, _) => _placeholder()),
    ),
  );
}

/// Pick a picture for a message: from this phone (uploaded to the media library, JPEG/PNG/GIF/WebP up
/// to 5 MB, as on the website) or from the media library already there. [onChanged] gets the
/// picture, or null on Remove.
class PictureField extends StatefulWidget {
  const PictureField({super.key, required this.session, required this.picture, required this.onChanged, this.label = 'Picture'});

  final AppSession session;
  final MediaItem? picture;
  final ValueChanged<MediaItem?> onChanged;
  final String label;

  @override
  State<PictureField> createState() => _PictureFieldState();
}

class _PictureFieldState extends State<PictureField> {
  bool _busy = false;

  Future<void> _choose() async {
    if (_busy) return;
    final how = await showKSheet<String>(
      context,
      title: widget.label,
      builder: (ctx) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        KSheetAction(icon: LucideIcons.smartphone, label: 'From this phone', onTap: () => Navigator.of(ctx).pop('phone')),
        KSheetAction(icon: LucideIcons.images, label: 'From media library', onTap: () => Navigator.of(ctx).pop('library')),
      ]),
    );
    if (!mounted || how == null) return;
    if (how == 'library') {
      final item = await Navigator.of(context).push<MediaItem>(MaterialPageRoute(builder: (_) => MediaLibraryScreen(session: widget.session)));
      if (item != null && mounted) widget.onChanged(item);
      return;
    }
    await _fromPhone();
  }

  Future<void> _fromPhone() async {
    final picked = await pickPhonePicture();
    if (picked == null || !mounted) return;
    final mime = mimeForFileName(picked.name);
    final problem = mediaUploadError(mime: mime, bytes: picked.bytes.length);
    if (problem != null) {
      showKToast(context, problem, tone: KTone.negative);
      return;
    }
    setState(() => _busy = true);
    try {
      final reply = await widget.session.api.uploadTyped(mediaPath, bytes: picked.bytes, fileName: picked.name, contentType: mime);
      final item = uploadedMediaFrom(reply);
      if (!mounted) return;
      if (item == null) {
        showKToast(context, 'The picture could not be uploaded. Try again.', tone: KTone.negative);
      } else {
        widget.onChanged(item);
      }
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'The picture could not be uploaded. Try again.', tone: KTone.negative);
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.picture;
    if (p == null) {
      return KButton.secondary(label: 'Choose picture', icon: LucideIcons.image, loading: _busy, onPressed: _busy ? null : _choose);
    }
    return KCard(
      padding: const EdgeInsets.all(AppSpace.md),
      child: Row(children: [
        _thumb(p.url, 56),
        const SizedBox(width: AppSpace.md),
        Expanded(child: Text(p.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.bodyStrong)),
        KTextButton(label: 'Remove picture', onTap: () => widget.onChanged(null)),
      ]),
    );
  }
}

/// The pictures already uploaded (website media library). Tap one to use it; pops its [MediaItem].
class MediaLibraryScreen extends StatefulWidget {
  const MediaLibraryScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<MediaLibraryScreen> createState() => _MediaLibraryScreenState();
}

class _MediaLibraryScreenState extends State<MediaLibraryScreen> {
  List<MediaItem> _items = const [];
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final items = mediaFrom(await widget.session.api.getJson(mediaPath));
      if (!mounted) return;
      setState(() {
        _items = items;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const KBackBar('Media library'),
          Expanded(child: _body()),
        ]),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: AppSpace.xxl * 2));
    if (_error != null) {
      return ListView(children: [
        KEmptyState(
          icon: _notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
          title: _notInPlan ? 'Not included in your current plan' : 'Could not load pictures',
          body: _error,
          action: _notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
        ),
      ]);
    }
    if (_items.isEmpty) {
      return ListView(children: const [KEmptyState(icon: LucideIcons.images, title: 'No pictures yet', body: 'A picture you pick from this phone is kept here.')]);
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xxl * 2),
      children: [
        KCard(
          child: KDivided(children: [
            for (final m in _items)
              KListRow(
                title: m.name,
                subtitle: m.size > 0 ? '${(m.size / 1024).ceil()} KB' : null,
                leading: _thumb(m.url, 44),
                onTap: () => Navigator.of(context).pop(m),
              ),
          ]),
        ),
      ],
    );
  }
}
