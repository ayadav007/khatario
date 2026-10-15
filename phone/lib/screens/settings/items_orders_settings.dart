import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../ui/kit.dart';
import 'settings_kit.dart';
import 'settings_router.dart';

/// Settings › Items & stock: stock rules, units and categories, labels and printers.
class ItemsSettingsScreen extends StatefulWidget {
  const ItemsSettingsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ItemsSettingsScreen> createState() => _ItemsSettingsScreenState();
}

class _ItemsSettingsScreenState extends State<ItemsSettingsScreen> {
  final _f = DirtyFields();
  bool _oos = false;
  bool _wh = false;
  bool _whBranch = true;
  bool _loading = true;
  bool _saving = false;
  String? _error;

  KhatarioApi get _api => widget.session.api;

  @override
  void initState() {
    super.initState();
    _f.field('low').addListener(() => setState(() {}));
    _load();
  }

  @override
  void dispose() {
    _f.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await Future.wait([
        _api.getJson('/api/settings/item-sales-stock'),
        _api.getJson('/api/settings/warehouses').catchError((_) => <String, dynamic>{}),
        _api.getJson('/api/settings/invoice-defaults').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      final low = jsonMap(r[2]['defaults'])['lowStockAlert'];
      _f.reset({'low': low == null ? '' : enIn(toNum(low))});
      setState(() {
        _oos = r[0]['default_allow_sale_when_out_of_stock'] == true;
        _wh = r[1]['warehouses_enabled'] == true;
        _whBranch = r[1]['auto_assign_branch_warehouses'] != false;
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    }
  }

  Future<void> _saveLow() async {
    setState(() => _saving = true);
    try {
      final v = _f.text('low');
      await _api.putJson('/api/settings/invoice-defaults', {'defaults': {'lowStockAlert': v.isEmpty ? null : toNum(v.replaceAll(',', ''))}});
      _f.reset({'low': v});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Low-stock level saved')));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _toggle(bool v, void Function(bool) set, String path, String key, String on, String off) {
    setState(() => set(v));
    saveInstantly(
      context,
      message: v ? on : off,
      save: () => _api.patchJson(path, {key: v}),
      revert: () => setState(() => set(!v)),
      undo: () => _api.patchJson(path, {key: !v}),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SettingsPage(
      title: 'Items & stock',
      blurb: 'Stock rules, units, labels and printers.',
      icon: LucideIcons.package,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      dirtyCount: _f.count,
      saving: _saving,
      onSave: _saveLow,
      onDiscard: () => setState(_f.discard),
      children: [
        SettingsSection(title: 'Stock rules', why: 'Apply to the bill screen, the online store and WhatsApp orders.', children: [
          ToggleSetting(
            label: 'Allow sales when out of stock',
            help: 'Default for new items. Each item can override it.',
            value: _oos,
            onChanged: (v) => _toggle(v, (x) => _oos = x, '/api/settings/item-sales-stock', 'default_allow_sale_when_out_of_stock',
                'Sales allowed when out of stock', 'Sales blocked when out of stock'),
          ),
          TextSetting(
            label: 'Low-stock alert at',
            help: 'Filled in on new items, in their own unit. Leave empty for none.',
            controller: _f.field('low'),
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            short: true,
          ),
          ToggleSetting(
            label: 'Track stock by warehouse',
            help: 'Separate stock for each godown or shop floor.',
            value: _wh,
            onChanged: (v) => _toggle(v, (x) => _wh = x, '/api/settings/warehouses', 'warehouses_enabled', 'Warehouses on', 'Warehouses off'),
          ),
          if (_wh)
            ToggleSetting(
              label: 'Branch staff use their branch’s warehouse',
              help: 'When off, give each user warehouse access yourself.',
              value: _whBranch,
              onChanged: (v) => _toggle(v, (x) => _whBranch = x, '/api/settings/warehouses', 'auto_assign_branch_warehouses', 'Branch warehouses assigned automatically', 'Assign warehouses per user'),
            ),
        ]),
        SettingsSection(title: 'Units & categories', why: 'Master lists used on every item.', children: [
          NavSetting(label: 'Categories', value: 'Group items for reports and the store', onTap: () => openPhoneSetting(context, widget.session, '/items/categories')),
        ]),
        SettingsSection(title: 'Labels & printers', why: 'Barcode labels and receipt printing.', children: [
          NavSetting(label: 'Label templates', value: 'Sizes and fields on barcode labels', onTap: () => openPhoneSetting(context, widget.session, '/settings/label-templates')),
          NavSetting(label: 'Printers & devices', value: 'Pair a Bluetooth receipt or label printer', onTap: () => openPhoneSetting(context, widget.session, '/settings/bluetooth-printer')),
        ]),
      ],
    );
  }
}

/// Settings › Orders & delivery: store checkout rules, delivery partner, returns, buyer WhatsApp
/// updates and dispatch rules, in one place.
class OrdersSettingsScreen extends StatefulWidget {
  const OrdersSettingsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<OrdersSettingsScreen> createState() => _OrdersSettingsScreenState();
}

class _OrdersSettingsScreenState extends State<OrdersSettingsScreen> {
  static const _notify = [
    ('confirmed', 'Order confirmed', 'Order number and tracking link'),
    ('packed', 'Packed', 'Packed and leaving soon'),
    ('ready_for_pickup', 'Ready for pickup', 'Pickup code and shop address'),
    ('shipped', 'Shipped', 'Courier and tracking link'),
    ('out_for_delivery', 'Out for delivery', 'Rider name and phone'),
    ('delivered', 'Delivered', 'Bill link'),
    ('delivery_failed', 'Delivery failed', 'Reason and next attempt'),
    ('cancelled', 'Cancelled', 'Refund amount and timeline'),
  ];

  final _f = DirtyFields();
  Map<String, dynamic>? _store; // null = online store not on the plan
  Map<String, dynamic> _s = const {};
  bool _loading = true;
  bool _saving = false;
  String? _error;

  KhatarioApi get _api => widget.session.api;

  @override
  void initState() {
    super.initState();
    for (final k in ['minorder', 'retdays', 'delay']) {
      _f.field(k).addListener(() => setState(() {}));
    }
    _load();
  }

  @override
  void dispose() {
    _f.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await Future.wait([
        _api.getJson('/api/orders/settings'),
        _api.getJson('/api/settings/online-store').then<Map<String, dynamic>?>((v) => v).catchError((_) => null),
      ]);
      if (!mounted) return;
      final s = jsonMap(r[0]!['settings']);
      final store = r[1];
      _f.reset({
        'minorder': store == null ? '' : enIn(toNum(store['store_min_order_amount'])),
        'retdays': store == null ? '' : '${toNum(store['store_return_window_days'] ?? 7).toInt()}',
        'delay': '${toNum(s['stuckNoticeDays'] ?? 3).toInt()}',
      });
      setState(() {
        _s = s;
        _store = store;
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    }
  }

  Future<void> _putSettings(Map<String, dynamic> s) => _api.putJson('/api/orders/settings', {'settings': s});

  void _setSetting(Map<String, dynamic> change, String message) {
    final before = _s;
    final next = {..._s, ...change};
    setState(() => _s = next);
    saveInstantly(context, message: message, save: () => _putSettings(next), revert: () => setState(() => _s = before), undo: () => _putSettings(before));
  }

  void _setStore(String key, dynamic value, String message) {
    final before = _store?[key];
    setState(() => _store = {...?_store, key: value});
    saveInstantly(
      context,
      message: message,
      save: () => _api.patchJson('/api/settings/online-store', {key: value}),
      revert: () => setState(() => _store = {...?_store, key: before}),
      undo: () => _api.patchJson('/api/settings/online-store', {key: before}),
    );
  }

  Future<void> _saveText() async {
    final changed = _f.changed;
    setState(() => _saving = true);
    try {
      final storePatch = <String, dynamic>{
        if (changed.containsKey('minorder')) 'store_min_order_amount': toNum(changed['minorder']!.replaceAll(',', '')),
        if (changed.containsKey('retdays')) 'store_return_window_days': toNum(changed['retdays']).toInt(),
      };
      if (storePatch.isNotEmpty) await _api.patchJson('/api/settings/online-store', storePatch);
      if (changed.containsKey('delay')) {
        final next = {..._s, 'stuckNoticeDays': toNum(changed['delay']).toInt()};
        await _putSettings(next);
        _s = next;
      }
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Saved')));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final notify = jsonMap(_s['notify']);
    final store = _store;
    final sub = store?['store_subdomain']?.toString();
    return SettingsPage(
      title: 'Orders & delivery',
      blurb: 'Store checkout, delivery partner, returns and buyer updates. Everything about getting an order to the buyer.',
      icon: LucideIcons.truck,
      loading: _loading,
      error: _error,
      onRefresh: _load,
      dirtyCount: _f.count,
      saving: _saving,
      onSave: _saveText,
      onDiscard: () => setState(_f.discard),
      children: [
        if (store == null)
          SettingsSection(title: 'Online store', why: 'Sell from your own store website.', children: [
            LockedSetting(
              label: 'Online store',
              help: 'Your own store website with checkout, delivery and returns.',
              plan: 'Growth plan',
              onPlans: () => openPhoneSetting(context, widget.session, '/settings/subscription'),
            ),
          ])
        else ...[
          SettingsSection(title: 'Online store', why: 'Checkout rules. The look of your store is under Store design.', children: [
            if (sub != null && sub.isNotEmpty)
              SettingRow(
                label: 'Store address',
                help: '$sub.khatario.com',
                trailing: KIconButton(
                  icon: LucideIcons.copy,
                  tooltip: 'Copy store address',
                  onTap: () async {
                    await Clipboard.setData(ClipboardData(text: 'https://$sub.khatario.com'));
                    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Store address copied')));
                  },
                ),
              ),
            ToggleSetting(
              label: 'Store is live',
              value: store['store_enabled'] == true,
              onChanged: (v) => _setStore('store_enabled', v, v ? 'Store is live' : 'Store is offline'),
            ),
            TextSetting(label: 'Minimum order (₹)', controller: _f.field('minorder'), keyboardType: TextInputType.number, short: true),
            ToggleSetting(
              label: 'Allow cash on delivery',
              value: store['store_allow_cod'] != false,
              onChanged: (v) => _setStore('store_allow_cod', v, v ? 'Cash on delivery on' : 'Cash on delivery off'),
            ),
            NavSetting(label: 'Store design', value: 'Theme, banners, pages in Studio', onTap: () => openPhoneSetting(context, widget.session, '/settings/online-store/studio')),
          ]),
          SettingsSection(title: 'Delivery', why: 'Who carries parcels and where you deliver.', children: [
            SegmentSetting<String>(
              label: 'Delivery partner',
              value: store['store_delivery_provider'] == 'shiprocket' ? 'shiprocket' : 'self',
              options: const [('self', 'Own staff'), ('shiprocket', 'Shiprocket')],
              onChanged: (v) => _setStore('store_delivery_provider', v, v == 'shiprocket' ? 'Shiprocket books couriers' : 'Your own staff deliver'),
            ),
            if (store['store_delivery_provider'] == 'shiprocket')
              StatusSetting(
                label: 'Shiprocket',
                status: store['shiprocket_configured'] == true
                    ? (store['shiprocket_webhook_configured'] == true ? 'Connected · tracking on' : 'Connected · tracking not linked')
                    : 'Login not added',
                tone: store['shiprocket_configured'] == true ? KTone.positive : KTone.due,
                action: 'Set up',
                onAction: () => openPhoneSetting(context, widget.session, '/settings/online-store'),
              ),
            NavSetting(label: 'Delivery zones', value: 'Areas, pincodes, charges and self-pickup', onTap: () => openPhoneSetting(context, widget.session, '/settings/online-store')),
          ]),
          SettingsSection(title: 'Returns', why: 'Buyers can ask from their store account; you approve and receive.', children: [
            TextSetting(
              label: 'Accept returns for (days after delivery)',
              help: '0 turns online returns off.',
              controller: _f.field('retdays'),
              keyboardType: TextInputType.number,
              short: true,
            ),
          ]),
        ],
        SettingsSection(title: 'Buyer updates on WhatsApp', why: 'A message to the buyer at each step.', children: [
          for (final (key, label, help) in _notify)
            ToggleSetting(
              label: label,
              help: help,
              value: notify[key] == true,
              onChanged: (v) => _setSetting({'notify': {...notify, key: v}}, '$label: ${v ? 'on' : 'off'}'),
            ),
        ]),
        SettingsSection(title: 'Dispatch rules', why: 'Keeps orders from waiting too long.', children: [
          ChoiceSetting<int>(
            label: 'Dispatch paid orders within',
            value: toNum(_s['dispatchSlaHours'] ?? 24).toInt(),
            options: const [(12, '12 hours'), (24, '24 hours'), (48, '48 hours'), (72, '3 days')],
            onChanged: (v) => _setSetting({'dispatchSlaHours': v}, 'Dispatch within $v hours'),
          ),
          ToggleSetting(
            label: 'WhatsApp me about late orders',
            value: _s['merchantDispatchAlert'] == true,
            onChanged: (v) => _setSetting({'merchantDispatchAlert': v}, v ? 'Late-order alerts on' : 'Late-order alerts off'),
          ),
          ToggleSetting(
            label: 'Track bills that have a shipping address',
            help: 'They appear under “To pack” straight away.',
            value: _s['autoTrackShippedBills'] != false,
            onChanged: (v) => _setSetting({'autoTrackShippedBills': v}, v ? 'Bills with an address are tracked' : 'Start tracking yourself'),
          ),
          TextSetting(
            label: 'Tell the buyer about a delay after (days)',
            help: '0 turns the delay message off.',
            controller: _f.field('delay'),
            keyboardType: TextInputType.number,
            short: true,
          ),
        ]),
        SettingsSection(title: 'WhatsApp shop', why: 'Customers browse, send a cart and pay inside WhatsApp.', children: [
          NavSetting(label: 'Items on sale and welcome message', onTap: () => openPhoneSetting(context, widget.session, '/settings/whatsapp/shop')),
        ]),
      ],
    );
  }
}

