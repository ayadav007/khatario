import 'dart:convert';
import 'dart:io';

import 'walk_data_core.dart';
import 'walk_fixtures.dart';

// Accounting, expenses and purchases. Rows copied from books_test, bank_recon_test, contra_advances_test,
// assets_provisions_test, journal_list_test, activity_logs_test, expenses_test and the purchase area's own field names.

Map<String, dynamic> _account(String id, String code, String name, String type, String group) => {
      'id': id,
      'account_code': code,
      'account_name': name,
      'account_type': type,
      'account_group_id': 'g1',
      'account_group_name': group,
      'nature': type == 'asset' || type == 'expense' ? 'debit' : 'credit',
      'is_active': true,
      'is_system': false,
      'current_balance': '12500.00',
      'opening_balance': '0.00',
      'description': null,
    };

Map<String, dynamic> _ledgerRow(String id) => {
      'id': id,
      'entry_date': '2026-11-03T00:00:00.000Z',
      'account_id': 'a2',
      'account_code': '1002',
      'account_name': 'Petty cash',
      'voucher_id': 'v1',
      'voucher_number': 'INV-7',
      'voucher_type': 'invoice',
      'voucher_types': ['invoice'],
      'reference_number': 'INV-7',
      'narration': 'Sale INV-7',
      'debit': 500,
      'credit': 0,
      'running_balance': 500,
    };

Map<String, dynamic> _purchase(String id, String number) => {
      'id': id,
      'supplier_id': 's1',
      'supplier_name': 'Bharat Wholesale',
      'bill_number': number,
      'bill_date': '2026-11-03',
      'status': 'final',
      'payment_status': 'unpaid',
      'grand_total': '5900.00',
      'paid_amount': '0.00',
      'balance_amount': '5900.00',
      'order_number': number,
      'order_date': '2026-11-03',
      'return_number': number,
      'return_date': '2026-11-03',
      'refund_status': 'pending',
      'items': [
        {'id': 'pl1', 'item_id': 'item1', 'item_name': 'BIRYANI RICE', 'quantity': 10, 'qty': 10, 'unit': 'KGS', 'unit_price': 500, 'rate': 500, 'tax_rate': 18, 'line_total': 5900, 'total': 5900},
      ],
    };

