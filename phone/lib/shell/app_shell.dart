import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../api.dart';
import '../capability.dart';
import '../format.dart';
import '../screens/hub/hub_home_screen.dart';
import '../screens/purchases/order_list_screen.dart';
import '../screens/hub/my_catalog_screen.dart';
import '../screens/hub/hub_directory_screen.dart';
import '../screens/hub/incoming_bills_screen.dart';
import '../screens/hub/new_arrivals_screen.dart';
import '../screens/hub/supply_orders_screen.dart';
import '../screens/dashboard_screen.dart';
import '../screens/invoices/invoices_screen.dart';
import '../screens/items/item_form_screen.dart';
import '../screens/items/scan_add_screen.dart';
import '../screens/items/items_screen.dart';
import '../screens/invoices/invoice_detail_screen.dart';
import '../screens/invoices/invoice_form_screen.dart';
import '../screens/items/item_detail_screen.dart';
import '../screens/more/more_screen.dart';
import '../screens/notifications/notifications_screen.dart';
import '../screens/pages/page_catalog.dart';
import '../screens/pages/website_page_screen.dart';
import '../screens/chats/chats_inbox_screen.dart';
import '../screens/pages/record_page.dart';
import '../screens/expenses/expense_form_screen.dart';
import '../screens/payments/payment_in_logic.dart';
import '../screens/payments/payment_in_screen.dart';
import '../screens/parties/customer_detail_screen.dart';
import '../screens/parties/customer_form_screen.dart';
import '../screens/parties/parties_screen.dart';
import '../screens/parties/party_logic.dart';
import '../screens/orders/orders_screen.dart';
import '../screens/settings/settings_hub_screen.dart';
import '../screens/settings/settings_router.dart';
import '../screens/parties/supplier_detail_screen.dart';
import '../screens/parties/supplier_form_screen.dart';
import '../screens/purchases/bill_form_screen.dart';
import '../screens/purchases/purchase_section.dart';
import '../screens/reports/aging_report_screen.dart';
import '../screens/search/search_screen.dart';
import '../session.dart';
import '../theme.dart';
import '../ui/kit.dart';
import 'date_range.dart';
import 'mobile_nav.dart';
import 'mobile_nav_editor.dart';
import 'module_settings_sheet.dart';
import 'shell_banners.dart';

/// Copy of the mobile app shell in `app/(app)/layout.tsx`: TopBar (mobile app bar,
/// BusinessSwitcher, dashboard date stepper), page body and BottomNav.
enum AppTab { home, invoices, items, parties, more, chats, contacts, team, attendance, orders }

typedef NavItem = (AppTab tab, String label, IconData icon, IconData activeIcon, int badge);

/// `BottomNav.tsx` layouts. A saved `user.mobile_nav` replaces the middle shortcuts.
List<NavItem> bottomNavItems(AppSession s, {int unpaidInvoices = 0, int lowStockItems = 0}) {
  const home = (AppTab.home, 'Home', LucideIcons.house, LucideIcons.house500, 0);
  const more = (AppTab.more, 'More', LucideIcons.ellipsis, LucideIcons.ellipsis500, 0);
  const chats = (AppTab.chats, 'Chats', LucideIcons.messageSquare, LucideIcons.messageSquare500, 0);
  NavItem middle(String id) => switch (id) {
        'invoices' => (AppTab.invoices, 'Invoices', LucideIcons.fileText, LucideIcons.fileText500, unpaidInvoices),
        'items' => (AppTab.items, 'Items', LucideIcons.package, LucideIcons.package500, lowStockItems),
        'parties' => (AppTab.parties, 'Parties', LucideIcons.users, LucideIcons.users500, 0),
        'chats' => chats,
        'contacts' => (AppTab.contacts, 'Contacts', LucideIcons.contact, LucideIcons.contact500, 0),
        'orders' => (AppTab.orders, 'Orders', LucideIcons.truck, LucideIcons.truck500, 0),
        'team' => (AppTab.team, 'Team', LucideIcons.users, LucideIcons.users500, 0),
        'attendance' => (AppTab.attendance, 'Attendance', LucideIcons.calendarCheck, LucideIcons.calendarCheck500, 0),
        _ => (AppTab.parties, 'Parties', LucideIcons.users, LucideIcons.users500, 0),
      };
  return [
    pinnedChats(s) ? chats : home,
    for (final id in displayedMiddle(s)) middle(id),
    more,
  ];
}

