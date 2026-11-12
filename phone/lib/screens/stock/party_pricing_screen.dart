import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import 'price_levels_screen.dart';
import 'price_list_screen.dart';
import 'pricing_forms.dart';
import 'pricing_logic.dart';

enum _Tab { items, categories, history }

/// Website `/pricing/party-item`: a price or a discount per customer (with optional dates), a
/// discount per item category, the customer's price level, and the history of changes.
///
/// The old settings screen listed customers, showed raw item ids and asked for an item id to set a
/// price; this one picks the customer and the item by name, as the website does.
class PartyPricingScreen extends StatefulWidget {
  const PartyPricingScreen({super.key, required this.session, this.customerId, this.customerName});

  final AppSession session;

  /// Opens with this customer's prices loaded (from the price list).
  final String? customerId;
  final String? customerName;

  @override
  State<PartyPricingScreen> createState() => _PartyPricingScreenState();
}

class _PartyPricingScreenState extends State<PartyPricingScreen> {
  String? _partyId;
  String? _partyName;
  _Tab _tab = _Tab.items;

  bool _loading = false;
  String? _error;
  bool _notInPlan = false;
  int _ticket = 0;

  PartyPrices _prices = partyPrices(null);
  PartyCategories _cats = partyCategories(null);
  List<HistoryEntry> _history = const [];
  String _levelId = '';

  Map<String, Map<String, dynamic>> _items = const {};
  List<PriceLevel> _levels = const [];

  KhatarioApi get _api => widget.session.api;

  @override
  void initState() {
    super.initState();
    _partyId = widget.customerId;
    _partyName = widget.customerName;
    _loadLookups();
    if (_partyId != null) _loadParty();
  }

  /// Item names and price levels. Without them the rows still show, just without names.
  Future<void> _loadLookups() async {
    final results = await Future.wait<dynamic>([
      _api.getData('/api/items?limit=500').catchError((_) => null),
      _api.getData('/api/pricing/levels').catchError((_) => null),
    ]);
    if (!mounted) return;
    setState(() {
      _items = itemsById(results[0]);
      _levels = priceLevels(results[1]);
    });
  }

