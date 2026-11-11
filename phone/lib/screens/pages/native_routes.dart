import 'package:flutter/material.dart';

import '../../capability.dart';
import '../../session.dart';
import '../accounting/account_form_screen.dart';
import '../accounting/accounts_screen.dart';
import '../accounting/advances_screen.dart';
import '../accounting/activity_logs_screen.dart';
import '../accounting/bank_reconciliation_screen.dart';
import '../accounting/fixed_assets_screen.dart';
import '../accounting/provisions_screen.dart';
import '../accounting/tds_screen.dart';
import '../accounting/contra_screen.dart';
import '../accounting/journal_entries_screen.dart';
import '../accounting/ledger_screen.dart';
import '../expenses/expense_categories_screen.dart';
import '../expenses/expense_form_screen.dart';
import '../expenses/expenses_screen.dart';
import '../hr/attendance_screen.dart';
import '../hr/employees_screen.dart';
import '../hr/leaves_screen.dart';
import '../hr/salary_payments_screen.dart';
import '../hub/hub_directory_screen.dart';
import '../hub/hub_home_screen.dart';
import '../hub/incoming_bills_screen.dart';
import '../hub/my_catalog_screen.dart';
import '../hub/new_arrivals_screen.dart';
import '../hub/supply_orders_screen.dart';
import '../orders/orders_screen.dart';
import '../parties/supplier_form_screen.dart';
import '../payments/payment_in_screen.dart';
import '../payments/payment_reconciliation_screen.dart';
import '../purchases/order_list_screen.dart';
import '../purchases/purchase_section.dart';
import '../reports/aging_report_screen.dart';
import '../reports/cash_flow_screen.dart';
import '../reports/financial_statements_screens.dart';
import '../reports/reports_home_screen.dart';
import '../reports/stock_reports.dart';
import '../sales/credit_approvals_screen.dart';
import '../sales/credit_debit_notes_screen.dart';
import '../sales/delivery_challans_screen.dart';
import '../sales/estimates_screen.dart';
import '../sales/payment_reminders_screen.dart';
import '../sales/recurring_invoices_screen.dart';
import '../sales/sales_orders_screen.dart';
import '../sales/work_orders_screen.dart';
import '../settings/settings_hub_screen.dart';
import '../stock/adjustment_form_screen.dart';
import '../stock/adjustments_screen.dart';
import '../stock/insurance_claims_screen.dart';
import '../stock/item_categories_screen.dart';
import '../stock/item_cleanup_screen.dart';
import '../stock/manufacturing_screen.dart';
import '../stock/party_pricing_screen.dart';
import '../stock/price_levels_screen.dart';
import '../stock/price_list_screen.dart';
import '../stock/print_labels_screen.dart';
import '../stock/repack_form_screen.dart';
import '../stock/schemes_screen.dart';
import '../stock/stock_counts_screen.dart';
import '../stock/stock_holds_screen.dart';
import '../stock/stock_transfer_form_screen.dart';
import '../stock/stock_transfers_screen.dart';
import '../tools/calculators_screen.dart';
import '../tools/lookup_tools_screens.dart';
import '../tools/tools_hub_screen.dart';
import '../settings/settings_router.dart';
import '../whatsapp/order_verification_screen.dart';
import 'page_catalog.dart';
import 'record_page.dart';
import 'website_page_screen.dart';

/// Where a More link ends up on the phone.
enum RouteTier {
  /// Its own phone screen ([nativeScreenFor]).
  native,

  /// A bottom-bar tab or the search screen.
  tab,

  /// The website page, opened inside the app.
  website,

  /// The automatic read-only list (`RecordPage`). Listed in [stillGeneric] until it gets a screen.
  generic,

  /// Not a phone route at all.
  none,
}

const _tabHrefs = {'/items', '/invoices', '/customers', '/suppliers', '/search', '/more', '/dashboard', '/notifications'};

