import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../session.dart';
import '../theme.dart';
import '../ui/kit.dart';
import 'mobile_nav.dart';

/// Opens the navigation editor. Returns true when the account was updated.
Future<bool> showMobileNavEditor(BuildContext context, AppSession session) async {
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: AppColors.surface,
    barrierColor: AppColors.scrim,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet))),
    builder: (ctx) => _NavEditor(session: session),
  );
  return saved == true;
}

class _NavEditor extends StatefulWidget {
  const _NavEditor({required this.session});

  final AppSession session;

  @override
  State<_NavEditor> createState() => _NavEditorState();
}

class _NavEditorState extends State<_NavEditor> {
  late int _slotCount;
  late List<String> _middle;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final allowed = allowedMiddleIds(widget.session);
    final shown = displayedMiddle(widget.session);
    final parsed = parseMobileNavPrefs(widget.session.user['mobile_nav']);
    var count = parsed?.slotCount == 4 || shown.length <= 2 ? 4 : 5;
    if (count == 5 && allowed.length < 3) count = 4;
    _slotCount = count;
    _middle = shown.take(count - 2).toList();
  }

  bool get _canUseFive => allowedMiddleIds(widget.session).length >= 3;

  void _setCount(int next) {
    if (next == 5 && !_canUseFive) return;
    setState(() {
      _slotCount = next;
      if (next == 4) {
        _middle = _middle.take(2).toList();
      } else if (_middle.length < 3) {
        final extra = allowedMiddleIds(widget.session).where((id) => !_middle.contains(id));
        if (extra.isNotEmpty) _middle = [..._middle, extra.first];
      }
    });
  }

  void _move(int index, int dir) {
    final target = index + dir;
    if (target < 0 || target >= _middle.length) return;
    setState(() {
      final next = [..._middle];
      final row = next.removeAt(index);
      next.insert(target, row);
      _middle = next;
    });
  }

  void _remove(String id) {
    if (_middle.length <= 2) return;
    setState(() {
      _middle = _middle.where((item) => item != id).toList();
      _slotCount = _middle.length >= 3 ? 5 : 4;
    });
  }

  void _add(String id) {
    if (_middle.length >= 3 || _middle.contains(id)) return;
    setState(() {
      _middle = [..._middle, id];
      _slotCount = _middle.length >= 3 ? 5 : 4;
    });
  }

  Future<void> _save({required bool reset}) async {
    if (!reset) {
      final error = validateMobileNav(widget.session, slotCount: _slotCount, middle: _middle);
      if (error != null) {
        setState(() => _error = error);
        return;
      }
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.session.api.patchJson(
        '/api/user/mobile-nav',
        reset ? {'reset': true} : {'slotCount': _slotCount, 'middle': _middle},
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = 'Could not save the navigation bar.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final allowed = allowedMiddleIds(widget.session);
    final remaining = allowed.where((id) => !_middle.contains(id)).toList();
    final first = pinnedChats(widget.session) ? 'Chats' : 'Home';
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.85,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 8, bottom: 4),
                width: 36,
                height: 4,
                decoration: BoxDecoration(color: AppColors.hairline, borderRadius: BorderRadius.circular(4)),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 8, 4),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Navigation bar', style: AppText.heading),
                        const SizedBox(height: 2),
                        Text('$first stays first. More stays last.', style: AppText.caption),
                      ],
                    ),
                  ),
                  KIconButton(icon: LucideIcons.x, tooltip: 'Close', onTap: () => Navigator.of(context).pop(false)),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                children: [
                  Row(
                    children: [
                      for (final count in [4, 5])
                        Expanded(
                          child: Padding(
                            padding: EdgeInsets.only(left: count == 5 ? 8 : 0),
                            child: _CountButton(
                              label: '$count tabs',
                              selected: _slotCount == count,
                              enabled: count == 4 || _canUseFive,
                              onTap: () => _setCount(count),
                            ),
                          ),
                        ),
                    ],
                  ),
                  if (!_canUseFive)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text('Only two shortcuts are available, so the bar stays at 4 tabs.', style: AppText.caption),
                    ),
                  const SizedBox(height: 16),
                  Text('On the bar', style: AppText.caption),
                  const SizedBox(height: 6),
                  KCard(
                    child: Column(
                      children: [
                        for (var i = 0; i < _middle.length; i++) ...[
                          if (i > 0) const Divider(height: 1),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                            child: Row(
                              children: [
                                Expanded(child: Text(middleLabel(_middle[i]), style: AppText.body)),
                                IconButton(
                                  visualDensity: VisualDensity.compact,
                                  onPressed: () => _move(i, -1),
                                  icon: const Icon(LucideIcons.chevronUp, size: 18),
                                ),
                                IconButton(
                                  visualDensity: VisualDensity.compact,
                                  onPressed: () => _move(i, 1),
                                  icon: const Icon(LucideIcons.chevronDown, size: 18),
                                ),
                                TextButton(
                                  onPressed: _middle.length <= 2 ? null : () => _remove(_middle[i]),
                                  child: const Text('Remove'),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (remaining.isNotEmpty && _middle.length < 3) ...[
                    const SizedBox(height: 16),
                    Text('Add', style: AppText.caption),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final id in remaining)
                          ActionChip(
                            label: Text(middleLabel(id)),
                            onPressed: () => _add(id),
                          ),
                      ],
                    ),
                  ],
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text(_error!, style: AppText.caption.copyWith(color: AppColors.negative)),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
              child: Row(
                children: [
                  Expanded(child: KButton.secondary(label: 'Reset', onPressed: _saving ? null : () => _save(reset: true))),
                  const SizedBox(width: 8),
                  Expanded(child: KButton(label: _saving ? 'Saving…' : 'Save', onPressed: _saving ? null : () => _save(reset: false))),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CountButton extends StatelessWidget {
  const _CountButton({required this.label, required this.selected, required this.enabled, required this.onTap});

  final String label;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: enabled ? 1 : 0.4,
      child: Material(
        color: selected ? AppColors.brandSoft : AppColors.sunken,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(label, textAlign: TextAlign.center, style: AppText.body.copyWith(fontWeight: FontWeight.w600, color: selected ? AppColors.brand : AppColors.ink)),
          ),
        ),
      ),
    );
  }
}
