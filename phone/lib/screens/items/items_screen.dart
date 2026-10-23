import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../shell/shell_banners.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../ui/sheet_messenger.dart';
import '../../ui/web_ui.dart';
import 'adjust_stock_sheet.dart';
import 'item_csv.dart';
import 'item_detail_screen.dart';

const _pageSize = 50;

/// The list filters from `app/(app)/items/page.tsx`.
class ItemFilters {
  const ItemFilters({
    this.search = '',
    this.stock = 'all',
    this.type = 'all',
    this.category = 'all',
    this.store = 'all',
    this.featured = 'all',
  });

  final String search;

  /// all | low | out
  final String stock;

  /// all | goods | service
  final String type;
  final String category;

  /// all | in | out
  final String store;

  /// all | featured
  final String featured;

  ItemFilters copyWith({String? search, String? stock, String? type, String? category, String? store, String? featured}) =>
      ItemFilters(
        search: search ?? this.search,
        stock: stock ?? this.stock,
        type: type ?? this.type,
        category: category ?? this.category,
        store: store ?? this.store,
        featured: featured ?? this.featured,
      );
}

/// `filteredItems` in `app/(app)/items/page.tsx`.
List<Map<String, dynamic>> filterItems(List<Map<String, dynamic>> all, ItemFilters f) {
  var list = all.where((i) => i['is_active'] != false);
  final q = f.search.trim().toLowerCase();
  if (q.isNotEmpty) {
    list = list.where((i) =>
        (i['name']?.toString().toLowerCase().contains(q) ?? false) ||
        (i['code']?.toString().toLowerCase().contains(q) ?? false));
  }
  if (f.type != 'all') list = list.where((i) => i['item_type'] == f.type);
  if (f.category != 'all') list = list.where((i) => i['category_id'] == f.category);
  if (f.store == 'in') list = list.where((i) => _truthy(i['show_in_store']));
  if (f.store == 'out') list = list.where((i) => !_truthy(i['show_in_store']));
  if (f.featured == 'featured') list = list.where((i) => _truthy(i['featured_in_store']));
  return list.where((i) {
    if (f.stock == 'all') return true;
    if (i['item_type'] == 'service') return false;
    if (f.stock == 'out') return toNum(i['current_stock']) <= 0;
    if (f.stock == 'low') return toNum(i['current_stock']) <= toNum(i['min_stock'] ?? 0);
    return true;
  }).toList();
}

bool _truthy(dynamic v) => v != null && v != false && v != 0 && v != '';

/// `<img src={item.image_url}>`: data URIs or URLs on the Khatario host.
ImageProvider? itemImage(dynamic url) {
  final s = url?.toString() ?? '';
  if (s.isEmpty) return null;
  if (s.startsWith('data:')) {
    final data = Uri.tryParse(s)?.data;
    return data == null ? null : MemoryImage(data.contentAsBytes());
  }
  return NetworkImage(Uri.parse(apiBaseUrl).resolve(s).toString());
}

/// `app/(app)/items/page.tsx` at the phone breakpoint. The header search toggle lives in the shell.
class ItemsScreen extends StatefulWidget {
  const ItemsScreen({
    super.key,
    required this.session,
    required this.banners,
    required this.searchOpen,
    required this.onOpen,
    required this.onStockChanged,
  });

  final AppSession session;
  final ShellBannersController banners;
  final bool searchOpen;
  final ValueChanged<String> onOpen;

  /// `inventory-updated`: refresh the low-stock badge.
  final VoidCallback onStockChanged;

  @override
  State<ItemsScreen> createState() => _ItemsScreenState();
}

class _ItemsScreenState extends State<ItemsScreen> {
  final _search = TextEditingController();
  final _searchFocus = FocusNode();
  ItemFilters _filters = const ItemFilters();
  int _page = 1;
  List<Map<String, dynamic>> _all = const [];
  List<(String, String)> _categories = const [];
  bool _loading = true;
  String? _flagBusyId;
  int _request = 0;

  KhatarioApi get _api => widget.session.api;

  @override
  void initState() {
    super.initState();
    _load();
    _loadCategories();
  }