class AppShell extends StatefulWidget {
  const AppShell({super.key, required this.session, required this.onSessionChanged, required this.onSignOut});

  final AppSession session;
  final Future<void> Function() onSessionChanged;
  final Future<void> Function() onSignOut;

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  AppTab _tab = AppTab.home;
  DashboardRange _range = DashboardRange.today();
  int _unpaidInvoices = 0;
  int _lowStockItems = 0;
  int _unreadNotifications = 0;
  List<Map<String, dynamic>> _businesses = const [];
  bool _businessesLoaded = false;
  List<String> _enabledFeatures = const [];
  bool _featuresLoaded = false;
  CapabilitySnapshot? _snapshot;

  /// Kept so Parties can open on Suppliers when More asks for that list.
  bool _openedFromMore = false;

  /// More > Suppliers opens the Parties list on the Suppliers tab.
  bool _partiesStartSuppliers = false;
  PartyKind _partyKind = PartyKind.customers;
  int _partiesEpoch = 0;
  int _itemsEpoch = 0;

  /// `all` on the Items tab. `low` when Home asks for the low-stock list.
  String _itemsStock = 'all';
  int _invoicesEpoch = 0;

  KhatarioApi get _api => widget.session.api;

  AppTab get _homeTab => widget.session.isConnectAgent ? AppTab.chats : AppTab.home;

  late final ShellBannersController _banners = ShellBannersController(widget.session)
    ..onModal = (promo) {
      if (mounted) showPromotionModal(context, promo: promo, controller: _banners, onOpen: _openAnything);
    };

  BannerPlacement get _bannerPlacement => switch (_tab) {
        AppTab.home => BannerPlacement.dashboard,
        AppTab.chats || AppTab.contacts => BannerPlacement.hidden,
        _ => BannerPlacement.compact,
      };

  /// The Items page's header search toggle (`useMobileHeaderRightAccessory`).
  bool _itemsSearchOpen = false;

  Future<void> _editNav() async {
    final saved = await showMobileNavEditor(context, widget.session);
    if (saved && mounted) await widget.onSessionChanged();
  }

  void _selectTab(AppTab t) {
    if (t == AppTab.home && _tab != AppTab.home) _banners.loadUsage();
    setState(() {
      if (t != _tab) _itemsSearchOpen = false;
      _tab = t;
      _openedFromMore = false;
      _partiesStartSuppliers = false;
      if (t == AppTab.items) _itemsStock = 'all';
    });
  }