/// The phone screen for a website href, or null when the link has none.
///
/// Query strings matter: `/supply-orders?role=vendor` is matched before the query is stripped.
/// [capabilities] is for screens that hide actions the role cannot use; none of today's do.
Widget? nativeScreenFor(AppSession session, String href, {Capabilities? capabilities}) {
  switch (href) {
    case '/payments/in':
    case '/payments/out':
      return PaymentInScreen(session: session, payable: href == '/payments/out');
    case '/suppliers/new':
      return SupplierFormScreen(session: session);
    case '/accounts':
      return AccountsScreen(session: session);
    case '/accounts/new':
      return AccountFormScreen(session: session);
    case '/ledger':
      return LedgerScreen(session: session);
    case '/journal-entries':
      return JournalEntriesScreen(session: session);
    case '/activity-logs':
      return ActivityLogsScreen(session: session);
    case '/bank/reconciliation':
      return BankReconciliationScreen(session: session);
    case '/contra':
      return ContraScreen(session: session);
    case '/advances':
      return AdvancesScreen(session: session);
    case '/fixed-assets':
      return FixedAssetsScreen(session: session);
    case '/provisions':
      return ProvisionsScreen(session: session);
    case '/tds':
    case '/tds/transactions':
      return TdsScreen(session: session);
    case '/tds/payments':
      return TdsScreen(session: session, initialTab: TdsTab.payments);
    case '/tds/certificates':
      return TdsScreen(session: session, initialTab: TdsTab.certificates);
    case '/tds/categories':
      return TdsScreen(session: session, initialTab: TdsTab.categories);
    case '/expenses':
      return ExpensesScreen(session: session);
    case '/expenses/new':
      return ExpenseFormScreen(session: session);
    case '/expenses/categories':
      return ExpenseCategoriesScreen(session: session);
    case '/tools':
      return ToolsHubScreen(session: session);
    case '/tools/hsn-finder':
      return HsnFinderScreen(session: session);
    case '/tools/google-lead-extractor':
      return LeadExtractorScreen(session: session);
    case '/tools/gst-calculator':
      return const GstCalculatorScreen();
    case '/tools/gstin-validator':
      return const GstinValidatorScreen();
    case '/tools/pan-validator':
      return const PanValidatorScreen();
    case '/tools/tds-calculator':
      return const TdsCalculatorScreen();
    case '/tools/discount-calculator':
      return const DiscountCalculatorScreen();
    case '/tools/price-margin-calculator':
      return const PriceMarginCalculatorScreen();
    case '/tools/invoice-number-generator':
      return const InvoiceNumberScreen();
    case '/tools/interest-calculator':
      return const InterestCalculatorScreen();
    case '/tools/emi-calculator':
      return const EmiCalculatorScreen();
    case '/tools/currency-converter':
      return const CurrencyConverterScreen();
    case '/items/categories':
      // Before the settings fall-through: this screen replaces the small settings one.
      return ItemCategoriesScreen(session: session);
    case '/items/barcodes':
      return PrintLabelsScreen(session: session);
    case '/pricing/party-item':
      // Before the settings fall-through: this screen replaces the small settings one.
      return PartyPricingScreen(session: session);
    case '/pricing/levels':
      return PriceLevelsScreen(session: session);
    case '/pricing/schemes':
      return SchemesScreen(session: session);
    case '/reports/aging/receivables':
    case '/reports/aging/payables':
      return AgingReportScreen(session: session, payables: href.endsWith('payables'));
  }
  final setting = phoneSettingPage(session, href);
  if (setting != null) return setting;
  final hub = switch (href) {
    '/orders' => OrdersScreen(session: session),
    '/purchases/incoming' => IncomingBillsScreen(session: session),
    '/supply-orders' => SupplyOrdersScreen(session: session),
    // Single-item stock requests were replaced by supplier orders (migration 430).
    '/purchases/requests' => SupplyOrdersScreen(session: session),
    '/purchases/order-list' => OrderListScreen(session: session),
    '/supply-orders?role=vendor' => SupplyOrdersScreen(session: session, selling: true),
    '/purchases/new-arrivals' => NewArrivalsScreen(session: session),
    '/suppliers/hub' => HubHomeScreen(session: session),
    '/suppliers/hub/find' => HubDirectoryScreen(session: session),
    '/suppliers/catalog' => MyCatalogScreen(session: session),
    '/suppliers/requests' => ConnectionRequestsScreen(session: session),
    '/purchases' => PurchaseSectionScreen(session: session, kind: PurchaseKind.bills),
    '/purchase-orders' => PurchaseSectionScreen(session: session, kind: PurchaseKind.orders),
    '/purchase-returns' => PurchaseSectionScreen(session: session, kind: PurchaseKind.returns),
    _ => null,
  };
  if (hub != null) return hub;
  // Settings: the hub, or the group that now holds this website settings link.
  final group = settingsGroupForHref(href);
  if (group != null) return group.isEmpty ? SettingsHubScreen(session: session) : settingsGroupScreen(group, session);
  return switch (href) {
    '/estimates' => EstimatesScreen(session: session),
    '/sales-orders' => SalesOrdersScreen(session: session),
    '/credit-notes' => CreditDebitNotesScreen(session: session),
    '/debit-notes' => CreditDebitNotesScreen(session: session, debit: true),
    '/delivery-challans' => DeliveryChallansScreen(session: session),
    '/work-orders' => WorkOrdersScreen(session: session),
    '/credit-approvals' => CreditApprovalsScreen(session: session),
    '/recurring-invoices' || '/invoices/recurring' => RecurringInvoicesScreen(session: session),
    '/payments/reminders' || '/whatsapp/reminders' => PaymentRemindersScreen(session: session),
    '/payments/reconciliation' => PaymentReconciliationScreen(session: session),
    '/employees' => EmployeesScreen(session: session),
    '/employees/attendance' => AttendanceScreen(session: session),
    '/employees/leaves' => LeavesScreen(session: session),
    '/employees/salary/payments' => SalaryPaymentsScreen(session: session),
    '/pricing/price-list' => PriceListScreen(session: session),
    '/items/cleanup' => ItemCleanupScreen(session: session),
    '/inventory-adjustments' => AdjustmentsScreen(session: session),
    '/inventory-adjustments/new' => AdjustmentFormScreen(session: session),
    '/inventory-adjustments/repacks/new' => RepackFormScreen(session: session),
    '/stock-counts' => StockCountsScreen(session: session),
    '/stock-holds' => StockHoldsScreen(session: session),
    '/manufacturing' => ManufacturingScreen(session: session),
    '/insurance-claims' => InsuranceClaimsScreen(session: session),
    '/stock-transfers' => StockTransfersScreen(session: session),
    '/stock-transfers/new' => StockTransferFormScreen(session: session),
    '/whatsapp/orders' => OrderVerificationScreen(session: session),
    '/reports' => ReportsHomeScreen(session: session),
    '/reports/cash-flow' => CashFlowScreen(session: session),
    '/reports/profit-loss' => ProfitLossScreen(session: session),
    '/reports/balance-sheet' => BalanceSheetScreen(session: session),
    '/reports/trial-balance' => TrialBalanceScreen(session: session),
    _ => stockReportScreen(session, href),
  };
}