  @override
  void didUpdateWidget(ItemsScreen old) {
    super.didUpdateWidget(old);
    if (widget.searchOpen && !old.searchOpen) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _searchFocus.requestFocus();
      });
    }
  }

  @override
  void dispose() {
    _search.dispose();
    _searchFocus.dispose();
    super.dispose();
  }

  Future<void> _load({bool showSpinner = true}) async {
    final request = ++_request;
    if (showSpinner) setState(() => _loading = true);
    final query = <String, String>{};
    final branch = widget.session.defaultBranchId;
    if (branch != null) query['branch_id'] = branch;
    try {
      final body = await _api.getJson(Uri(path: '/api/items', queryParameters: query.isEmpty ? null : query).toString());
      final list = body['items'];
      if (request != _request || !mounted) return;
      setState(() {
        _all = list is List ? list.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [];
      });
    } catch (_) {
      if (request != _request || !mounted) return;
      setState(() => _all = const []);
    } finally {
      if (request == _request && mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadCategories() async {
    try {
      final body = await _api.getJson('/api/categories');
      final list = body['categories'];
      if (!mounted || list is! List) return;
      setState(() {
        _categories = [
          for (final c in list.whereType<Map>()) (c['id'].toString(), c['name']?.toString() ?? ''),
        ];
      });
    } catch (_) {}
  }

  void _setFilters(ItemFilters next) => setState(() {
        _filters = next;
        _page = 1;
      });

  /// `toggleLowStock`.
  void _toggleLowStock() => _setFilters(_filters.copyWith(
        stock: _filters.stock == 'low' ? 'all' : 'low',
        type: _filters.type == 'service' ? 'goods' : null,
      ));

  void _toast(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  /// `patchStoreFlags`: flags-only PATCH; identity comes from the session cookie.
  Future<void> _patchFlags(Map<String, dynamic> item, Map<String, dynamic> next) async {
    final id = item['id'].toString();
    setState(() => _flagBusyId = id);
    try {
      await _api.patchJson('/api/items/$id', next);
      await _load(showSpinner: false);
    } on ApiException catch (e) {
      if (mounted) _toast(e.message.isEmpty ? 'Could not update item' : e.message);
    } catch (_) {
      if (mounted) _toast('Could not update item');
    } finally {
      if (mounted) setState(() => _flagBusyId = null);
    }
  }

  /// `handleAdjustStock`: variants and bundles go to the full adjustment form on the website.
  Future<void> _adjustStock(Map<String, dynamic> item) async {
    if (_truthy(item['has_variants']) || _truthy(item['is_bundle'])) {
      widget.onOpen('New inventory adjustment');
      return;
    }
    final saved = await showAdjustItemStockSheet(context, session: widget.session, item: item);
    if (!saved || !mounted) return;
    _toast('Stock updated');
    widget.onStockChanged();
    _load(showSpinner: false);
  }

  Future<void> _openDetail(Map<String, dynamic> item) async {
    final deleted = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => ItemDetailScreen(
        session: widget.session,
        itemId: item['id'].toString(),
        onOpen: widget.onOpen,
      ),
    ));
    if (deleted == true && mounted) _load(showSpinner: false);
  }

  void _openFilters() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      enableDrag: false,
      barrierColor: const Color(0x66000000),
      backgroundColor: Colors.transparent,
      elevation: 0,
      builder: (_) => SheetMessenger(
        child: ItemFilterSheet(
          api: _api,
          filters: _filters,
          categories: _categories,
          onChanged: _setFilters,
          onImported: () {
            _search.clear();
            _setFilters(_filters.copyWith(search: ''));
            _load();
          },
        ),
      ),
    );
  }

  /// Store and featured switches, off the row so the list stays calm.
  void _rowActions(Map<String, dynamic> item) {
    showKSheet<void>(
      context,
      title: item['name']?.toString() ?? 'Item',
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) {
          final current = _all.firstWhere((i) => i['id'] == item['id'], orElse: () => item);
          final busy = _flagBusyId == current['id'].toString();
          Future<void> flip(Map<String, dynamic> next) async {
            await _patchFlags(current, next);
            setSheet(() {});
          }

          return Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              KSheetAction(
                icon: LucideIcons.packageOpen,
                label: 'Open item',
                onTap: () {
                  Navigator.of(ctx).pop();
                  _openDetail(current);
                },
              ),
              if (current['item_type'] != 'service')
                KSheetAction(
                  icon: LucideIcons.arrowUpDown,
                  label: 'Adjust stock',
                  onTap: () {
                    Navigator.of(ctx).pop();
                    _adjustStock(current);
                  },
                ),
              const Padding(padding: EdgeInsets.symmetric(horizontal: 20), child: Divider(color: AppColors.hairline)),
              _FlagRow(
                icon: LucideIcons.store,
                title: 'Show in online store',
                child: ItemFlagSwitch(
                  on: _truthy(current['show_in_store']),
                  label: 'Show in online store',
                  disabled: busy,
                  onToggle: () => flip({'show_in_store': !_truthy(current['show_in_store'])}),
                ),
              ),
              _FlagRow(
                icon: LucideIcons.star,
                title: 'Featured in store',
                child: ItemFlagSwitch(
                  on: _truthy(current['featured_in_store']),
                  label: 'Featured in online store',
                  disabled: busy,
                  onToggle: () => flip({'featured_in_store': !_truthy(current['featured_in_store'])}),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filtered = filterItems(_all, _filters);
    final shown = filtered.take(_page * _pageSize).toList();
    final goods = _all.where((i) => i['is_active'] != false && i['item_type'] != 'service');
    final lowCount = goods.where((i) => toNum(i['current_stock']) <= toNum(i['min_stock'] ?? 0)).length;
    final outCount = goods.where((i) => toNum(i['current_stock']) <= 0).length;
    final categoryLabel = _categories.where((c) => c.$1 == _filters.category).map((c) => c.$2).firstOrNull;

    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: () => _load(showSpinner: false),
      child: ListView(
        padding: const EdgeInsets.only(bottom: 112),
        children: [
          ShellBanners(controller: widget.banners, placement: BannerPlacement.compact, onOpen: widget.onOpen),
          KPageTitle(
            'Items',
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                _HeaderTool(icon: LucideIcons.scanLine, label: 'Scan & Add Items', onTap: () => widget.onOpen('Scan & add items')),
                const SizedBox(width: 8),
                _HeaderTool(icon: LucideIcons.printer, label: 'Print Barcodes', onTap: () => widget.onOpen('Print barcodes')),
                const SizedBox(width: 8),
                _HeaderTool(icon: LucideIcons.tag, label: 'Manage Categories', onTap: () => widget.onOpen('Manage categories')),
              ],
            ),
          ),
          if (!_loading)
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 2, AppSpace.gutter, 0),
              child: Text('${filtered.length} of ${_all.where((i) => i['is_active'] != false).length} items', style: AppText.label),
            ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
            child: InlineUsageBanner(session: widget.session, limitType: 'items', onViewPlans: () => widget.onOpen('Subscription')),
          ),
          if (widget.searchOpen)
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 0),
              child: ValueListenableBuilder<TextEditingValue>(
                valueListenable: _search,
                builder: (context, value, _) => _FocusedSearch(
                  controller: _search,
                  focusNode: _searchFocus,
                  onChanged: (v) => _setFilters(_filters.copyWith(search: v)),
                  onClear: value.text.isEmpty
                      ? null
                      : () {
                          _search.clear();
                          _setFilters(_filters.copyWith(search: ''));
                        },
                ),
              ),
            ),
          const SizedBox(height: AppSpace.md),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
            child: Row(
              children: [
                KChip(label: 'Filter By', icon: LucideIcons.slidersHorizontal, selected: false, onTap: _openFilters),
                const SizedBox(width: 8),
                KChip(
                  label: 'Low Stock${lowCount > 0 ? '  $lowCount' : ''}',
                  icon: LucideIcons.triangleAlert,
                  selected: _filters.stock == 'low',
                  onTap: _toggleLowStock,
                ),
                const SizedBox(width: 8),
                KChip(
                  label: 'Out of stock${outCount > 0 ? '  $outCount' : ''}',
                  selected: _filters.stock == 'out',
                  onTap: () => _setFilters(_filters.copyWith(
                    stock: _filters.stock == 'out' ? 'all' : 'out',
                    type: _filters.type == 'service' ? 'goods' : null,
                  )),
                ),
                const SizedBox(width: 8),
                KChip(
                  label: categoryLabel ?? 'Category',
                  icon: LucideIcons.chevronDown,
                  selected: categoryLabel != null,
                  onTap: () => showKPicker<String>(
                    context,
                    title: 'Category',
                    value: _filters.category,
                    options: [('all', 'All categories'), ..._categories],
                    onChanged: (v) => _setFilters(_filters.copyWith(category: v)),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpace.lg),
          if (_loading)
            const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
          else if (shown.isEmpty)
            KEmptyState(
              icon: LucideIcons.packageSearch,
              title: 'No items found.',
              body: _filters.search.isNotEmpty ? 'Try another name or code.' : 'Change the filters or add an item.',
            )
          else ...[
            KCard(
              margin: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
              child: KDivided(
                indent: 70,
                children: [
                  for (final item in shown)
                    ItemListRow(
                      item: item,
                      onOpen: () => _openDetail(item),
                      onAdjustStock: () => _adjustStock(item),
                      onLongPress: () => _rowActions(item),
                    ),
                ],
              ),
            ),
            if (shown.length < filtered.length)
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.lg, AppSpace.gutter, 0),
                child: KButton.secondary(
                  label: 'Show more (${filtered.length - shown.length} left)',
                  onPressed: () => setState(() => _page++),
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.md, AppSpace.gutter, 0),
              child: Text('Long-press an item for store settings.', textAlign: TextAlign.center, style: AppText.caption.copyWith(fontSize: 12)),
            ),
          ],
        ],
      ),
    );
  }
}

