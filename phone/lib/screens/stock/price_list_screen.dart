import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import 'party_pricing_screen.dart';
import 'pricing_logic.dart';

/// Website `/pricing/price-list`: what a customer pays per item on a date. The prices are the
/// server's answer from `POST /api/pricing/resolve`; the phone never works one out.
class PriceListScreen extends StatefulWidget {
  const PriceListScreen({super.key, required this.session, this.customerId, this.customerName});

  final AppSession session;

  /// Opens priced for this customer (from Party pricing).
  final String? customerId;
  final String? customerName;

  @override
  State<PriceListScreen> createState() => _PriceListScreenState();
}

typedef _Applied = ({String? id, String? name, DateTime date, String query});

class _PriceListScreenState extends State<PriceListScreen> {
  static const _pageSize = 100;

  final _search = TextEditingController();
  Timer? _debounce;
  int _ticket = 0;

  String? _customerId;
  String? _customerName;
  DateTime _date = DateTime.now();
  bool _onlySpecial = false;

  /// What the rows on screen were priced with; a refused change goes back to it.
  late _Applied _applied = (id: null, name: null, date: _date, query: '');

  List<PriceLine> _lines = const [];
  List<Map<String, dynamic>> _variants = const [];
  String? _variantsFor;
  int _page = 1;
  int _totalPages = 1;
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  bool _notInPlan = false;

