import 'dart:convert';
import 'dart:io';

import 'walk_data_books.dart';
import 'walk_data_connect.dart';
import 'walk_data_core.dart';
import 'walk_data_hr.dart';
import 'walk_data_sales.dart';
import 'walk_data_settings.dart';
import 'walk_data_stock.dart';
import 'walk_fixtures.dart';

/// A fixture under test/fixtures/reports, written from the real route's reply.
Object? _report(String name) => jsonDecode(File('test/fixtures/reports/$name.json').readAsStringSync());

void registerWalkFixtures(WalkFixtures f) {
  registerCore(f);
  registerSales(f);
  registerStock(f);
  registerBooks(f);
  registerSettings(f);
  registerHr(f);
  registerConnect(f);
  _reports(f);
}

void _reports(WalkFixtures f) {
  const files = {
    '/api/reports/gst/gstr1': 'gstr1',
    '/api/reports/gst/gstr1/filings': 'gstr1_filings',
    '/api/reports/gst/gstr2b': 'gstr2b',
    '/api/reports/gst/gstr3b': 'gstr3b',
    '/api/reports/gst/reconciliation': 'gst_reconciliation',
    '/api/gst/gstr2b/reconcile': 'gstr2b_reconcile',
    '/api/gst/cash-ledger': 'gst_cash_ledger',
    '/api/gst/compliance-alerts': 'gst_compliance_alerts',
    '/api/reports/credit-risk': 'credit_risk',
    '/api/reports/deleted-items': 'deleted_items',
    '/api/reports/inter-branch-reconciliation': 'inter_branch',
    '/api/reports/label-print-log': 'label_print_log',
    '/api/reports/profit-by-invoice': 'profit_by_invoice',
    '/api/reports/purchase/credit': 'purchase_credit',
    '/api/reports/purchase/invoice-wise': 'purchase_invoice_wise',
    '/api/reports/purchase/item-wise': 'purchase_item_wise',
    '/api/reports/purchase/returns': 'purchase_returns',
    '/api/reports/purchase/summary': 'purchase_summary',
    '/api/reports/purchase/supplier-wise': 'purchase_supplier_wise',
    '/api/reports/purchase/tax-wise': 'purchase_tax_wise',
    '/api/reports/sales/b2b-b2c': 'sales_b2b_b2c',
    '/api/reports/sales/cancelled': 'sales_cancelled',
    '/api/reports/sales/credit': 'sales_credit',
    '/api/reports/sales/discount': 'sales_discount',
    '/api/reports/sales/invoice-wise': 'sales_invoice_wise',
    '/api/reports/sales/item-wise': 'sales_item_wise',
    '/api/reports/sales/party-wise': 'sales_party_wise',
    '/api/reports/sales/payment-mode': 'sales_payment_mode',
    '/api/reports/sales/returns': 'sales_returns',
    '/api/reports/sales/summary': 'sales_summary',
    '/api/reports/sales/tax-wise': 'sales_tax_wise',
    '/api/reports/stock/bank-statement': 'stock_bank_statement',
    '/api/reports/stock/closing-stock': 'stock_closing',
    '/api/reports/stock/fifo-lots': 'stock_fifo_lots',
    '/api/reports/stock/job-work': 'stock_job_work',
    '/api/reports/stock/quantitative': 'stock_quantitative',
    '/api/reports/stock/summary': 'stock_summary',
    '/api/reports/stock/third-party': 'stock_third_party',
    '/api/reports/stock/valuation': 'stock_valuation',
    '/api/eway-bills': 'eway_bills',
  };
  for (final e in files.entries) {
    f.get(e.key, (_) => _report(e.value));
  }
}
