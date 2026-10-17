import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';

/// Shared bits for the Supplier Hub screens (incoming bills, orders, new arrivals, links).

List<Map<String, dynamic>> hubList(dynamic raw) =>
    raw is List ? raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [];

Map<String, dynamic> hubMap(dynamic raw) => raw is Map ? Map<String, dynamic>.from(raw) : const {};

String? hubText(dynamic v) {
  final s = v?.toString().trim();
  return (s == null || s.isEmpty) ? null : s;
}

/// Quantities without trailing zeros (3, 2.5, 0.125).
String qtyText(num v) {
  final d = v.toDouble();
  if (d == d.roundToDouble()) return d.toInt().toString();
  return d.toStringAsFixed(3).replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '');
}

String hubDate(dynamic raw) {
  final d = DateTime.tryParse(raw?.toString() ?? '');
  return d == null ? '' : ddMMM(d.toLocal());
}

void hubSnack(BuildContext context, String message) =>
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));

/// Order statuses as a tone and a short label for the phone.
(KTone, String) supplyOrderTone(String status) => switch (status) {
      'draft' => (KTone.neutral, 'Draft'),
      'proposed' => (KTone.due, 'Waiting for buyer'),
      'pending' => (KTone.due, 'Waiting for supplier'),
      'confirmed' => (KTone.positive, 'Confirmed'),
      'partial' => (KTone.due, 'Part confirmed'),
      'declined' => (KTone.negative, 'Declined'),
      'invoiced' => (KTone.brand, 'Billed'),
      'received' => (KTone.positive, 'Received'),
      'cancelled' => (KTone.negative, 'Cancelled'),
      _ => statusTone(status),
    };

/// Back button plus title, as on the other phone list screens.
class HubTitleBar extends StatelessWidget {
  const HubTitleBar(this.title, {super.key, this.trailing});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 4, AppSpace.gutter, 0),
      child: Row(children: [
        KIconButton(icon: LucideIcons.arrowLeft, tooltip: 'Back', onTap: () => Navigator.of(context).maybePop()),
        Expanded(child: Text(title, style: AppText.heading.copyWith(fontSize: 22), maxLines: 2, overflow: TextOverflow.ellipsis)),
        ?trailing,
      ]),
    );
  }
}

/// A small numeric field used for quantities on hub screens.
class HubQtyField extends StatelessWidget {
  const HubQtyField({super.key, required this.controller, this.label, this.width = 92, this.onChanged});

  final TextEditingController controller;
  final String? label;
  final double width;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: TextField(
        controller: controller,
        onChanged: onChanged,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        textAlign: TextAlign.end,
        style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular),
        decoration: InputDecoration(
          isDense: true,
          labelText: label,
          filled: true,
          fillColor: AppColors.sunken,
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
          contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        ),
      ),
    );
  }
}

/// Pick one of the business's own items: suggestions first, then a search of all items.
Future<Map<String, dynamic>?> pickOwnItem(
  BuildContext context,
  AppSession session, {
  String title = 'Your item',
  List<Map<String, dynamic>> suggestions = const [],
}) {
  return showKSheet<Map<String, dynamic>>(
    context,
    title: title,
    builder: (ctx) => _OwnItemPicker(session: session, suggestions: suggestions),
  );
}

class _OwnItemPicker extends StatefulWidget {
  const _OwnItemPicker({required this.session, required this.suggestions});

  final AppSession session;
  final List<Map<String, dynamic>> suggestions;

  @override
  State<_OwnItemPicker> createState() => _OwnItemPickerState();
}

class _OwnItemPickerState extends State<_OwnItemPicker> {
  final _q = TextEditingController();
  List<Map<String, dynamic>> _hits = const [];
  bool _loading = false;
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _q.dispose();
    super.dispose();
  }

  void _search(String text) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () async {
      final q = text.trim();
      if (q.length < 2) {
        if (mounted) setState(() => _hits = const []);
        return;
      }
      setState(() => _loading = true);
      try {
        final body = await widget.session.api.getJson('/api/items?search=${Uri.encodeQueryComponent(q)}&limit=30');
        if (mounted) setState(() => _hits = hubList(body['items']));
      } on ApiException {
        if (mounted) setState(() => _hits = const []);
      } finally {
        if (mounted) setState(() => _loading = false);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final rows = _q.text.trim().length >= 2 ? _hits : widget.suggestions;
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.6,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 4, AppSpace.gutter, AppSpace.sm),
            child: KSearchField(controller: _q, hint: 'Search your items', onChanged: _search),
          ),
          if (_q.text.trim().length < 2 && widget.suggestions.isNotEmpty)
            const Padding(
              padding: EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, 4),
              child: Text('Likely matches'),
            ),
          if (_loading) const KSpinner(padding: EdgeInsets.symmetric(vertical: 24)),
          Expanded(
            child: ListView(
              children: [
                for (final item in rows)
                  KListRow(
                    title: item['name']?.toString() ?? '',
                    subtitle: hubText(item['unit']),
                    onTap: () => Navigator.of(context).pop(item),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