  /// A More menu row (website href).
  void _openFromMore(String href, String label) {
    if (href == '/search') {
      _openSearch();
      return;
    }
    if (href == '/payments/in' || href == '/payments/out') {
      Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => PaymentInScreen(session: widget.session, payable: href == '/payments/out'),
      ));
      return;
    }
    if (href == '/suppliers/new') {
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => SupplierFormScreen(session: widget.session)));
      return;
    }
    if (href == '/expenses/new') {
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => ExpenseFormScreen(session: widget.session)));
      return;
    }
    if (href == '/reports/aging/receivables' || href == '/reports/aging/payables') {
      Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => AgingReportScreen(session: widget.session, payables: href.endsWith('payables')),
      ));
      return;
    }
    final tab = switch (href) {
      '/items' => AppTab.items,
      '/invoices' => AppTab.invoices,
      '/customers' || '/suppliers' => AppTab.parties,
      _ => null,
    };
    if (openPhoneSetting(context, widget.session, href)) return;
    if (href == '/orders') {
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => OrdersScreen(session: widget.session)));
      return;
    }
    // Supplier Hub screens.
    final hubScreen = switch (href) {
      '/purchases/incoming' => IncomingBillsScreen(session: widget.session),
      '/supply-orders' => SupplyOrdersScreen(session: widget.session),
      // Single-item stock requests were replaced by supplier orders (migration 430).
      '/purchases/requests' => SupplyOrdersScreen(session: widget.session),
      '/purchases/order-list' => OrderListScreen(session: widget.session),
      '/supply-orders?role=vendor' => SupplyOrdersScreen(session: widget.session, selling: true),
      '/purchases/new-arrivals' => NewArrivalsScreen(session: widget.session),
      '/suppliers/hub' => HubHomeScreen(session: widget.session),
      '/suppliers/hub/find' => HubDirectoryScreen(session: widget.session),
      '/suppliers/catalog' => MyCatalogScreen(session: widget.session),
      '/suppliers/requests' => ConnectionRequestsScreen(session: widget.session),
      _ => null,
    };
    if (hubScreen != null) {
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => hubScreen));
      return;
    }
    const purchaseHrefs = {
      '/purchases': PurchaseKind.bills,
      '/purchase-orders': PurchaseKind.orders,
      '/purchase-returns': PurchaseKind.returns,
    };
    final purchaseKind = purchaseHrefs[href];
    if (purchaseKind != null) {
      Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => PurchaseSectionScreen(session: widget.session, kind: purchaseKind),
      ));
      return;
    }
    // Settings: the hub, or the group that now holds this website settings link.
    final settingsGroup = settingsGroupForHref(href);
    if (settingsGroup != null) {
      Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => settingsGroup.isEmpty ? SettingsHubScreen(session: widget.session) : settingsGroupScreen(settingsGroup, widget.session),
      ));
      return;
    }
    final page = pageForHref(href)?.withTitle(label);
    if (page != null) {
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => RecordPage(session: widget.session, page: page)));
      return;
    }
    // No phone screen for this link: open the website page inside the app, signed in.
    if (tab == null) return openWebsiteInApp(context, widget.session, href, label);
    _selectTab(tab);
    setState(() {
      _openedFromMore = true;
      _partiesStartSuppliers = href == '/suppliers';
    });
  }

  @override
  void dispose() {
    _banners.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _tab = _homeTab;
    _banners.start();
    _banners.loadUsage();
    _loadBadges();
    _loadBusinesses();
    _loadNotifications();
    _loadCapabilities();
  }

  Future<void> _loadBadges() async {
    try {
      final body = await _api.getJson('/api/badges/counts');
      if (!mounted) return;
      setState(() {
        _unpaidInvoices = toNum(body['unpaid_invoices']).toInt();
        _lowStockItems = toNum(body['low_stock_items']).toInt();
      });
    } catch (_) {}
  }

  Future<void> _loadBusinesses() async {
    try {
      final body = await _api.getJson('/api/businesses/my');
      final list = (body['businesses'] as List?) ?? const [];
      if (!mounted) return;
      setState(() {
        _businesses = list
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .where((b) => b['id'] is String && b['name'] is String)
            .toList();
      });
    } catch (_) {
    } finally {
      if (mounted) setState(() => _businessesLoaded = true);
    }
  }

  Future<void> _loadNotifications() async {
    try {
      final body = await _api.getJson('/api/notifications?limit=20');
      final list = (body['notifications'] as List?) ?? const [];
      if (!mounted) return;
      setState(() {
        _unreadNotifications = list.whereType<Map>().where((n) => n['is_read'] != true).length;
      });
    } catch (_) {}
  }

  /// `LayoutDataContext` bootstrap: role permissions and plan features form the capability snapshot.
  Future<void> _loadCapabilities() async {
    final (perms, features) = await (
      _api.getJson('/api/settings/permissions').then<Map<String, dynamic>?>((b) => b, onError: (_) => null),
      _api.getJson('/api/features/enabled').then<Map<String, dynamic>?>((b) => b, onError: (_) => null),
    ).wait;
    if (!mounted) return;
    final permissions = <String, Map<String, dynamic>>{
      for (final e in ((perms?['permissions'] as Map?) ?? const {}).entries)
        if (e.value is Map) e.key.toString(): Map<String, dynamic>.from(e.value as Map),
    };
    final isPrimaryAdmin = perms?['isPrimaryAdmin'] == true;
    final reliable = permissions.isNotEmpty || isPrimaryAdmin;
    final ids = ((features?['enabledIds'] as List?) ?? const []).map((e) => e.toString()).toList();
    setState(() {
      _enabledFeatures = ids;
      _featuresLoaded = true;
      _snapshot = CapabilitySnapshot(
        permissions: reliable ? permissions : const {},
        isPrimaryAdmin: reliable && isPrimaryAdmin,
        enabledFeatures: ids,
      );
    });
  }

  Capabilities? get _capabilities {
    final snap = _snapshot;
    if (snap == null) return null;
    final perms = widget.session.raw['permissions'];
    return Capabilities(
      sessionIsPrimaryAdmin: widget.session.isPrimaryAdmin,
      sessionPermissions: perms is Map ? Map<String, dynamic>.from(perms) : const {},
      snapshot: snap,
    );
  }

  /// `getMobileRouteTitle`; null falls back to the business name.
  String get _title => switch (_tab) {
        AppTab.home => 'Home',
        AppTab.invoices => 'Invoices',
        AppTab.items => 'Items',
        AppTab.parties => 'Parties',
        AppTab.more => 'More',
        AppTab.chats || AppTab.contacts => 'WhatsApp',
        AppTab.team => 'Employees',
        AppTab.attendance => 'Mark attendance',
        AppTab.orders => widget.session.businessName,
      };

  IconData get _quickSettingsIcon => switch (_tab) {
        AppTab.invoices => LucideIcons.layoutTemplate,
        AppTab.items => LucideIcons.tags,
        AppTab.parties => LucideIcons.building2,
        _ => LucideIcons.settings,
      };

  Future<void> _openNewInvoice({String? customerId}) async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => InvoiceFormScreen(session: widget.session, customerId: customerId),
    ));
    if (saved == true && mounted) {
      setState(() => _invoicesEpoch++);
      _loadBadges();
    }
  }

  void _openNamed(String what) {
    if (what == 'New invoice' || what.startsWith('New invoice:')) {
      final id = what.startsWith('New invoice:') ? what.substring('New invoice:'.length) : null;
      _openNewInvoice(customerId: (id == null || id.isEmpty) ? null : id);
      return;
    }
    _openAnything(what);
  }

  Future<void> _openNewItem() async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => ItemFormScreen(session: widget.session),
    ));
    if (saved == true && mounted) setState(() => _itemsEpoch++);
  }

  /// Scan & Add Items has its own plan feature (items_scan_onboarding), not billing's advanced_barcode.
  Future<void> _openScanAdd() async {
    if (_capabilities?.has('items_scan_onboarding') == false) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Scan & Add Items is not in your plan.')));
      return;
    }
    final added = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => ScanAddScreen(session: widget.session, canAddStock: _capabilities?.has('purchase_inventory_adjustments') ?? false, onOpen: _openAnything),
    ));
    if (added == true && mounted) setState(() => _itemsEpoch++);
  }

  Future<void> _openNewCustomer() async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => CustomerFormScreen(session: widget.session, capabilities: _capabilities),
    ));
    if (saved == true && mounted) setState(() => _partiesEpoch++);
  }

  void _openSearch() {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => SearchScreen(session: widget.session, onOpenHit: _openSearchHit),
    ));
  }

  void _openSearchHit(SearchHit hit) {
    switch (hit.type) {
      case 'invoice':
        Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => InvoiceDetailScreen(api: widget.session.api, invoiceId: hit.id, businessName: widget.session.businessName, session: widget.session),
        ));
      case 'customer':
        Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => CustomerDetailScreen(session: widget.session, customerId: hit.id, capabilities: _capabilities, onOpen: _openAnything),
        ));
      case 'item':
        Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => ItemDetailScreen(session: widget.session, itemId: hit.id, onOpen: _openAnything),
        ));
      case 'supplier':
        Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => SupplierDetailScreen(session: widget.session, supplierId: hit.id, onOpen: _openAnything),
        ));
      default:
        _openAnything(searchTypeLabel(hit.type));
    }
  }

  void _openNotifications() {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => NotificationsScreen(
        session: widget.session,
        onUnread: (n) { if (mounted) setState(() => _unreadNotifications = n); },
        onOpen: (n) {
          final target = notificationTarget(n);
          if (target == null) return;
          if (target.kind == 'invoice') {
            Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => InvoiceDetailScreen(api: widget.session.api, invoiceId: target.id!, businessName: widget.session.businessName, session: widget.session),
            ));
            return;
          }
          if (target.kind == 'invoices') {
            Navigator.of(context).pop();
            _selectTab(AppTab.invoices);
            return;
          }
          if (target.kind == 'supplier' && target.id != null) {
            Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => SupplierDetailScreen(session: widget.session, supplierId: target.id!, onOpen: _openAnything),
            ));
            return;
          }
          _openAnything(target.label);
        },
      ),
    ));
  }

  /// Every "open X" request from a screen (dashboard tiles, detail screens, sheets, banners,
  /// notifications) lands here: the phone screen for it, a website page for the few editors that
  /// only exist there, and only then a message.
  void _openAnything(String what) {
    final w = what.trim();
    if (w.startsWith('/')) return _openFromMore(w, w);
    if (w == 'New invoice' || w.startsWith('New invoice:')) return _openNamed(w);

    void push(Widget screen) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
    void page(String href) => _openFromMore(href, w);
    // A tab is under any open screen, so close those first.
    void tab(AppTab t) {
      Navigator.of(context).popUntil((r) => r.isFirst);
      _selectTab(t);
    }

    if (w.startsWith('Invoice ') ||
        const {'Filtered invoices', 'Invoices for this period', 'Invoices for this day', 'Sales details'}.contains(w)) {
      return tab(AppTab.invoices);
    }
    if (w.startsWith('Open item ')) {
      final id = w.substring('Open item '.length).trim();
      if (id.isEmpty) return;
      return push(ItemDetailScreen(session: widget.session, itemId: id, onOpen: _openAnything));
    }
    if (w == 'Low stock items') return _openLowStock();
    if (w.startsWith('Item ') || const {'Item details', 'The full item page'}.contains(w)) {
      return tab(AppTab.items);
    }
    if (w.startsWith('Purchase ') || const {'Purchase details', 'Purchase detail', 'Filtered purchases', 'Purchases for this day'}.contains(w)) {
      return page('/purchases');
    }
    if (w.endsWith(' details') && (w.startsWith('To collect') || w.startsWith('To pay') || w.startsWith('You'))) {
      return tab(AppTab.parties);
    }
    switch (w) {
      case 'Record payment':
        _openRecordPayment();
        return;
      case 'Collection details':
      case 'New payment':
        return push(PaymentInScreen(session: widget.session));
      case 'New payment out':
        return push(PaymentInScreen(session: widget.session, payable: true));
      case 'New purchase':
        return push(BillFormScreen(session: widget.session, kind: BillKind.purchase));
      case 'Expenses':
        return page('/expenses');
      case 'New expense':
        return push(ExpenseFormScreen(session: widget.session));
      case 'New estimate':
      case 'New quotation':
        return push(InvoiceFormScreen(session: widget.session, documentType: 'proforma_invoice'));
      case 'New item':
        _openNewItem();
        return;
      case 'New party':
      case 'New customer':
        _openNewCustomer();
        return;
      case 'New supplier':
        return push(SupplierFormScreen(session: widget.session));
      case 'Reports':
        return page('/reports');
      case 'New inventory adjustment':
        return page('/inventory-adjustments');
      case 'Scan & add items':
        _openScanAdd();
        return;
      case 'Print barcodes':
      case 'Print barcode':
        return page('/items/barcodes');
      case 'Manage categories':
        return page('/items/categories');
      case 'Subscription':
      case 'Plans':
        return page('/settings/subscription');
      case 'Settings':
        return page('/settings');
      case 'Edit supplier':
        _selectTab(AppTab.parties);
        setState(() {
          _openedFromMore = true;
          _partiesStartSuppliers = true;
        });
        return;
      case 'My employee profile':
        return page('/hr/dashboard');
    }
    // A page title from the catalogue ("Profit & Loss", "Quotations"…).
    final lower = w.toLowerCase();
    final byTitle = appPages.where((p) => p.title.toLowerCase() == lower).firstOrNull;
    if (byTitle != null) return page(byTitle.href);
    _notBuilt(w);
  }

  void _notBuilt(String what) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text('$what is not on the phone yet.')));
  }

  /// Collect or Pay from Home: record the receipt, then show it on the matching list.
  Future<void> _openRecordPayment({bool payable = false}) async {
    final recorded = await Navigator.of(context).push<RecordedPayments>(
      MaterialPageRoute(builder: (_) => PaymentInFormScreen(session: widget.session, payable: payable)),
    );
    if (!mounted || recorded == null) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => PaymentInScreen(session: widget.session, payable: payable, highlightIds: recorded.ids),
    ));
  }

  /// Items list with the low-stock chip already on. The Items tab itself stays unfiltered.
  void _openLowStock() {
    Navigator.of(context).popUntil((r) => r.isFirst);
    setState(() {
      _itemsStock = 'low';
      _itemsSearchOpen = false;
      _tab = AppTab.items;
      _openedFromMore = false;
      _partiesStartSuppliers = false;
    });
  }

  /// Home shortcuts that already have a phone screen. Everything else stays on [_notBuilt].
  void _openFromHome(String what) {
    switch (what) {
      case 'New invoice':
        _openNewInvoice();
      case 'Filtered invoices':
      case 'Invoices for this period':
        _selectTab(AppTab.invoices);
      case 'New item':
        _openNewItem();
      case 'Record payment out':
        _openRecordPayment(payable: true);
        break;
      case 'Low stock items':
        _openLowStock();
        break;
      case 'New party':
        _selectTab(AppTab.parties);
      default:
        _openAnything(what);
    }
  }

  Widget _recordTab(String href) {
    final page = pageForHref(href);
    if (page == null) {
      return const Center(child: Text('Nothing to show for this tab.'));
    }
    return RecordPage(key: ValueKey(href), session: widget.session, page: page, embedded: true);
  }

  Widget _body() {
    return switch (_tab) {
      AppTab.home => DashboardScreen(
          key: ValueKey('dashboard-${_range.start}-${_range.end}'),
          session: widget.session,
          range: _range,
          onOpen: _openFromHome,
          onRange: (r) => setState(() => _range = r),
          enabledFeatures: _featuresLoaded ? _enabledFeatures : null,
          banners: _banners,
        ),
      AppTab.invoices => InvoicesScreen(
          key: ValueKey('invoices-${widget.session.businessId}-$_invoicesEpoch'),
          session: widget.session,
          banners: _banners,
          onOpen: _openAnything,
          onPaymentRecorded: _loadBadges,
        ),
      AppTab.parties => PartiesScreen(
          key: ValueKey('parties-${widget.session.businessId}-$_partiesStartSuppliers-$_partiesEpoch'),
          session: widget.session,
          capabilities: _capabilities,
          initialKind: _partiesStartSuppliers ? PartyKind.suppliers : PartyKind.customers,
          onKindChanged: (kind) => _partyKind = kind,
          onOpen: _openNamed,
          banners: ShellBanners(controller: _banners, placement: _bannerPlacement, onOpen: _openAnything),
        ),
      AppTab.items => ItemsScreen(
          key: ValueKey('items-${widget.session.businessId}-$_itemsEpoch-$_itemsStock'),
          session: widget.session,
          banners: _banners,
          searchOpen: _itemsSearchOpen,
          onOpen: _openAnything,
          onStockChanged: _loadBadges,
          initialStock: _itemsStock,
        ),
      AppTab.more => MoreScreen(
          key: ValueKey('more-${widget.session.businessId}'),
          session: widget.session,
          banners: _banners,
          onNavigate: _openFromMore,
          onOpen: _openAnything,
          onSignOut: widget.onSignOut,
          onEditNav: _editNav,
        ),
      AppTab.chats => ChatsInboxScreen(key: ValueKey('chats-${widget.session.businessId}'), session: widget.session),
      AppTab.contacts => _recordTab('/whatsapp/contacts'),
      AppTab.team => _recordTab('/employees'),
      AppTab.attendance => _recordTab('/employees/attendance'),
      AppTab.orders => OrdersScreen(key: ValueKey('orders-${widget.session.businessId}'), session: widget.session, embedded: true),
    };
  }

  bool get _showBusinessSwitcher {
    if (!_businessesLoaded) return false;
    final canAdd = widget.session.isPrimaryAdmin && _enabledFeatures.contains('settings_multi_business');
    return _businesses.length > 1 || canAdd;
  }

  /// The one primary action for the current tab, shown as a floating button.
  (String, VoidCallback)? get _primaryAction => switch (_tab) {
        AppTab.home || AppTab.invoices => ('New bill', _openNewInvoice),
        AppTab.items => ('Add item', _openNewItem),
        AppTab.parties => (
            'Add party',
            () {
              if (_partyKind == PartyKind.suppliers) {
                Navigator.of(context).push(MaterialPageRoute(builder: (_) => SupplierFormScreen(session: widget.session)));
              } else {
                _openNewCustomer();
              }
            },
          ),
        _ => null,
      };

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: _tab == _homeTab,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _selectTab(_homeTab);
      },
      child: _scaffold(),
    );
  }

  Widget _scaffold() {
    final action = _primaryAction;
    final hasQuickSettings = _tab == AppTab.invoices || _tab == AppTab.items || _tab == AppTab.parties;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: Column(
        children: [
          if (_tab != AppTab.chats)
          _AppBar(
            session: widget.session,
            businesses: _businesses,
            canSwitch: _showBusinessSwitcher,
            onSwitched: widget.onSessionChanged,
            onHome: () => _selectTab(_homeTab),
            actions: [
              if (_tab == AppTab.items)
                _HeaderSearchToggle(open: _itemsSearchOpen, onTap: () => setState(() => _itemsSearchOpen = !_itemsSearchOpen))
              else
                KIconButton(icon: LucideIcons.search, tooltip: 'Search', color: AppGradients.on, onTap: _openSearch),
              KIconButton(
                icon: LucideIcons.bell,
                color: AppGradients.on,
                tooltip: 'Notifications',
                badge: _unreadNotifications,
                onTap: _openNotifications,
              ),
              if (hasQuickSettings)
                KIconButton(
                  icon: _quickSettingsIcon,
                  color: AppGradients.on,
                  tooltip: '$_title settings',
                  onTap: () => switch (_tab) {
                    AppTab.invoices => showModuleSettingsSheet(context, menu: ModuleSettingsMenu.invoicing, onOpen: _openAnything),
                    AppTab.items => showModuleSettingsSheet(
                        context,
                        menu: ModuleSettingsMenu.items,
                        onOpen: _openAnything,
                        enabledFeatures: _enabledFeatures,
                      ),
                    _ => _openAnything('Settings'),
                  },
                ),
            ],
          ),
          Expanded(child: _body()),
        ],
      ),
      floatingActionButton: action == null ? null : KFab(label: action.$1, onTap: action.$2),
      bottomNavigationBar: _BottomNav(
        tab: _tab,
        items: bottomNavItems(widget.session, unpaidInvoices: _unpaidInvoices, lowStockItems: _lowStockItems),
        onTab: (t) {
          _selectTab(t);
          _loadBadges();
        },
        onCustomize: _editNav,
      ),
    );
  }
}