  Future<void> _loadParty() async {
    final id = _partyId;
    if (id == null) return;
    final ticket = ++_ticket;
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final q = Uri.encodeQueryComponent(id);
      final mainF = _api.getData('/api/pricing/party-item?party_id=$q');
      // Categories and history are extras: the website shows the prices when they fail.
      final catF = _api.getData('/api/pricing/party-category?party_id=$q').catchError((_) => null);
      final histF = _api.getData('/api/pricing/history?party_id=$q').catchError((_) => null);
      final main = await mainF;
      final cats = await catF;
      final hist = await histF;
      if (!mounted || ticket != _ticket) return;
      final prices = partyPrices(main);
      setState(() {
        _prices = prices;
        _levelId = prices.levelId;
        _cats = partyCategories(cats);
        _history = historyEntries(hist);
        _loading = false;
      });
    } catch (e) {
      if (!mounted || ticket != _ticket) return;
      final fail = failureOf(e);
      setState(() {
        _loading = false;
        _error = fail.message;
        _notInPlan = fail.notInPlan;
      });
    }
  }

  void _pickCustomer(String id, String name) {
    setState(() {
      _partyId = id;
      _partyName = name;
      _tab = _Tab.items;
      _prices = partyPrices(null);
      _cats = partyCategories(null);
      _history = const [];
      _levelId = '';
    });
    _loadParty();
  }

  String _titleOf(PartyRate r) => rateTitle(_items, _prices.variants, r.itemId, r.variantId);

  Future<void> _changeLevel(String levelId) async {
    final id = _partyId;
    if (id == null) return;
    final previous = _levelId;
    setState(() => _levelId = levelId);
    try {
      await _api.postJson('/api/pricing/levels', assignLevelBody(levelId.isEmpty ? null : levelId, id));
      if (!mounted || _partyId != id) return;
      if (mounted) showKToast(context, levelId.isEmpty ? 'Price level removed' : 'Price level set', tone: KTone.positive);
    } catch (e) {
      // The customer changed while this was in flight: it is no longer this screen's news.
      if (!mounted || _partyId != id) return;
      setState(() => _levelId = previous);
      showKToast(context, failureOf(e).message, tone: KTone.negative);
    }
  }

  Future<void> _editPrice(PartyRate? existing) async {
    final id = _partyId;
    if (id == null) return;
    final who = _partyName ?? 'this customer';
    final title = existing == null ? '' : _titleOf(existing);
    final named = existing != null && docText(_items[existing.itemId]?['name']).isNotEmpty;
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => RateFormPage(
        session: widget.session,
        title: existing == null ? 'Add price' : 'Change price',
        pickItem: existing == null,
        itemId: existing?.itemId ?? '',
        subject: existing == null ? null : title,
        variants: _prices.variants,
        variantId: existing?.variantId ?? '',
        initial: existing?.draft ?? const RateDraft(),
        onSave: (v) async {
          if (existing == null) _items = {..._items, v.itemId: {...?_items[v.itemId], 'name': v.itemName}};
          await _api.postJson(
            '/api/pricing/party-item',
            partyItemBody(id, existing?.itemId ?? v.itemId, existing == null ? v.variantId : existing.variantId, v.rate),
          );
        },
        onRemove: existing == null
            ? null
            : () async {
                await _api.postJson('/api/pricing/party-item', partyItemBody(id, existing.itemId, existing.variantId, const RateFields()));
              },
        removeTitle: 'Remove price?',
        removeText: 'Remove the price and discount for ${named ? title : 'this item'} for $who? They will pay the item price (or their price level).',
      ),
    ));
    if (saved == true && mounted) {
      showKToast(context, 'Saved', tone: KTone.positive);
      await _loadParty();
    }
  }

  Future<void> _editCategory(Map<String, dynamic> category) async {
    final id = _partyId;
    final catId = docText(category['id']);
    if (id == null || catId.isEmpty) return;
    final name = docText(category['name']);
    final existing = _cats.discounts[catId];
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => RateFormPage(
        session: widget.session,
        title: 'Category discount',
        subject: name,
        showPrice: false,
        initial: existing?.draft ?? const RateDraft(),
        onSave: (v) async {
          await _api.postJson('/api/pricing/party-category', partyCategoryBody(id, catId, v.rate));
        },
        onRemove: existing == null
            ? null
            : () async {
                await _api.postJson('/api/pricing/party-category', partyCategoryBody(id, catId, const RateFields()));
              },
        removeLabel: 'Remove discount',
        removeTitle: 'Remove discount?',
        removeText: 'Remove the discount on every item in $name for ${_partyName ?? 'this customer'}?',
      ),
    ));
    if (saved == true && mounted) {
      showKToast(context, 'Category discount saved', tone: KTone.positive);
      await _loadParty();
    }
  }

  void _openPriceList() {
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => PriceListScreen(session: widget.session, customerId: _partyId, customerName: _partyName),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Party pricing'),
            Expanded(
              child: RefreshIndicator(
                color: AppColors.brand,
                onRefresh: () => Future.wait([_loadLookups(), if (_partyId != null) _loadParty()]),
                child: ListView(
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
                  children: [
                    Text(
                      'A price or a discount for one customer, with optional dates. A price on an item covers its variants unless a variant has its own.',
                      style: AppText.caption,
                    ),
                    const SizedBox(height: AppSpace.md),
                    KAsyncPickField(
                      label: 'Customer',
                      valueLabel: _partyName,
                      search: (q) => searchCustomers(_api, q),
                      onPicked: _pickCustomer,
                    ),
                    ..._content(),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _content() {
    if (_partyId == null) {
      return const [
        KEmptyState(icon: LucideIcons.badgeIndianRupee, title: 'Choose a customer', body: 'Choose a customer to load items and any saved custom prices.'),
      ];
    }
    if (_loading) return const [KSpinner(padding: EdgeInsets.symmetric(vertical: 48))];
    if (_error != null) {
      return [PricingFailure(title: 'Could not load prices', message: _error!, notInPlan: _notInPlan, onRetry: _loadParty)];
    }
    return [
      const SizedBox(height: AppSpace.md),
      KPickField<String>(
        label: 'Price level',
        value: _levelId,
        options: [
          ('', 'None (item prices)'),
          for (final l in _levels) (l.id, l.isActive ? l.name : '${l.name} (inactive)'),
        ],
        onChanged: _changeLevel,
      ),
      Padding(
        padding: const EdgeInsets.only(top: 6, left: 2),
        child: Text('Used when this customer has no price of their own.', style: AppText.caption),
      ),
      Align(
        alignment: Alignment.centerLeft,
        child: KTextButton(
          label: 'Manage levels',
          onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => PriceLevelsScreen(session: widget.session))),
        ),
      ),
      const SizedBox(height: AppSpace.sm),
      KSegmented<_Tab>(
        value: _tab,
        options: const [(_Tab.items, 'Item prices'), (_Tab.categories, 'Category discounts'), (_Tab.history, 'History')],
        onChanged: (t) => setState(() => _tab = t),
      ),
      const SizedBox(height: AppSpace.md),
      ...switch (_tab) {
        _Tab.items => _itemsTab(),
        _Tab.categories => _categoriesTab(),
        _Tab.history => _historyTab(),
      },
    ];
  }

  List<Widget> _itemsTab() {
    return [
      KButton(label: 'Add a price', icon: LucideIcons.plus, onPressed: () => _editPrice(null)),
      const SizedBox(height: AppSpace.sm),
      KButton.secondary(label: 'Price list', onPressed: _openPriceList),
      const SizedBox(height: AppSpace.md),
      if (_prices.rates.isEmpty)
        const KEmptyState(icon: LucideIcons.tag, title: 'No customer prices yet', body: 'Add a price to give this customer a different rate for an item.')
      else
        KCard(
          child: KDivided(indent: 0, children: [
            for (final r in _prices.rates)
              KListRow(
                title: _titleOf(r),
                subtitle: [itemPriceLine(_items[r.itemId]), dateRange(r.validFrom, r.validTo)].where((s) => s.isNotEmpty).join(' · '),
                trailing: Text(rateText(r.price, r.discountPercent), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
                onTap: () => _editPrice(r),
              ),
          ]),
        ),
    ];
  }

  List<Widget> _categoriesTab() {
    return [
      Text('A discount on every item in a category. An item\'s own discount for this customer wins.', style: AppText.caption),
      const SizedBox(height: AppSpace.md),
      if (_cats.categories.isEmpty)
        const KEmptyState(icon: LucideIcons.tag, title: 'No item categories yet', body: 'Add categories to your items first.')
      else
        KCard(
          child: KDivided(indent: 0, children: [
            for (final c in _cats.categories)
              () {
                final d = _cats.discounts[docText(c['id'])];
                return KListRow(
                  title: docText(c['name']),
                  subtitle: d == null ? null : dateRange(d.validFrom, d.validTo),
                  trailing: Text(
                    d == null ? 'None' : rateText(null, d.discountPercent),
                    style: AppText.bodyStrong.copyWith(color: d == null ? AppColors.ink3 : AppColors.ink),
                  ),
                  onTap: () => _editCategory(c),
                );
              }(),
          ]),
        ),
    ];
  }

  List<Widget> _historyTab() {
    if (_history.isEmpty) {
      return const [KEmptyState(icon: LucideIcons.history, title: 'No price changes for this customer yet')];
    }
    return [
      KCard(
        child: KDivided(indent: 0, children: [
          for (final h in _history)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(h.what, style: AppText.bodyStrong),
                Text('Was ${h.was}', style: AppText.caption),
                Text('Now ${h.now}${h.range.isEmpty ? '' : ' · ${h.range}'}', style: AppText.caption.copyWith(color: AppColors.ink)),
                Text([h.when, if (h.by.isNotEmpty) 'by ${h.by}'].where((s) => s.isNotEmpty).join(' · '), style: AppText.caption),
              ]),
            ),
        ]),
      ),
    ];
  }
}
