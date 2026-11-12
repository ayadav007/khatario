import 'walk_data_core.dart';
import 'walk_fixtures.dart';

// Sample rows copied from the per-screen tests (sales_docs, sales_orders, challans_work_orders, credit_debit_notes,
// approvals_recurring_reminders, reminders_reconciliation, orders_golden), so each has the fields its screen reads.

Map<String, dynamic> _estimate(String id, String number) => {
      'id': id,
      'customer_name': 'Asha',
      'customer_id': 'c1',
      'estimate_number': number,
      'invoice_number': number,
      'estimate_date': '2026-11-01',
      'invoice_date': '2026-11-01',
      'expiry_date': null,
      'status': 'final',
      'estimate_status': 'sent',
      'document_type': 'proforma_invoice',
      'grand_total': '1180.50',
      'converted_invoice_id': null,
    };

Map<String, dynamic> _salesOrderRow(String id, String number) => {
      'id': id,
      'customer_id': 'c1',
      'customer_name': 'Asha',
      'order_number': number,
      'order_date': '2026-11-01',
      'expected_delivery_date': null,
      'status': 'confirmed',
      'grand_total': '1180.50',
      'converted_invoice_id': null,
      'total_paid': '0',
      'payment_remaining': '1180.50',
      'linked_invoice_count': 0,
      'latest_invoice_id': null,
      'latest_invoice_number': null,
    };

Map<String, dynamic> _salesOrder(String id, String number) => {
      'id': id,
      'customer_id': 'c1',
      'customer_name': 'Asha',
      'order_number': number,
      'order_date': '2026-11-01',
      'expected_delivery_date': '2026-11-09',
      'status': 'confirmed',
      'converted_invoice_id': null,
      'editable': true,
      'subtotal': '1000.00',
      'discount_total': '0',
      'tax_total': '180.00',
      'round_off': '0',
      'additional_charges': '0',
      'grand_total': '1180.00',
      'notes': 'Deliver Monday',
      'terms': 'Net 7',
      'billing_address': '12 MG Road',
      'items': [
        {
          'id': 'l1',
          'item_id': 'it1',
          'item_name': 'Widget',
          'qty': '2',
          'fulfilled_qty': '0',
          'unit': 'PCS',
          'unit_price': '500',
          'discount_percent': '0',
          'tax_rate': '18',
          'line_total': '1180.00',
        },
      ],
    };

Map<String, dynamic> _challan(String id, String number) => {
      'id': id,
      'customer_id': 'c1',
      'customer_name': 'Asha',
      'challan_number': number,
      'challan_date': '2026-11-01',
      'delivery_date': null,
      'status': 'sent',
      'challan_kind': 'supply',
      'purpose': '',
      'stock_posted_at': null,
      'closed_at': null,
      'stock_transfer_id': null,
      'invoice_id': null,
      'invoice_number': null,
      'sales_order_id': null,
      'supplier_id': null,
      'warehouse_id': null,
      'expected_return_date': null,
      'job_work_goods': null,
      'e_way_bill_number': null,
      'vehicle_number': 'MH12AB1234',
      'transporter_name': 'Fast Cargo',
      'transporter_gstin': null,
      'shipping_address': '12 MG Road',
      'billing_address': '12 MG Road',
      'place_of_delivery': 'Pune',
      'place_of_supply_state_code': '27',
      'dispatch_from_address': null,
      'reason_for_transportation': 'supply',
      'notes': 'Handle with care',
      'terms': 'Net 7',
      'branch_id': 'br1',
      'subtotal': '1000.00',
      'cgst_total': '90.00',
      'sgst_total': '90.00',
      'igst_total': '0.00',
      'tax_total': '180.00',
      'grand_total': '1180.00',
      'created_at': '2026-11-01T05:00:00.000Z',
    };

Map<String, dynamic> _challanItem() => {
      'id': 'l1',
      'item_id': 'it1',
      'item_name': 'Widget',
      'description': '',
      'hsn_sac': '8517',
      'qty': '2',
      'unit': 'PCS',
      'unit_price': '500',
      'tax_rate': '18',
      'line_total': '1180.00',
      'qty_returned': '0',
      'qty_invoiced': '0',
      'qty_written_off': '0',
      'qty_open': '2',
    };

Map<String, dynamic> _workOrder(String id, String number) => {
      'id': id,
      'customer_id': 'c1',
      'customer_name': 'Asha',
      'work_order_number': number,
      'work_order_date': '2026-11-01',
      'scheduled_start_date': '2026-11-03',
      'scheduled_end_date': '2026-11-05',
      'status': 'in_progress',
      'priority': 'high',
      'work_description': 'Fix the AC',
      'work_location': 'Shop 4, MG Road',
      'assigned_to': 'Ravi',
      'labor_cost': '500.00',
      'material_cost': '1000.00',
      'other_cost': '50.00',
      'total_cost': '1550.00',
      'estimated_hours': '4.00',
      'actual_hours': null,
      'labor_sac': '9987',
      'labor_tax_rate': '18.00',
      'place_of_supply_state_code': '27',
      'notes': 'Call first',
      'terms': 'Warranty 30 days',
      'converted_invoice_id': null,
      'converted_invoice_number': null,
      'converted_invoice_status': null,
      'created_at': '2026-11-01T05:00:00.000Z',
    };