class _HeaderTool extends StatelessWidget {
  const _HeaderTool({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: label,
      child: Semantics(
        button: true,
        label: label,
        excludeSemantics: true,
        child: Material(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.sm),
          elevation: 0,
          child: InkWell(
            borderRadius: BorderRadius.circular(AppRadius.sm),
            onTap: onTap,
            child: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(AppRadius.sm), boxShadow: AppShadow.card),
              child: Icon(icon, size: 18, color: AppColors.ink),
            ),
          ),
        ),
      ),
    );
  }
}

/// Search box opened from the header toggle.
class _FocusedSearch extends StatelessWidget {
  const _FocusedSearch({required this.controller, required this.focusNode, required this.onChanged, this.onClear});

  final TextEditingController controller;
  final FocusNode focusNode;
  final ValueChanged<String> onChanged;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 48,
      padding: const EdgeInsets.only(left: 14, right: 2),
      decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(AppRadius.md), boxShadow: AppShadow.card),
      child: Row(
        children: [
          const Icon(LucideIcons.search, size: 18, color: AppColors.ink3),
          const SizedBox(width: 10),
          Expanded(
            child: TextField(
              controller: controller,
              focusNode: focusNode,
              onChanged: onChanged,
              textInputAction: TextInputAction.search,
              style: AppText.body,
              cursorColor: AppColors.brand,
              decoration: InputDecoration(
                hintText: 'Name, code, or HSN',
                hintStyle: AppText.body.copyWith(color: AppColors.ink3),
                filled: false,
                isDense: true,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
          if (onClear != null) KIconButton(icon: LucideIcons.x, tooltip: 'Clear search', color: AppColors.ink3, onTap: onClear!),
        ],
      ),
    );
  }
}