/// Opens the phone screen for a website link, or its automatic read-only list. Returns false when
/// the link has neither (the caller then opens a tab or the website).
bool openKnownScreen(BuildContext context, AppSession session, String href, String label) {
  final navigator = Navigator.of(context);
  final screen = nativeScreenFor(session, href);
  if (screen != null) {
    navigator.push(MaterialPageRoute<void>(builder: (_) => screen));
    return true;
  }
  final page = pageForHref(href)?.withTitle(label);
  if (page != null) {
    navigator.push(MaterialPageRoute<void>(builder: (_) => RecordPage(session: session, page: page)));
    return true;
  }
  return false;
}

/// Opens any website link on the phone: its screen, its automatic list, or the website page inside
/// the app, signed in. The More menu and the reports overview both come through here.
void openAppHref(BuildContext context, AppSession session, String href, String label) {
  if (!openKnownScreen(context, session, href, label)) openWebsiteInApp(context, session, href, label);
}

/// Which of the five homes a link has. Tabs and the website decisions come before screens, so a
/// link listed in [websiteByDesign] reports `website` even where a small info screen answers it.
RouteTier routeTier(AppSession session, String href) {
  if (_tabHrefs.contains(href)) return RouteTier.tab;
  if (websiteByDesign.contains(href) || websiteForNow.contains(href)) return RouteTier.website;
  if (nativeScreenFor(session, href) != null) return RouteTier.native;
  if (isWebsiteOnlyHref(href) || pageForHref(href) == null) return RouteTier.website;
  return RouteTier.generic;
}