Map<String, dynamic> _noteItem() => {
      'id': 'l1',
      'item_id': 'it1',
      'item_name': 'Widget',
      'description': 'Widget',
      'qty': '2',
      'unit': 'PCS',
      'unit_price': '500',
      'tax_rate': '18',
      'hsn_sac': '8517',
      'line_total': '1180.00',
    };

Map<String, dynamic> _creditNote(String id, String number) => {
      'id': id,
      'customer_id': 'c1',
      'customer_name': 'Asha',
      'invoice_id': 'i1',
      'invoice_number': 'INV-5',
      'credit_note_number': number,
      'credit_note_date': '2026-11-01',
      'note_type': 'sales_return',
      'supply_period_from': null,
      'supply_period_to': null,
      'reason': 'Damaged goods',
      'status': 'active',
      'cancellation_reason': null,
      'refund_status': 'pending',
      'subtotal': '1000.00',
      'cgst_total': '90.00',
      'sgst_total': '90.00',
      'igst_total': '0.00',
      'tax_total': '180.00',
      'round_off': '0.00',
      'grand_total': '1180.00',
      'notes': 'Box crushed',
      'created_at': '2026-11-01T05:00:00.000Z',
    };

Map<String, dynamic> _debitNote(String id, String number) => {
      'id': id,
      'customer_id': 'c1',
      'customer_name': 'Asha',
      'invoice_id': null,
      'invoice_number': null,
      'debit_note_number': number,
      'debit_note_date': '2026-11-02',
      'reason': 'Freight charged extra',
      'status': 'active',
      'cancellation_reason': null,
      'adjustment_status': 'pending',
      'subtotal': '500.00',
      'cgst_total': '0.00',
      'sgst_total': '0.00',
      'igst_total': '90.00',
      'round_off': '0.00',
      'grand_total': '590.00',
      'created_at': '2026-11-02T05:00:00.000Z',
    };

Map<String, dynamic> _recurring() => {
      'id': 'r1',
      'customer_id': 'c1',
      'customer_name': 'Asha',
      'template_invoice_number': 'INV-3',
      'frequency': 'monthly',
      'interval_value': 1,
      'start_date': '2026-10-01',
      'end_date': null,
      'next_run_date': '2026-12-01',
      'last_run_date': '2026-11-01',
      'is_active': true,
      'auto_finalize': false,
      'last_error': null,
      'invoices_raised': 2,
    };

Map<String, dynamic> _approval() => {
      'id': 'a1',
      'entity_type': 'customer',
      'entity_id': 'c1',
      'reference_type': 'invoice',
      'reference_id': 'i1',
      'status': 'pending',
      'reason': 'Big order',
      'entity_name': 'Asha',
      'reference_number': 'INV-9',
      'reference_amount': '12500.00',
      'requested_by_name': 'Ravi',
      'created_at': walkNow,
    };

Map<String, dynamic> _storeOrder() => {
      'source_type': 'store_order',
      'source_id': 'o1',
      'channel': 'online_store',
      'order_number': 'ST-104',
      'invoice_id': 'i1',
      'invoice_number': 'INV-88',
      'customer_name': 'Asha Rao',
      'customer_phone': '98765 43210',
      'amount': 1180,
      'payment_status': 'cod',
      'delivery_status': 'confirmed',
      'created_at': walkNow,
    };

Map<String, dynamic> _paymentTx(String id) => {
      'id': id,
      'order_id': 'a1b2c3d4-0000-4000-8000-000000000001',
      'amount': '1180.00',
      'currency': 'INR',
      'status': 'requires_review',
      'method': 'upi',
      'provider': 'razorpay',
      'utr': 'UTR123',
      'provider_payment_id': null,
      'raw_payload': {
        'webhook_validation': {'ok': false, 'reason': 'amount_mismatch'},
        'gateway_note': 'hello-gateway',
      },
      'created_at': '2026-11-01T05:00:00.000Z',
      'updated_at': '2026-11-02T05:00:00.000Z',
      'order_payment_status': 'unpaid',
    };