void registerBooks(WalkFixtures f) {
  final accounts = [
    _account('a1', '1001', 'Cash in hand', 'asset', 'Cash'),
    _account('a2', '1002', 'Petty cash', 'asset', 'Cash'),
    _account('a3', '4001', 'Sales', 'income', 'Direct income'),
  ];
  f.get('/api/accounts', walkList(accounts, ['accounts']));
  f.get('/api/accounts/my-accounts', {'accounts': accounts});
  f.get('/api/accounts/groups', {
    'groups': [
      {'id': 'g1', 'group_name': 'Cash', 'name': 'Cash', 'account_type': 'asset', 'parent_group_id': null},
    ],
  });
  f.get('/api/accounts/:id', {'account': accounts.first});
  f.get('/api/accounting/settlement-accounts', {
    'mode_class': 'cash',
    'accounts': [
      {'id': 'a1', 'account_code': '1001', 'account_name': 'Cash in hand', 'kind': 'cash'},
    ],
    'default_account_id': 'a1',
    'selection_required': false,
  });
  f.get('/api/ledger', walkList([_ledgerRow('e1'), _ledgerRow('e2')], ['entries']));
  f.get('/api/ledger/account/:id', {
    'account': accounts[1],
    'entries': [_ledgerRow('e1')],
    'opening_balance': 0,
    'closing_balance': 500,
    'summary': {'total_debit': 500, 'total_credit': 0},
  });
  f.get('/api/journal-entries', walkList([
    {
      'id': 'je1',
      'voucher_id': 'v1',
      'voucher_number': 'JV/2026/000007',
      'entry_date': '2026-11-03',
      'reference_number': 'R-1',
      'narration': 'Rent',
      'is_locked': false,
      'is_reversed': false,
      'is_reversing': false,
      'reverses_entry_id': null,
      'debit': '5000.00',
      'credit': '5000.00',
    },
  ], ['entries', 'journalEntries']));
  final jLines = [
    {'account_id': 'a-rent', 'account_name': 'Rent', 'debit': '5000.00', 'credit': '0.00', 'narration': 'Nov rent', 'reference_number': 'REF-1'},
    {'account_id': 'a-cash', 'account_name': 'Cash', 'debit': '0.00', 'credit': '5000.00', 'narration': null},
  ];
  f.get('/api/journal-entries/templates', {
    'templates': [
      {'id': 'jt1', 'template_name': 'Monthly rent', 'name': 'Monthly rent', 'is_active': true, 'lines': jLines},
    ],
  });
  f.get('/api/journal-entries/templates/:id', {
    'template': {'id': 'jt1', 'template_name': 'Monthly rent', 'name': 'Monthly rent', 'is_active': true, 'lines': jLines},
    'lines': jLines,
  });
  f.get('/api/journal-entries/:id', {
    'entry': {
      'id': 'je1',
      'voucher_id': 'v1',
      'voucher_number': 'JV/2026/000007',
      'entry_date': '2026-11-03',
      'reference_number': 'R-1',
      'narration': 'Rent',
      'is_locked': false,
      'is_reversed': false,
    },
    'lines': jLines,
    'reversal': null,
  });
  f.get('/api/activity-logs', {
    'logs': [
      {
        'id': 'l1',
        'created_at': '2026-11-09T10:00:00.000Z',
        'action_type': 'create',
        'module': 'invoices',
        'user_name': 'Asha',
        'user_id': 'u1',
        'description': 'Created invoice INV-035',
      },
    ],
    'users': [
      {'id': 'u1', 'name': 'Asha'},
    ],
  });
  f.get('/api/settings/activity-logs', {'enabled': true, 'retention_days': 90});
  f.get('/api/contra', {
    'vouchers': [
      {
        'id': 'cv1',
        'voucher_number': 'CV-1',
        'entry_date': '2026-11-02',
        'from_account_name': 'Cash in hand',
        'to_account_name': 'HDFC Current',
        'amount': '5000.00',
        'narration': 'Deposit',
      },
    ],
    'accounts': [
      {'id': 'c1', 'code': '1101', 'name': 'Cash in hand', 'kind': 'cash'},
      {'id': 'b1', 'code': '1102', 'name': 'HDFC Current', 'kind': 'bank'},
    ],
  });
  f.get('/api/advances', {
    'advances': [
      {
        'id': 'ad1',
        'advance_number': 'ADV-1',
        'party_name': 'Anil Traders',
        'customer_name': 'Anil Traders',
        'supplier_name': null,
        'advance_date': '2026-11-01',
        'amount': '3000.00',
        'balance': '3000.00',
        'unadjusted_amount': '3000.00',
        'status': 'open',
        'payment_mode': 'cash',
      },
    ],
    'accounts': [
      {'id': 'c1', 'code': '1101', 'name': 'Cash in hand', 'kind': 'cash'},
    ],
  });
  f.get('/api/advances/:id', {
    'advance': {'id': 'ad1', 'advance_number': 'ADV-1', 'party_name': 'Anil Traders', 'amount': '3000.00', 'balance': '3000.00', 'status': 'open'},
    'adjustments': <Object>[],
    'open_documents': [
      {'id': 'i1', 'document_number': 'INV-035', 'invoice_number': 'INV-035', 'balance_amount': '74.00', 'grand_total': '74.00'},
    ],
  });
  f.get('/api/fixed-assets', {
    'assets': [
      {
        'id': 'fa1',
        'asset_code': 'FA-001',
        'asset_name': 'Laptop',
        'put_to_use_on': '2026-04-10',
        'purchase_cost': '60000.00',
        'depreciation_method': 'SLM',
        'useful_life_years': 3,
        'depreciation_rate': null,
        'current_book_value': '52000.00',
        'accumulated_depreciation': '8000.00',
        'is_disposed': false,
        'last_depreciated_to': '2026-09-30',
      },
    ],
  });
  f.get('/api/fixed-assets/it-depreciation', {
    'rows': [
      {'block': 'computers', 'rate': 40, 'opening_wdv': '60000.00', 'additions': '0.00', 'depreciation': '24000.00', 'closing_wdv': '36000.00'},
    ],
  });
  f.get('/api/fixed-assets/depreciation-schedule', {
    'schedule': [
      {'period': '2026-27', 'opening': '60000.00', 'depreciation': '20000.00', 'closing': '40000.00'},
    ],
  });
  f.get('/api/provisions', {
    'provisions': [
      {
        'id': 'p1',
        'provision_code': 'PROV-1',
        'provision_name': 'Bad debts',
        'provision_type': 'bad_debts',
        'calculation_method': 'percentage',
        'calculation_rate': '5.00',
        'description': 'Doubtful receivables',
        'current_balance': '2500.00',
        'entries_count': 1,
      },
    ],
  });
  f.get('/api/provisions/:id/entries', {
    'entries': [
      {'id': 'pe1', 'entry_date': '2026-11-01', 'amount': '2500.00', 'narration': 'Q2 provision', 'voucher_number': 'JV-9'},
    ],
  });
  f.get('/api/tds/transactions', walkList([_tds()], ['transactions', 'rows']));
  f.get('/api/tds/payments', walkList([_tds()], ['payments', 'rows']));
  f.get('/api/tds/certificates', walkList([_tds()], ['certificates', 'rows']));
  f.get('/api/tds/categories', walkList([
    {'id': 'tc1', 'section': '194C', 'name': 'Contractors', 'rate': '1.00', 'category_name': 'Contractors', 'is_active': true},
  ], ['categories', 'rows']));
  f.get('/api/tds/reports/summary', {
    'summary': {'total_deducted': '1200.00', 'total_deposited': '800.00', 'pending': '400.00'},
    'total_deducted': '1200.00',
    'total_deposited': '800.00',
    'pending': '400.00',
  });
  f.get('/api/bank-accounts', {
    'accounts': [
      {'id': 'ba1', 'bank_name': 'HDFC', 'account_name': 'Current', 'ledger_account_id': 'g1', 'ledger_account_name': 'HDFC Bank'},
    ],
  });
  f.get('/api/bank/reconciliation', (u) {
    if (u.queryParameters.containsKey('bank_statement_id')) {
      return {
        'statement': {'id': 's1', 'bank_account_id': 'ba1', 'period_start': '2026-10-01', 'period_end': '2026-10-31', 'status': 'open'},
        'lines': [
          {
            'id': 'l1',
            'transaction_date': '2026-10-05',
            'description': 'ATM CHARGES 5001234567890',
            'debit_amount': '118.00',
            'credit_amount': '0.00',
            'match_status': 'unmatched',
            'matched_ledger_ids': <Object>[],
            'age_days': 40,
            'is_duplicate': false,
            'extracted_references': {'long_numeric_refs': ['5001234567890'], 'cheque_refs': <Object>[]},
          },
        ],
        'ledger_lines': [
          {'id': 'e1', 'entry_date': '2026-10-05', 'debit': '0.00', 'credit': '118.00', 'narration': 'ATM charges', 'reference_number': 'JV-1'},
        ],
        'suggestions': <Object>[],
        'summary': {'matched': 0, 'unmatched': 1},
      };
    }
    return {
      'statements': [
        {'id': 's1', 'bank_account_id': 'ba1', 'period_start': '2026-10-01', 'period_end': '2026-10-31', 'status': 'open', 'file_name': 'oct.csv', 'line_count': 1},
      ],
    };
  });

  f.get('/api/eway-bills/:id', (_) => jsonDecode(File('test/fixtures/reports/eway_bill.json').readAsStringSync()));

  // Expenses
  final categories = [
    {'id': 'c1', 'name': 'Rent', 'description': null, 'account_id': 'ac2', 'ledger_account_code': '5201', 'ledger_account_name': 'Rent expense'},
    {'id': 'c2', 'name': 'Travel', 'description': null, 'account_id': null, 'ledger_account_code': null, 'ledger_account_name': null},
  ];
  f.get('/api/expense-categories', {'categories': categories});
  f.get('/api/expense-items', {
    'items': [
      {'id': 'i1', 'name': 'Office rent', 'item_type': 'service', 'tax_rate': 18.0},
    ],
  });
  f.get('/api/expenses', {
    'expenses': [
      {
        'id': 'e1',
        'category_id': 'c1',
        'category_name': 'Rent',
        'amount': 1180,
        'description': 'Office rent for November',
        'expense_date': '2026-11-03T06:30:00.000Z',
        'created_at': '2026-11-09T08:00:00.000Z',
        'payment_mode': 'cash',
      },
    ],
  });
  f.get('/api/expenses/:id', {
    'expense': {
      'id': 'e1',
      'category_id': 'c1',
      'amount': '1180.00',
      'description': 'Rent',
      'expense_date': '2026-11-03',
      'payment_mode': 'cash',
      'settlement_account_id': 'a1',
      'reference_number': null,
      'supplier_id': null,
      'prices_include_gst': true,
      'cgst_amount': '90.00',
      'sgst_amount': '90.00',
      'igst_amount': '0.00',
      'updated_at': '2026-11-03 10:00:00.123456',
      'lines': [
        {'line_no': 1, 'expense_item_id': 'i1', 'item_name': 'Office rent', 'quantity': 1.0, 'unit_price': 1180.0, 'tax_rate': 18.0, 'line_total': 1180.0},
      ],
    },
  });
  f.get('/api/reports/expense/summary', {
    'totals': {'total_amount': 1480},
    'by_category': [
      {'category_name': 'Rent', 'total': 1180},
    ],
  });

  // Purchases
  f.get('/api/purchases', walkList([_purchase('pu1', 'BILL-1'), _purchase('pu2', 'BILL-2')], ['purchases']));
  f.get('/api/purchases/order-list', {
    'lines': [
      {'id': 'ol1', 'item_id': 'item1', 'item_name': 'BIRYANI RICE', 'qty': 10, 'unit': 'KGS', 'supplier_id': 's1', 'supplier_name': 'Bharat Wholesale', 'status': 'open', 'current_stock': 3, 'min_stock': 10},
    ],
    'items': [
      {'id': 'ol1', 'item_id': 'item1', 'item_name': 'BIRYANI RICE', 'qty': 10, 'unit': 'KGS', 'supplier_id': 's1', 'supplier_name': 'Bharat Wholesale', 'status': 'open'},
    ],
    'groups': <Object>[],
  });
  f.get('/api/purchases/incoming-bills', {
    'bills': [
      {
        'invoice_id': 'bill1',
        'id': 'bill1',
        'invoice_number': 'B-77',
        'invoice_date': '2026-10-17',
        'supplier_name': 'Sharma Traders',
        'supplier_id': 's1',
        'grand_total': 5940,
        'line_count': 2,
        'receipt_status': null,
        'purchase_id': null,
        'possible_duplicate': false,
      },
    ],
  });
  f.get('/api/purchases/incoming-bills/:id', {
    'bill': {
      'invoice_id': 'bill1',
      'invoice_number': 'B-77',
      'invoice_date': '2026-10-17',
      'supplier_name': 'Sharma Traders',
      'supplier_id': 's1',
      'tax_total': 0,
      'grand_total': 5940,
    },
    'lines': [
      {
        'invoice_item_id': 'l1',
        'item_name': 'PARLE G 50GM CTN',
        'quantity': 1,
        'unit': 'CTN',
        'unit_price': 1440,
        'line_total': 1440,
        'is_service': false,
        'match': {'item_id': 'a1', 'item_name': 'Parle-G 50g', 'unit': 'PCS', 'factor': 144, 'quantity': 144, 'rate': 10},
        'suggestions': <Object>[],
      },
    ],
    'purchase': null,
    'receipt_lines': <Object>[],
    'purchase_returns': <Object>[],
  });
  f.get('/api/purchases/:id', {'purchase': _purchase('pu1', 'BILL-1')});
  f.get('/api/purchases/:id/labels', {'labels': <Object>[], 'items': <Object>[]});
  f.get('/api/purchase-orders', walkList([_purchase('po1', 'PO-1')], ['purchaseOrders']));
  f.get('/api/purchase-orders/:id', {'purchaseOrder': _purchase('po1', 'PO-1')});
  f.get('/api/purchase-orders/:id/history', {'history': <Object>[]});
  f.get('/api/purchase-orders/:id/comments', {'comments': <Object>[]});
  f.get('/api/purchase-returns', walkList([_purchase('pr1', 'PR-1')], ['purchaseReturns']));
  f.get('/api/purchase-returns/:id', {'purchaseReturn': _purchase('pr1', 'PR-1')});
  f.get('/api/stock-requests', walkList(<Object>[], ['requests']));
}

Map<String, dynamic> _tds() => {
      'id': 'td1',
      'transaction_date': '2026-10-05',
      'payment_date': '2026-10-07',
      'deposit_date': '2026-10-07',
      'section': '194C',
      'party_name': 'Ganesh Fabricators',
      'deductee_name': 'Ganesh Fabricators',
      'pan': 'AAACG1234F',
      'gross_amount': '10000.00',
      'tds_amount': '100.00',
      'tds_rate': '1.00',
      'amount': '100.00',
      'challan_number': 'CH-1',
      'certificate_number': 'CERT-1',
      'quarter': 'Q3',
      'status': 'deducted',
      'category_name': 'Contractors',
    };
