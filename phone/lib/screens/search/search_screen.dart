import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../parties/party_logic.dart';

/// One row from GET `/api/search`.
class SearchHit {
  const SearchHit({required this.type, required this.id, required this.title, this.subtitle, this.date, this.amount});

  final String type;
  final String id;
  final String title;
  final String? subtitle;
  final String? date;
  final num? amount;
}

/// Grouped results in the website's section order.
class SearchResults {
  const SearchResults({
    this.estimates = const [],
    this.invoices = const [],
    this.customers = const [],
    this.items = const [],
    this.suppliers = const [],
  });

  final List<SearchHit> estimates;
  final List<SearchHit> invoices;
  final List<SearchHit> customers;
  final List<SearchHit> items;
  final List<SearchHit> suppliers;

  int get total => estimates.length + invoices.length + customers.length + items.length + suppliers.length;

  static SearchResults fromJson(Map<String, dynamic> body) {
    List<SearchHit> read(String key) {
      final raw = (body['results'] as Map?)?[key];
      if (raw is! List) return const [];
      return raw.whereType<Map>().map((e) {
        final row = Map<String, dynamic>.from(e);
        return SearchHit(
          type: row['type']?.toString() ?? key,
          id: row['id']?.toString() ?? '',
          title: row['title']?.toString() ?? '',
          subtitle: row['subtitle']?.toString(),
          date: row['date']?.toString(),
          amount: row['amount'] == null ? null : toNum(row['amount']),
        );
      }).toList();
    }

    return SearchResults(
      estimates: read('estimates'),
      invoices: read('invoices'),
      customers: read('customers'),
      items: read('items'),
      suppliers: read('suppliers'),
    );
  }
}

String searchTypeLabel(String type) => switch (type) {
      'invoice' => 'Invoice',
      'estimate' => 'Estimate',
      'customer' => 'Customer',
      'item' => 'Item',
      'supplier' => 'Supplier',
      _ => type,
    };

/// `app/(app)/search/page.tsx`. The query box is on this page so it can be opened from More.
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key, required this.session, required this.onOpenHit});

  final AppSession session;
  final void Function(SearchHit hit) onOpenHit;

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _query = TextEditingController();
  SearchResults? _results;
  bool _loading = false;
  bool _searched = false;
  Timer? _debounce;
  int _request = 0;

  static const _types = {
    'invoice': (LucideIcons.fileText, AppTints.sky),
    'estimate': (LucideIcons.fileSpreadsheet, AppTints.violet),
    'customer': (LucideIcons.user, AppTints.green),
    'item': (LucideIcons.package, AppTints.amber),
    'supplier': (LucideIcons.store, AppTints.teal),
  };

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  void _onChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), _search);
    setState(() {});
  }

  Future<void> _search() async {
    final q = _query.text.trim();
    final request = ++_request;
    if (q.isEmpty) {
      setState(() {
        _results = null;
        _searched = false;
        _loading = false;
      });
      return;
    }
    setState(() {
      _loading = true;
      _searched = true;
    });
    try {
      final body = await widget.session.api.getJson(Uri(path: '/api/search', queryParameters: {'q': q}).toString());
      if (!mounted || request != _request) return;
      setState(() => _results = SearchResults.fromJson(body));
    } catch (_) {
      if (mounted && request == _request) setState(() => _results = null);
    } finally {
      if (mounted && request == _request) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final results = _results;
    final q = _query.text.trim();
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 8, AppSpace.gutter, 8),
              child: Row(
                children: [
                  KIconButton(icon: LucideIcons.arrowLeft, tooltip: 'Back', onTap: () => Navigator.of(context).pop()),
                  const SizedBox(width: 4),
                  Expanded(
                    child: KSearchField(
                      controller: _query,
                      hint: 'Invoices, customers, items, suppliers',
                      autofocus: true,
                      onChanged: _onChanged,
                      trailing: q.isEmpty
                          ? null
                          : KIconButton(
                              icon: LucideIcons.x,
                              tooltip: 'Clear search',
                              color: AppColors.ink3,
                              onTap: () {
                                _query.clear();
                                _search();
                              },
                            ),
                    ),
                  ),
                ],
              ),
            ),
            if (_loading) LinearProgressIndicator(minHeight: 2, color: AppColors.brand, backgroundColor: Colors.transparent) else const SizedBox(height: 2),
            Expanded(
              child: !_searched
                  ? ListView(
                      children: const [
                        KEmptyState(
                          icon: LucideIcons.search,
                          title: 'Search everything',
                          body: 'Find invoices, customers, items and suppliers by name, number or phone.',
                        ),
                      ],
                    )
                  : results == null || results.total == 0
                      ? ListView(
                          children: [
                            if (!_loading)
                              KEmptyState(
                                icon: LucideIcons.searchX,
                                title: 'No results for "$q"',
                                body: 'Try a bill number, a phone number or part of a name.',
                              ),
                          ],
                        )
                      : ListView(
                          padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.xl),
                          children: [
                            for (final (title, rows) in [
                              ('Invoices', results.invoices),
                              ('Customers', results.customers),
                              ('Items', results.items),
                              ('Suppliers', results.suppliers),
                              ('Estimates', results.estimates),
                            ])
                              if (rows.isNotEmpty) ...[
                                const SizedBox(height: AppSpace.md),
                                KSectionHeader('$title (${rows.length})'),
                                KCard(
                                  child: KDivided(
                                    indent: 66,
                                    children: [
                                      for (final hit in rows)
                                        KListRow(
                                          onTap: () => widget.onOpenHit(hit),
                                          leading: Container(
                                            width: 40,
                                            height: 40,
                                            decoration: BoxDecoration(
                                              color: (_types[hit.type]?.$2 ?? AppTints.indigo).$1,
                                              borderRadius: BorderRadius.circular(12),
                                            ),
                                            child: Icon(
                                              _types[hit.type]?.$1 ?? LucideIcons.fileText,
                                              size: 18,
                                              color: (_types[hit.type]?.$2 ?? AppTints.indigo).$2,
                                            ),
                                          ),
                                          title: hit.title,
                                          subtitle: _subtitle(hit),
                                          trailing: const Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
                                        ),
                                    ],
                                  ),
                                ),
                              ],
                          ],
                        ),
            ),
          ],
        ),
      ),
    );
  }

  String _subtitle(SearchHit hit) {
    final parts = <String>[];
    final day = hit.date == null ? null : parsePartyDate(hit.date);
    if (day != null && (hit.type == 'invoice' || hit.type == 'estimate')) parts.add(ddMMMyyyy(day));
    if (hit.type == 'item' && hit.subtitle != null && hit.subtitle!.isNotEmpty) parts.add('Code: ${hit.subtitle}');
    if (hit.amount != null && (hit.type == 'invoice' || hit.type == 'estimate' || hit.type == 'item')) {
      parts.add('₹${enIn(hit.amount!)}');
    }
    if (parts.isEmpty && hit.subtitle != null) return hit.subtitle!;
    return parts.join(' • ');
  }
}