  @override
  void initState() {
    super.initState();
    _customerId = widget.customerId;
    _customerName = widget.customerName;
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<List<Map<String, dynamic>>> _customerVariants() async {
    final id = _customerId;
    if (id == null) return const [];
    if (_variantsFor == id) return _variants;
    List<Map<String, dynamic>> found = const [];
    try {
      final body = await widget.session.api.getJson('/api/pricing/party-item?party_id=${Uri.encodeQueryComponent(id)}');
      found = docRows(body, 'variants');
    } catch (_) {
      // The website prices whole items when this list is not available (no party pricing plan).
    }
    _variants = found;
    _variantsFor = id;
    return found;
  }

  /// Loads page [page] of the items and prices each row. [page] 1 replaces what is on screen.
  Future<void> _load({int page = 1}) async {
    final ticket = ++_ticket;
    final more = page > 1;
    final hadRows = _lines.isNotEmpty;
    setState(() {
      if (more) {
        _loadingMore = true;
      } else {
        _loading = !hadRows;
        _loadingMore = false;
      }
      _error = null;
      _notInPlan = false;
    });
    try {
      final q = _search.text.trim();
      final api = widget.session.api;
      final path = Uri(path: '/api/items', queryParameters: {'limit': '$_pageSize', 'page': '$page', if (q.isNotEmpty) 'search': q}).toString();
      final body = await api.getData(path);
      final items = docRows(body, 'items');
      final wants = priceWants(items, await _customerVariants());
      final priced = <PriceLine>[];
      for (final chunk in chunked(wants)) {
        final reply = await api.postJson(
          '/api/pricing/resolve',
          resolveRequestBody(_customerId, [for (final w in chunk) w.itemId], date: priceDate(_date), variantIds: [for (final w in chunk) w.variantId]),
        );
        priced.addAll(priceLines(chunk, reply));
      }
      if (!mounted || ticket != _ticket) return;
      final paging = docPaging(body);
      setState(() {
        _lines = more ? [..._lines, ...priced] : priced;
        _page = paging?.page ?? page;
        _totalPages = paging?.totalPages ?? 1;
        _loading = false;
        _loadingMore = false;
        _applied = (id: _customerId, name: _customerName, date: _date, query: _search.text);
      });
    } catch (e) {
      if (!mounted || ticket != _ticket) return;
      final fail = failureOf(e);
      if (hadRows || more) {
        // Keep what is on screen and go back to the settings it was priced with.
        setState(() {
          _loading = false;
          _loadingMore = false;
          if (!more) {
            _customerId = _applied.id;
            _customerName = _applied.name;
            _date = _applied.date;
            _search.text = _applied.query;
          }
        });
        showKToast(context, fail.message, tone: KTone.negative);
      } else {
        setState(() {
          _loading = false;
          _error = fail.message;
          _notInPlan = fail.notInPlan;
        });
      }
    }
  }

  void _pickCustomer(String? id, String? name) {
    setState(() {
      _customerId = id;
      _customerName = name;
    });
    _load();
  }

  void _typed(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), _load);
  }

  @override
  Widget build(BuildContext context) {
    final shown = _onlySpecial ? onlySpecial(_lines) : _lines;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Price list'),
            Expanded(
              child: RefreshIndicator(
                color: AppColors.brand,
                onRefresh: () => _load(),
                child: ListView(
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
                  children: [
                    Text(
                      'What a customer pays per item on a date: their own price, their price level\'s rate, or the item price.',
                      style: AppText.caption,
                    ),
                    const SizedBox(height: AppSpace.md),
                    KAsyncPickField(
                      label: 'Customer',
                      valueLabel: _customerName ?? 'Everyone (item prices)',
                      search: (q) => searchCustomers(widget.session.api, q),
                      onPicked: _pickCustomer,
                    ),
                    if (_customerId != null)
                      Align(
                        alignment: Alignment.centerLeft,
                        child: KTextButton(label: 'Show item prices for everyone', onTap: () => _pickCustomer(null, null)),
                      ),
                    const SizedBox(height: AppSpace.md),
                    KDateField(
                      label: 'Prices on',
                      value: _date,
                      onChanged: (d) {
                        setState(() => _date = d);
                        _load();
                      },
                    ),
                    const SizedBox(height: AppSpace.md),
                    KSearchField(controller: _search, hint: 'Search items', onChanged: _typed),
                    const SizedBox(height: AppSpace.sm),
                    Row(children: [
                      KChip(label: 'Only special prices', selected: _onlySpecial, onTap: () => setState(() => _onlySpecial = !_onlySpecial)),
                      const Spacer(),
                      KTextButton(
                        label: 'Edit party prices',
                        onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
                          builder: (_) => PartyPricingScreen(session: widget.session, customerId: _customerId, customerName: _customerName),
                        )),
                      ),
                    ]),
                    const SizedBox(height: AppSpace.sm),
                    ..._body(shown),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _body(List<PriceLine> shown) {
    if (_loading) return const [KSpinner(padding: EdgeInsets.symmetric(vertical: 48))];
    if (_error != null) {
      return [
        PricingFailure(title: 'Could not load prices', message: _error!, notInPlan: _notInPlan, onRetry: _load),
      ];
    }
    if (shown.isEmpty) {
      final searching = _search.text.trim().isNotEmpty;
      return [
        KEmptyState(
          icon: LucideIcons.tag,
          title: _onlySpecial && _lines.isNotEmpty ? 'No special prices' : (searching ? 'No items match' : 'No items'),
        ),
      ];
    }
    return [
      KCard(child: KDivided(indent: 0, children: [for (final l in shown) _row(l)])),
      if (_page < _totalPages) ...[
        const SizedBox(height: AppSpace.md),
        KButton.secondary(label: 'Show more', loading: _loadingMore, onPressed: _loadingMore ? null : () => _load(page: _page + 1)),
      ],
    ];
  }

  Widget _row(PriceLine l) {
    final w = l.want;
    final name = w.variantName != null && w.variantName!.isNotEmpty ? '${w.itemName} - ${w.variantName}' : w.itemName;
    final basis = [
      if (l.mrp != null) 'MRP ${inr(l.mrp!, maxFraction: 2)}',
      if (l.taxRate != null) 'GST ${plainNum(l.taxRate!)}% ${l.gstIncluded ? '(incl.)' : '(extra)'}',
    ].join(' · ');
    final price = l.price;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(name, style: AppText.bodyStrong),
            if (w.unit.isNotEmpty) Text('per ${w.unit}', style: AppText.caption),
            if (l.hasScheme)
              Text('Buy ${plainNum(l.buyQty!)}, get ${plainNum(l.freeQty!)} free', style: AppText.caption.copyWith(color: AppColors.positive)),
            if (basis.isNotEmpty) Text(basis, style: AppText.caption),
          ]),
        ),
        const SizedBox(width: AppSpace.md),
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          price == null
              ? Text('—', style: AppText.bodyStrong)
              : KAmount(price, maxFraction: 2, style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
          if (l.priceSource != 'catalog') Text(priceSourceLabel(l.priceSource), style: AppText.caption.copyWith(color: AppColors.brand)),
          if (l.discountPercent != null)
            Text('Disc ${plainNum(l.discountPercent!)}%', style: AppText.caption.copyWith(fontFeatures: AppText.tabular)),
        ]),
      ]),
    );
  }
}

/// Error state shared by the pricing screens: the server's words with Try again, or the plan lock.
class PricingFailure extends StatelessWidget {
  const PricingFailure({super.key, required this.title, required this.message, required this.notInPlan, required this.onRetry});

  final String title;
  final String message;
  final bool notInPlan;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return KEmptyState(
      icon: notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
      title: notInPlan ? 'Not included in your current plan' : title,
      body: message,
      action: notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: onRetry),
    );
  }
}