class _FlagRow extends StatelessWidget {
  const _FlagRow({required this.icon, required this.title, required this.child});

  final IconData icon;
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(color: AppColors.sunken, borderRadius: BorderRadius.circular(AppRadius.sm)),
            child: Icon(icon, size: 18, color: AppColors.ink),
          ),
          const SizedBox(width: 14),
          Expanded(child: Text(title, style: AppText.bodyStrong.copyWith(fontWeight: FontWeight.w500))),
          child,
        ],
      ),
    );
  }
}

/// `components/items/ItemFlagSwitch.tsx`.
class ItemFlagSwitch extends StatelessWidget {
  const ItemFlagSwitch({super.key, required this.on, required this.label, required this.onToggle, this.disabled = false});

  final bool on;
  final String label;
  final VoidCallback onToggle;
  final bool disabled;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      toggled: on,
      label: label,
      enabled: !disabled,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: disabled ? null : onToggle,
        child: Opacity(
          opacity: disabled ? 0.5 : 1,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 160),
            width: 44,
            height: 26,
            padding: const EdgeInsets.all(3),
            decoration: BoxDecoration(
              color: on ? AppColors.positive : AppColors.hairline,
              borderRadius: BorderRadius.circular(999),
            ),
            alignment: on ? Alignment.centerRight : Alignment.centerLeft,
            child: Container(
              width: 20,
              height: 20,
              decoration: const BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
                boxShadow: [BoxShadow(color: Color(0x2613221E), blurRadius: 3, offset: Offset(0, 1))],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// `components/items/ItemMobileCard.tsx`: thumbnail, name and tags, price and stock, adjust-stock button.
class ItemListRow extends StatelessWidget {
  const ItemListRow({
    super.key,
    required this.item,
    required this.onOpen,
    required this.onAdjustStock,
    this.onLongPress,
  });

  final Map<String, dynamic> item;
  final VoidCallback onOpen;
  final VoidCallback onAdjustStock;
  final VoidCallback? onLongPress;

  static String formatMoney(dynamic value) {
    if (value == null) return '—';
    return '$rupeeSign${enIn(toNum(value), maxFraction: 2)}';
  }

  static String formatStock(num stock, String? unit) {
    final formatted = stock == stock.truncate() ? jsNumberString(stock) : enIn(stock, maxFraction: 3);
    return '$formatted ${unit == null || unit.isEmpty ? 'PCS' : unit}';
  }

  @override
  Widget build(BuildContext context) {
    final name = item['name']?.toString() ?? '';
    final stock = toNum(item['current_stock']);
    final minStock = toNum(item['min_stock']);
    final isService = item['item_type'] == 'service';
    final code = item['code']?.toString() ?? '';
    final tags = [
      if (_truthy(item['is_bundle'])) 'Bundle',
      if (_truthy(item['has_variants'])) 'Variants',
      if (code.isNotEmpty) code,
      if (isService) 'Service',
      if (_truthy(item['show_in_store'])) 'In store',
      if (_truthy(item['featured_in_store'])) '★ Featured',
    ].join(' · ');
    final tone = isService
        ? KTone.neutral
        : stock <= 0
            ? KTone.negative
            : stock <= minStock
                ? KTone.due
                : KTone.positive;
    final image = itemImage(item['image_url']);
    final trimmed = name.trim();
    final leading = Container(
      width: 44,
      height: 44,
      clipBehavior: Clip.antiAlias,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: AppColors.sunken, borderRadius: BorderRadius.circular(12)),
      child: image != null
          ? Image(image: image, width: 44, height: 44, fit: BoxFit.cover, errorBuilder: (_, _, _) => const SizedBox.shrink())
          : isService
              ? Icon(LucideIcons.tag, size: 18, color: AppColors.ink2)
              : Text(trimmed.isEmpty ? '?' : trimmed[0].toUpperCase(), style: AppText.bodyStrong.copyWith(color: AppColors.ink2)),
    );

    return InkWell(
      onTap: onOpen,
      onLongPress: onLongPress,
      highlightColor: AppColors.sunken,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 4, 12),
        child: Row(
          children: [
            leading,
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.bodyStrong),
                  if (tags.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(tags, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.caption.copyWith(fontSize: 12)),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(formatMoney(item['selling_price']), style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular)),
                if (!isService) ...[
                  const SizedBox(height: 3),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                    decoration: BoxDecoration(color: tone.bg, borderRadius: BorderRadius.circular(999)),
                    child: Text(
                      formatStock(stock, item['unit']?.toString()),
                      style: AppText.small.copyWith(fontSize: 11, color: tone.fg, fontFeatures: AppText.tabular),
                    ),
                  ),
                ],
              ],
            ),
            if (!isService)
              KIconButton(icon: LucideIcons.arrowUpDown, tooltip: 'Adjust stock for $name', color: AppColors.ink2, onTap: onAdjustStock)
            else
              const SizedBox(width: 12),
          ],
        ),
      ),
    );
  }
}

