import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import 'hub_common.dart';

/// Photos larger than this are refused here; the web catalogue scales them down instead.
const _photoMaxBytes = 600 * 1024;

/// The supplier's own catalogue for connected buyers, on the phone: add items, set price,
/// minimum order, multiples, sizes / colours with prices, and a photo.
class MyCatalogScreen extends StatefulWidget {
  const MyCatalogScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<MyCatalogScreen> createState() => _MyCatalogScreenState();
}

class _MyCatalogScreenState extends State<MyCatalogScreen> {
  List<Map<String, dynamic>>? _listings;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/suppliers/hub/published-listings');
      if (mounted) setState(() { _listings = hubList(body['listings']); _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _add() async {
    final item = await pickOwnItem(context, widget.session, title: 'Add to your catalogue');
    if (item == null) return;
    try {
      await widget.session.api.postJson('/api/suppliers/hub/published-listings', {'item_id': item['id'], 'audience': 'linked_only'});
      await _load();
    } on ApiException catch (e) {
      if (mounted) hubSnack(context, e.message);
    }
  }

  static String _optionsText(dynamic options) => hubList(options)
      .map((o) => o['price'] == null ? '${o['label']}' : '${o['label']}:${qtyText(toNum(o['price']))}')
      .join(', ');

  Future<void> _edit(Map<String, dynamic> l) async {
    final price = TextEditingController(text: l['price'] == null ? '' : qtyText(toNum(l['price'])));
    final moq = TextEditingController(text: l['moq'] == null ? '' : qtyText(toNum(l['moq'])));
    final multiple = TextEditingController(text: l['order_multiple'] == null ? '' : qtyText(toNum(l['order_multiple'])));
    final options = TextEditingController(text: _optionsText(l['options']));
    final pack = TextEditingController(text: l['pack_label']?.toString() ?? '');
    String? photo; // data URL when a new photo was picked, '' to remove
    var listed = l['is_active'] != false;
    final save = await showKSheet<bool>(
      context,
      title: hubText(l['display_name']) ?? l['item_name']?.toString() ?? 'Item',
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Padding(
          padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 4, AppSpace.gutter, AppSpace.md),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            TextField(controller: price, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Price for connected shops (₹)')),
            Row(children: [
              Expanded(child: TextField(controller: moq, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Min order'))),
              const SizedBox(width: AppSpace.sm),
              Expanded(child: TextField(controller: multiple, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'In multiples of'))),
            ]),
            TextField(controller: pack, decoration: const InputDecoration(labelText: 'Pack, e.g. Set of 4: S, M, L, XL')),
            TextField(controller: options, decoration: const InputDecoration(labelText: 'Sizes / colours with price', hintText: 'S:450, M:450, L:480')),
            const SizedBox(height: AppSpace.sm),
            Row(children: [
              Expanded(
                child: Text(
                  photo == null
                      ? (hubText(l['image_url']) != null ? 'Has a photo' : 'No photo')
                      : photo!.isEmpty
                          ? 'Photo will be removed'
                          : 'New photo picked',
                  style: AppText.caption,
                ),
              ),
              KTextButton(
                label: 'Pick photo',
                onTap: () async {
                  final file = await FilePicker.pickFile(type: FileType.image);
                  if (file == null) return;
                  final bytes = await file.readAsBytes();
                  if (bytes.length > _photoMaxBytes) {
                    if (ctx.mounted) hubSnack(ctx, 'Use a photo under 600 KB.');
                    return;
                  }
                  final mime = file.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                  setSheet(() => photo = 'data:$mime;base64,${base64Encode(bytes)}');
                },
              ),
              if (hubText(l['image_url']) != null) KTextButton(label: 'Remove', onTap: () => setSheet(() => photo = '')),
            ]),
            SwitchListTile.adaptive(
              contentPadding: EdgeInsets.zero,
              value: listed,
              onChanged: (v) => setSheet(() => listed = v),
              title: Text('Listed', style: AppText.bodyStrong),
            ),
            KButton(label: 'Save', onPressed: () => Navigator.pop(ctx, true)),
          ]),
        ),
      ),
    );
    if (save == true) {
      try {
        await widget.session.api.patchJson('/api/suppliers/hub/published-listings/${l['id']}', {
          'price': price.text.trim().isEmpty ? null : price.text.trim(),
          'moq': moq.text.trim().isEmpty ? null : moq.text.trim(),
          'order_multiple': multiple.text.trim().isEmpty ? null : multiple.text.trim(),
          'pack_label': pack.text.trim(),
          'options': options.text.trim(),
          'is_active': listed,
          'image_url': ?photo,
        });
        if (mounted) hubSnack(context, 'Saved');
        await _load();
      } on ApiException catch (e) {
        if (mounted) hubSnack(context, e.message);
      }
    }
    for (final c in [price, moq, multiple, options, pack]) {
      c.dispose();
    }
  }

  @override
  Widget build(BuildContext context) {
    final listings = _listings;
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _add,
        icon: const Icon(LucideIcons.plus),
        label: const Text('Add item'),
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.only(top: 8, bottom: 96),
            children: [
              const HubTitleBar('My catalogue'),
              if (_error != null)
                KEmptyState(icon: LucideIcons.cloudOff, title: 'Could not load', body: _error)
              else if (listings == null)
                const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
              else if (listings.isEmpty)
                const KEmptyState(icon: LucideIcons.package, title: 'No items yet', body: 'Add the items you sell to connected shops.')
              else
                KCard(
                  margin: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
                  child: Column(children: [
                    for (final l in listings)
                      KListRow(
                        title: hubText(l['display_name']) ?? l['item_name']?.toString() ?? '',
                        subtitle: [
                          if (l['price'] != null) inr(toNum(l['price']), maxFraction: 2),
                          if (l['moq'] != null) 'min ${qtyText(toNum(l['moq']))}',
                          if (hubList(l['options']).isNotEmpty) _optionsText(l['options']),
                          if (l['is_active'] == false) 'not listed',
                        ].join(' · '),
                        onTap: () => _edit(l),
                      ),
                  ]),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