/// Items page header button: Search items / Close search.
class _HeaderSearchToggle extends StatelessWidget {
  const _HeaderSearchToggle({required this.open, required this.onTap});

  final bool open;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      expanded: open,
      child: KIconButton(
        icon: open ? LucideIcons.x : LucideIcons.search,
        tooltip: open ? 'Close search' : 'Search items',
        color: AppGradients.on,
        onTap: onTap,
      ),
    );
  }
}

/// Brand gradient top bar: business identity (tap to switch) on the left, icon actions on the right.
/// Page titles live in the page content, so the bar is the same on every tab. Home continues the
/// same gradient into its header band.
class _AppBar extends StatelessWidget {
  const _AppBar({
    required this.session,
    required this.businesses,
    required this.canSwitch,
    required this.onSwitched,
    required this.onHome,
    required this.actions,
  });

  final AppSession session;
  final List<Map<String, dynamic>> businesses;
  final bool canSwitch;
  final Future<void> Function() onSwitched;
  final VoidCallback onHome;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent),
      child: Container(
      decoration: BoxDecoration(gradient: AppGradients.brand),
      child: SafeArea(
        bottom: false,
        child: SizedBox(
          height: 60,
          child: Padding(
            padding: const EdgeInsets.only(left: AppSpace.gutter, right: AppSpace.xs),
            child: Row(
              children: [
                Expanded(
                  child: BusinessSwitcherBar(
                    session: session,
                    businesses: businesses,
                    canSwitch: canSwitch,
                    onSwitched: onSwitched,
                    onTapWhenFixed: onHome,
                    onDark: true,
                  ),
                ),
                ...actions,
              ],
            ),
          ),
        ),
      ),
      ),
    );
  }
}