/// The mobile "Filters" bottom sheet in `app/(app)/items/page.tsx`. Changes apply as they are tapped.
class ItemFilterSheet extends StatefulWidget {
  const ItemFilterSheet({
    super.key,
    required this.api,
    required this.filters,
    required this.categories,
    required this.onChanged,
    required this.onImported,
  });

  final KhatarioApi api;
  final ItemFilters filters;
  final List<(String, String)> categories;
  final ValueChanged<ItemFilters> onChanged;
  final VoidCallback onImported;

  @override
  State<ItemFilterSheet> createState() => _ItemFilterSheetState();
}

class _ItemFilterSheetState extends State<ItemFilterSheet> {
  late ItemFilters _f = widget.filters;
  bool _importing = false;

  void _set(ItemFilters next) {
    setState(() => _f = next);
    widget.onChanged(next);
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _template() async {
    try {
      await shareItemImportTemplate(widget.api);
    } catch (_) {
      if (mounted) _toast('Could not download the template');
    }
  }

  Future<void> _import() async {
    setState(() => _importing = true);
    try {
      final message = await importItemsCsv(widget.api);
      if (message == null || !mounted) return;
      _toast(message);
      setState(() => _f = _f.copyWith(search: ''));
      widget.onImported();
    } on FormatException catch (e) {
      if (mounted) _toast(e.message);
    } on ApiException catch (e) {
      if (mounted) _toast(e.message.isEmpty ? 'Import failed' : e.message);
    } catch (_) {
      if (mounted) _toast('Import failed');
    } finally {
      if (mounted) setState(() => _importing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.8),
      child: Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
        ),
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(20, 16, 20, 20 + MediaQuery.of(context).padding.bottom),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(child: Text('Filters', style: AppText.heading)),
                  KIconButton(icon: LucideIcons.x, tooltip: 'Close', onTap: () => Navigator.of(context).pop()),
                ],
              ),
              const SizedBox(height: 12),
              const _SheetLabel('Category'),
              WebFieldSelect<String>(
                value: _f.category,
                options: [('all', 'All Categories'), ...widget.categories],
                onChanged: (v) => _set(_f.copyWith(category: v)),
              ),
              const SizedBox(height: 24),
              const _SheetLabel('Online store'),
              WebFieldSelect<String>(
                value: _f.store,
                options: const [('all', 'All store'), ('in', 'In store'), ('out', 'Not in store')],
                onChanged: (v) => _set(_f.copyWith(store: v)),
              ),
              const SizedBox(height: 24),
              const _SheetLabel('Featured'),
              WebFieldSelect<String>(
                value: _f.featured,
                options: const [('all', 'All items'), ('featured', 'Featured only')],
                onChanged: (v) => _set(_f.copyWith(featured: v)),
              ),
              const SizedBox(height: 24),
              const _SheetLabel('Item Type'),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final (id, label) in const [('all', 'All Types'), ('goods', 'Goods Only'), ('service', 'Services Only')])
                    KChip(
                      label: label,
                      selected: _f.type == id,
                      onTap: () => _set(_f.copyWith(type: id, stock: id == 'service' ? 'all' : null)),
                    ),
                ],
              ),
              if (_f.type != 'service') ...[
                const SizedBox(height: 24),
                const _SheetLabel('Stock Level'),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final (id, label) in const [('all', 'All Levels'), ('low', 'Low Stock'), ('out', 'Out of Stock')])
                      KChip(label: label, selected: _f.stock == id, onTap: () => _set(_f.copyWith(stock: id))),
                  ],
                ),
              ],
              const SizedBox(height: 24),
              const _SheetLabel('Import items'),
              Row(
                children: [
                  Expanded(child: KButton.secondary(label: 'Template', icon: LucideIcons.fileDown, onPressed: _template)),
                  const SizedBox(width: 12),
                  Expanded(child: KButton.secondary(label: 'Import', icon: LucideIcons.fileUp, loading: _importing, onPressed: _import)),
                ],
              ),
              const SizedBox(height: 24),
              KButton(label: 'Apply Filters', onPressed: () => Navigator.of(context).pop()),
            ],
          ),
        ),
      ),
    );
  }
}

class _SheetLabel extends StatelessWidget {
  const _SheetLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(text, style: AppText.label),
    );
  }
}
