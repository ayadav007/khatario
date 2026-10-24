import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'item_detail_screen.dart';
import 'scan_add_logic.dart';

/// End of a Scan & Add session, phone side of `components/items/ScanAddReview.tsx`: counts, items
/// that still need HSN or prices, and saves that did not go through. Item details are read fresh
/// from POST /api/items/scan-add/review, so fixes made on the item page show after Refresh.
class ScanAddReviewScreen extends StatefulWidget {
  const ScanAddReviewScreen({super.key, required this.session, required this.entries, required this.onOpen});

  final AppSession session;
  final List<ScanAddEntry> entries;
  final ValueChanged<String>? onOpen;

  @override
  State<ScanAddReviewScreen> createState() => _ScanAddReviewScreenState();
}

/// What the review hands back: the session rows after retries and discards, and whether to finish.
typedef ScanAddReviewResult = ({List<ScanAddEntry> entries, bool finished});

class _ScanAddReviewScreenState extends State<ScanAddReviewScreen> {
  late List<ScanAddEntry> _entries = List.of(widget.entries);
  List<Map<String, dynamic>> _items = const [];
  bool _loading = true;
  String _filter = 'all';
  String? _retrying;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final body = await widget.session.api.postJson('/api/items/scan-add/review', {'item_ids': reviewItemIds(_entries)});
      if (!mounted) return;
      setState(() => _items = (body['items'] as List? ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList());
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _retry(ScanAddEntry e) async {
    final body = e.body;
    final key = e.idempotencyKey;
    if (body == null || key == null) return;
    setState(() => _retrying = e.key);
    try {
      final res = await widget.session.api.postJson('/api/items', body, headers: {'X-Idempotency-Key': key});
      final item = res['item'] is Map ? Map<String, dynamic>.from(res['item'] as Map) : const <String, dynamic>{};
      final saved = ScanAddEntry(
        name: item['name']?.toString() ?? e.name,
        outcome: 'created',
        barcode: e.barcode,
        itemId: item['id']?.toString(),
        qty: e.qty,
        source: e.source,
        idempotencyKey: key,
      );
      setState(() => _entries = addScanAddEntry(_entries, saved));
      await _load();
    } on ApiException catch (err) {
      final again = ScanAddEntry(
        name: e.name,
        outcome: 'failed',
        barcode: e.barcode,
        qty: e.qty,
        source: e.source,
        body: body,
        idempotencyKey: key,
        error: err.message,
      );
      if (mounted) {
        setState(() => _entries = addScanAddEntry(_entries, again));
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
      }
    } finally {
      if (mounted) setState(() => _retrying = null);
    }
  }

  Future<void> _finish() async {
    final failed = _entries.where((e) => e.outcome == 'failed').length;
    if (failed > 0) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Finish the session?'),
          content: Text('$failed products were not saved. Finishing drops them.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Back')),
            TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Finish')),
          ],
        ),
      );
      if (ok != true) return;
    }
    if (mounted) Navigator.of(context).pop<ScanAddReviewResult>((entries: _entries, finished: true));
  }

  Widget _tile(String label, int value, {Color? color}) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    decoration: BoxDecoration(
      border: Border.all(color: AppColors.hairline),
      borderRadius: BorderRadius.circular(AppRadius.sm),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('$value', style: AppText.heading.copyWith(fontSize: 18, color: value > 0 ? color : null)),
        Text(label, style: AppText.label),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) {
    final s = summarizeScanAdd(_entries, _items);
    final failed = _entries.where((e) => e.outcome == 'failed').toList();
    final needDetails = _items.where((i) => (i['gaps'] as List? ?? const []).any((g) => blockingGaps.contains(g))).toList();
    final shown = _filter == 'details' ? needDetails : _items;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop<ScanAddReviewResult>((entries: _entries, finished: false));
      },
      child: Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(
                height: 64,
                child: Row(
                  children: [
                    const SizedBox(width: 4),
                    KIconButton(
                      icon: LucideIcons.arrowLeft,
                      tooltip: 'Back to scanning',
                      onTap: () => Navigator.of(context).pop<ScanAddReviewResult>((entries: _entries, finished: false)),
                    ),
                    const SizedBox(width: 4),
                    Expanded(child: Text('Session review', style: AppText.heading.copyWith(fontSize: 18))),
                    KIconButton(icon: LucideIcons.refreshCw, tooltip: 'Refresh', onTap: _loading ? () {} : _load),
                  ],
                ),
              ),
              Expanded(
                child: RefreshIndicator(
                  color: AppColors.brand,
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
                    children: [
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          _tile('Scanned', s['scanned']!),
                          _tile('New items', s['created']!),
                          _tile('Already in shop', s['existing']!),
                          _tile('With stock', s['withStock']!),
                          _tile('Stock added', s['stock']!),
                          _tile('Sizes added', s['size']!),
                          _tile('Need details', s['needDetails']!, color: AppColors.due),
                          _tile('Not saved', s['failed']!, color: AppColors.negative),
                        ],
                      ),
                      const SizedBox(height: AppSpace.sm),
                      Text(
                        'New items: ${s['database']} from a product database, ${s['photo']} read from photos, ${s['manual']} typed in.'
                        '${s['conflicts']! > 0 ? ' ${s['conflicts']} refused because the barcode is on another item.' : ''}',
                        style: AppText.label,
                      ),
                      const SizedBox(height: AppSpace.md),
                      KChipBar<String>(
                        value: _filter,
                        padding: EdgeInsets.zero,
                        options: [
                          ('all', 'All (${_items.length})'),
                          ('details', 'Need details (${needDetails.length})'),
                          ('failed', 'Not saved (${failed.length})'),
                        ],
                        onChanged: (v) => setState(() => _filter = v),
                      ),
                      const SizedBox(height: AppSpace.md),
                      if (_filter == 'failed' || (_filter == 'all' && failed.isNotEmpty)) ...[
                        Text('Not saved', style: AppText.heading.copyWith(fontSize: 16)),
                        const SizedBox(height: AppSpace.sm),
                        if (failed.isEmpty) Text('Every product in this session was saved.', style: AppText.label),
                        for (final e in failed)
                          KCard(
                            padding: const EdgeInsets.all(12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Text(e.name, style: AppText.body),
                                Text(
                                  '${e.barcode.isEmpty ? '' : 'Barcode ${e.barcode} · '}${e.error ?? ''}',
                                  style: AppText.label.copyWith(color: AppColors.negative),
                                ),
                                const SizedBox(height: AppSpace.sm),
                                Row(
                                  children: [
                                    Expanded(
                                      child: KButton(label: 'Try again', loading: _retrying == e.key, onPressed: () => _retry(e)),
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: KButton.secondary(
                                        label: 'Discard',
                                        onPressed: () => setState(() => _entries = _entries.where((x) => x.key != e.key).toList()),
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        const SizedBox(height: AppSpace.md),
                      ],
                      if (_filter != 'failed') ...[
                        if (_loading && _items.isEmpty) const Center(child: KSpinner()),
                        if (!_loading && shown.isEmpty)
                          Text(
                            _filter == 'details' ? 'No item in this session is missing HSN or prices.' : 'No saved items in this session yet.',
                            style: AppText.label,
                          ),
                        for (final i in shown)
                          KListRow(
                            title: i['name']?.toString() ?? '',
                            subtitle: [
                              if (i['has_variants'] == true) '${(i['variants'] as List? ?? const []).length} sizes',
                              if (i['next_expiry'] != null) 'Expires ${i['next_expiry']}',
                              (i['gaps'] as List? ?? const []).isEmpty
                                  ? 'Ready'
                                  : (i['gaps'] as List).map((g) => reviewGapLabels[g] ?? g.toString()).join(' · '),
                            ].join(' · '),
                            trailing: const Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
                            onTap: () async {
                              await Navigator.of(context).push<void>(
                                MaterialPageRoute(
                                  builder: (_) => ItemDetailScreen(session: widget.session, itemId: i['id'].toString(), onOpen: widget.onOpen ?? (_) {}),
                                ),
                              );
                              if (mounted) await _load();
                            },
                          ),
                      ],
                    ],
                  ),
                ),
              ),
              KBottomBar(
                children: [
                  Expanded(
                    child: KButton.secondary(
                      label: 'Back to scanning',
                      onPressed: () => Navigator.of(context).pop<ScanAddReviewResult>((entries: _entries, finished: false)),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: KButton(label: 'Finish session', onPressed: _finish),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