/// Business logo or initial in a rounded square, name and role. Opens a sheet to switch business.
class BusinessSwitcherBar extends StatefulWidget {
  const BusinessSwitcherBar({
    super.key,
    required this.session,
    required this.businesses,
    required this.onSwitched,
    this.canSwitch = true,
    this.onTapWhenFixed,
    this.onDark = false,
  });

  /// Drawn on the brand gradient.
  final bool onDark;

  final AppSession session;
  final List<Map<String, dynamic>> businesses;
  final Future<void> Function() onSwitched;
  final bool canSwitch;

  /// Tap action when there is nothing to switch to.
  final VoidCallback? onTapWhenFixed;

  @override
  State<BusinessSwitcherBar> createState() => _BusinessSwitcherBarState();
}

class _BusinessSwitcherBarState extends State<BusinessSwitcherBar> {
  bool _switching = false;

  static String _roleLabel(String role) => role
      .split(RegExp(r'[_\s]+'))
      .where((w) => w.isNotEmpty)
      .map((w) => w[0].toUpperCase() + w.substring(1).toLowerCase())
      .join(' ');

  Future<void> _select(String id) async {
    if (_switching || id == widget.session.businessId) return;
    setState(() => _switching = true);
    try {
      await widget.session.api.postJson('/api/businesses/switch', {'business_id': id});
      await widget.onSwitched();
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message.isEmpty ? 'Could not switch business' : e.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Network error while switching business')));
      }
    } finally {
      if (mounted) setState(() => _switching = false);
    }
  }

  void _openSheet() {
    final activeId = widget.session.businessId;
    showKSheet<void>(
      context,
      title: 'Switch business',
      scrollable: true,
      builder: (ctx) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final b in widget.businesses)
            KSheetAction(
              icon: LucideIcons.store,
              label: b['name'].toString(),
              subtitle: (b['role']?.toString() ?? '').isEmpty ? null : _roleLabel(b['role'].toString()),
              selected: b['id'] == activeId,
              onTap: () {
                Navigator.of(ctx).pop();
                _select(b['id'].toString());
              },
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    final activeId = session.businessId;
    final current = widget.businesses.where((b) => b['id'] == activeId).firstOrNull;
    final name = current?['name']?.toString() ?? (session.businessName.isEmpty ? 'Business' : session.businessName);
    final role = current?['role']?.toString() ?? '';
    final initial = (name.isEmpty ? 'K' : name[0]).toUpperCase();
    final on = AppGradients.on;
    final fg = widget.onDark ? on : AppColors.ink;
    final logoBg = widget.onDark ? on.withValues(alpha: 0.16) : AppColors.brand;
    final logoFg = widget.onDark ? on : AppColors.onBrand;
    return Semantics(
      button: true,
      label: widget.canSwitch ? 'Switch business, current $name' : name,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: _switching ? null : (widget.canSwitch ? _openSheet : widget.onTapWhenFixed),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              clipBehavior: Clip.antiAlias,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: logoBg,
                borderRadius: BorderRadius.circular(12),
                border: widget.onDark ? Border.all(color: on.withValues(alpha: 0.22)) : null,
              ),
              child: _switching
                  ? SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: logoFg))
                  : session.businessLogo != null
                      ? Image(
                          image: session.businessLogo!,
                          width: 38,
                          height: 38,
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => Text(initial, style: AppText.bodyStrong.copyWith(color: logoFg)),
                        )
                      : Text(initial, style: AppText.bodyStrong.copyWith(color: logoFg)),
            ),
            const SizedBox(width: 10),
            Flexible(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Flexible(
                        child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.bodyStrong.copyWith(color: fg)),
                      ),
                      if (widget.canSwitch) ...[
                        const SizedBox(width: 2),
                        Icon(LucideIcons.chevronDown, size: 16, color: fg.withValues(alpha: 0.8)),
                      ],
                    ],
                  ),
                  if (role.isNotEmpty)
                    Text(
                      _roleLabel(role),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.caption.copyWith(fontSize: 12, height: 16 / 12, color: widget.onDark ? fg.withValues(alpha: 0.7) : AppColors.ink3),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BottomNav extends StatelessWidget {
  const _BottomNav({required this.tab, required this.items, required this.onTab, required this.onCustomize});

  final AppTab tab;
  final List<NavItem> items;
  final ValueChanged<AppTab> onTab;
  final VoidCallback onCustomize;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.hairline)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 68,
          child: Row(
            children: [
              for (final (t, label, icon, activeIcon, badge) in items)
                Expanded(
                  child: Semantics(
                    button: true,
                    selected: t == tab,
                    child: InkWell(
                      onTap: () => onTab(t),
                      onLongPress: onCustomize,
                      highlightColor: Colors.transparent,
                      splashColor: Colors.transparent,
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          SizedBox(
                            width: 60,
                            height: 32,
                            child: Stack(
                              clipBehavior: Clip.none,
                              alignment: Alignment.center,
                              children: [
                                AnimatedContainer(
                                  duration: const Duration(milliseconds: 180),
                                  width: t == tab ? 60 : 32,
                                  decoration: BoxDecoration(
                                    color: t == tab ? AppColors.brandSoft : Colors.transparent,
                                    borderRadius: BorderRadius.circular(999),
                                  ),
                                ),
                                Icon(t == tab ? activeIcon : icon, size: 22, color: t == tab ? AppColors.brand : AppColors.ink3),
                                if (badge > 0) Positioned(left: 34, top: -4, child: KBadge(count: badge)),
                              ],
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            label,
                            style: AppText.small.copyWith(
                              fontSize: 11,
                              height: 1,
                              fontWeight: t == tab ? FontWeight.w600 : FontWeight.w500,
                              color: t == tab ? AppColors.ink : AppColors.ink3,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