void registerSales(WalkFixtures f) {
  f.get('/api/estimates', walkList([_estimate('e1', 'QT-1'), _estimate('e2', 'QT-2')], ['estimates']));
  f.get('/api/sales-orders', walkList([_salesOrderRow('so1', 'SO-1')], ['salesOrders']));
  f.get('/api/sales-orders/:id', {'salesOrder': _salesOrder('so1', 'SO-1')});
  f.get('/api/sales-orders/:id/payment-summary', {
    'grand_total': 1180,
    'total_paid': 500,
    'remaining': 680,
    'payment_status': 'partial',
    'order_status': 'confirmed',
    'order_number': 'SO-1',
    'payment_amount_eps': 0.01,
  });
  f.get('/api/delivery-challans', {
    'deliveryChallans': [_challan('dc1', 'DC-1'), _challan('dc2', 'DC-2')],
  });
  f.get('/api/delivery-challans/next-number', {'challan_number': 'DC-3', 'next_number': 'DC-3'});
  f.get('/api/delivery-challans/:id', {
    'deliveryChallan': _challan('dc1', 'DC-1'),
    'items': [_challanItem()],
    'ewayBills': <Object>[],
  });
  f.get('/api/work-orders', {
    'workOrders': [_workOrder('wo1', 'WO-1')],
  });
  f.get('/api/work-orders/next-number', {'work_order_number': 'WO-2', 'next_number': 'WO-2'});
  f.get('/api/work-orders/:id', {
    'workOrder': _workOrder('wo1', 'WO-1'),
    'items': [
      {
        'id': 'm1',
        'item_id': 'it1',
        'item_name': 'Widget',
        'description': '',
        'hsn_sac': '8517',
        'qty': '2',
        'unit': 'PCS',
        'unit_price': '500',
        'tax_rate': '18',
        'total_cost': '1000.00',
      },
    ],
  });
  f.get('/api/credit-notes', (u) {
    if (u.queryParameters['next_number'] == '1') return {'next_credit_note_number': 'CN-2'};
    return walkList([_creditNote('cn1', 'CN-1')], ['creditNotes']);
  });
  f.get('/api/debit-notes', (u) {
    if (u.queryParameters['next_number'] == '1') return {'next_debit_note_number': 'DN-2'};
    return walkList([_debitNote('dn1', 'DN-1')], ['debitNotes']);
  });
  f.get('/api/documents/credit_notes/:id', {'document': _creditNote('cn1', 'CN-1'), 'items': [_noteItem()]});
  f.get('/api/documents/debit_notes/:id', {'document': _debitNote('dn1', 'DN-1'), 'items': [_noteItem()]});
  f.get('/api/documents', {'documents': <Object>[]});
  f.get('/api/recurring-invoices', {
    'recurringInvoices': [_recurring()],
  });
  f.get('/api/recurring-invoices/:id', {
    'recurringInvoice': _recurring(),
    'history': [
      {'id': 'i10', 'invoice_number': 'INV-10', 'invoice_date': '2026-11-01', 'grand_total': 1180, 'status': 'final'},
    ],
  });
  f.get('/api/credit-approvals/pending', {
    'approvals': [_approval()],
  });
  f.get('/api/orders', {
    'orders': [
      _storeOrder(),
      {
        ..._storeOrder(),
        'source_id': 'o2',
        'order_number': 'WA-17',
        'channel': 'whatsapp',
        'customer_name': 'Vikram Shah',
        'amount': 640,
        'payment_status': 'paid',
        'delivery_status': 'delivery_failed',
      },
    ],
    'total': 2,
    'needs': {'to_confirm': 0, 'payment_pending': 1, 'to_pack': 3, 'to_dispatch': 1, 'delivery_failed': 1, 'stale': 0, 'in_transit_late': 0},
  });
  f.get('/api/orders/settings', {'settings': {}, 'auto_confirm': false});
  f.get('/api/orders/:source/:id', {
    'order': _storeOrder(),
    'lines': [
      {'line_id': 'l1', 'name': 'Cotton shirt', 'quantity': 2, 'amount': 1000},
      {'line_id': 'l2', 'name': 'Cap', 'quantity': 1, 'amount': 180},
    ],
    'ship_to': {'address': '12 MG Road, Pune', 'pincode': '411001'},
    'fulfilments': [
      {
        'id': 'f1',
        'seq': 1,
        'status': 'confirmed',
        'method': null,
        'cod_amount': 1180,
        'cod_collected_at': null,
        'packages': 1,
        'items': [
          {'line_id': 'l1', 'name': 'Cotton shirt', 'quantity': 2},
          {'line_id': 'l2', 'name': 'Cap', 'quantity': 1},
        ],
        'events': [
          {'status': 'confirmed', 'note': 'Order confirmed', 'created_at': walkNow},
        ],
      },
    ],
  });
  f.get('/api/returns', {
    'returns': <Object>[],
    'counts': {'requested': 1},
  });
  f.get('/api/payments', (u) {
    if (u.queryParameters.containsKey('type')) {
      return {
        'payments': [
          {
            'id': 'p1',
            'payment_number': 'PAY-1',
            'amount': 1180,
            'customer_name': 'Anil Traders',
            'supplier_name': 'Bharat Wholesale',
            'payment_date': '2026-11-01',
            'payment_method': 'upi',
            'status': 'completed',
            'invoice_number': 'INV-035',
          },
        ],
      };
    }
    return {
      'payment_transactions': [_paymentTx('t1'), _paymentTx('t2')],
    };
  });
  f.get('/api/whatsapp/status', {'connected': true, 'status': 'connected', 'phone': '9876543210', 'enabled': true, 'configured': true});
  f.get('/api/whatsapp/reminders', {'settings': {}, 'enabled': true, 'reminders': <Object>[]});
}
