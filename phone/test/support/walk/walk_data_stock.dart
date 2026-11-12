import 'walk_data_core.dart';
import 'walk_fixtures.dart';

// Sample rows copied from stock_transfers_test, stock_counts_test, stock_misc_test, stock_test and
// pricing_screens_widget_test.

const _p1 = 'c0000000-0000-4000-8000-000000000001';
const _i1 = 'a0000000-0000-4000-8000-000000000001';
const _v2 = 'b0000000-0000-4000-8000-000000000002';
const _l1 = 'd0000000-0000-4000-8000-000000000001';

Map<String, dynamic> _transfer(String id, String number) => {
      'id': id,
      'transfer_number': number,
      'transfer_date': '2026-11-05T00:00:00.000Z',
      'from_location_id': 'w1',
      'to_location_id': 'w2',
      'from_warehouse_name': 'Main godown',
      'to_warehouse_name': 'Back room',
      'status': 'draft',
      'notes': 'Festival stock',
      'created_at': '2026-11-05T05:00:00.000Z',
      'created_by_name': 'Asha',
      'approved_by_name': null,
      'approved_at': null,
      'delivery_challan_id': null,
      'delivery_challan_number': null,
    };

Map<String, dynamic> _transferItem() => {
      'id': 'ti1',
      'item_id': 'i1',
      'item_name': 'Rice',
      'qty': '10.00',
      'quantity_requested': '10.00',
      'quantity_dispatched': '0.000',
      'received_qty': null,
      'qty_short': '0.000',
      'short_reason': null,
      'claim_party': null,
      'unit': 'PCS',
      'notes': null,
    };

Map<String, dynamic> _countLine(String id, String name) => {
      'item_id': id,
      'item_name': name,
      'item_code': 'R1',
      'unit': 'KG',
      'book_qty': 10,
      'with_third_party_qty': 0,
      'in_transit_qty': 0,
      'held_qty': 0,
      'expected_qty': 10,
      'physical_qty': 9,
      'third_party_qty': 0,
      'difference': -1,
      'difference_value': -50,
      'recount_required': false,
      'recounted': false,
      'first_count_qty': null,
      'reason_code': null,
      'reason_notes': null,
      'needs_reason': false,
    };

Map<String, dynamic> _adjustment() => {
      'id': 'a1',
      'adjustment_number': 'ADJ-1',
      'adjustment_date': '2026-11-01',
      'adjustment_type': 'QUANTITY',
      'direction': 'DECREASE',
      'item_id': 'i1',
      'item_name': 'Rice',
      'item_code': 'RC',
      'item_unit': 'KG',
      'variant_name': null,
      'location_name': 'Main godown',
      'quantity_before': '10.000',
      'quantity_after': '8.000',
      'quantity_change': '-2.000',
      'unit_cost_before': '40.00',
      'unit_cost_after': '40.00',
      'total_value_before': '400.00',
      'total_value_after': '320.00',
      'reason_code': 'DAMAGE',
      'reason_notes': 'Wet bags',
      'notes': null,
      'repack_id': null,
      'created_by_name': 'Asha',
      'created_at': '2026-11-01T05:00:00.000Z',
    };

Map<String, dynamic> _repack() => {
      'id': 'r1',
      'repack_number': 'RPK-1',
      'repack_date': '2026-11-02',
      'status': 'posted',
      'source_item_id': 'bulk',
      'source_name': 'Rice',
      'source_unit': 'KG',
      'source_qty': 10,
      'packed_item_id': 'pack',
      'packed_name': 'Rice 1 kg pack',
      'packed_unit': 'PCS',
      'packed_qty': 9,
      'content_per_unit': 1,
      'wastage_qty': 1,
      'wastage_reason': 'SPILLAGE',
      'wastage_notes': null,
      'notes': null,
      'total_cost': 400,
      'unit_cost': 44.44,
      'location_name': 'Main godown',
      'branch_name': null,
      'created_by_name': 'Asha',
    };

Map<String, dynamic> _bom() => {
      'id': 'b1',
      'name': 'Biscuit batch',
      'output_item_id': 'i9',
      'output_item_name': 'Biscuits',
      'output_qty': '10.000',
      'is_active': true,
      'lines': [
        {'item_id': 'i1', 'item_name': 'Flour', 'unit': 'KG', 'role': 'input', 'qty': '20.000', 'recovery_rate': '0'},
        {'item_id': 'i3', 'item_name': 'Crumbs', 'unit': 'KG', 'role': 'scrap', 'qty': '1.000', 'recovery_rate': '12.00'},
      ],
    };

void registerStock(WalkFixtures f) {
  final warehouses = [
    {'id': 'w1', 'name': 'Main godown', 'warehouse_code': 'MG', 'is_active': true, 'branch_id': 'br1'},
    {'id': 'w2', 'name': 'Back room', 'warehouse_code': null, 'is_active': true, 'branch_id': 'br1'},
  ];
  f.get('/api/warehouses', {'warehouses': warehouses});
  f.get('/api/locations', {'locations': warehouses, 'warehouses': warehouses});
  f.get('/api/settings/warehouses', {'warehouses_enabled': true, 'auto_assign_branch_warehouses': false});
  f.get('/api/stock-transfers', {
    'transfers': [_transfer('t1', 'TRF-1'), _transfer('t2', 'TRF-2')],
  });
  f.get('/api/stock-transfers/:id/items', {
    'items': [_transferItem()],
  });
  f.get('/api/stock-counts', {
    'counts': [
      {
        'id': 'c1',
        'count_number': 'SC-1',
        'count_date': '2026-11-05',
        'status': 'counting',
        'blind': true,
        'freeze_stock': true,
        'warehouse_id': 'w1',
        'warehouse_name': 'Main godown',
        'branch_name': null,
        'lines': 2,
        'counted': 0,
      },
    ],
  });
  f.get('/api/stock-counts/:id', {
    'count': {
      'id': 'c1',
      'count_number': 'SC-1',
      'count_date': '2026-11-05',
      'status': 'counting',
      'warehouse_id': 'w1',
      'warehouse_name': 'Main godown',
      'freeze_stock': true,
    },
    'blind': true,
    'lines': [_countLine('i1', 'Rice'), _countLine('i2', 'Soap')],
    'with_third_party': [
      {'challan_id': 'ch1', 'item_id': 'i1', 'item_name': 'Rice', 'party_name': 'Ravi', 'purpose': 'repair', 'qty': 2, 'days_out': 4, 'overdue': false, 'challan_number': 'DC-3'},
    ],
    'in_transit': <Object>[],
    'inward_transit': <Object>[],
    'held': <Object>[],
    'others_goods': <Object>[],
    'units': [
      {'item_id': 'i2', 'unit': 'BOX', 'factor_to_base': 12},
    ],
    'summary': {
      'book_qty': 100,
      'with_third_party_qty': 2,
      'in_transit_qty': 0,
      'expected_qty': 98,
      'physical_qty': 90,
      'unexplained_qty': -8,
      'shortage_value': 400,
    },
  });
  f.get('/api/stock-counts/:id/barcodes', {
    'barcodes': {
      '890': {'item_id': 'i1', 'qty': 1, 'label': 'Rice (1 KG)'},
    },
  });
  f.get('/api/stock-holds', {
    'holds': [
      {
        'hold_id': 'h1',
        'hold_number': 'HOLD-0001',
        'item_id': 'i1',
        'item_name': 'Rice',
        'purpose': 'qc_hold',
        'hold_date': '2026-11-05',
        'qty': 5,
        'warehouse_id': 'w1',
        'warehouse_name': 'Main godown',
        'reference': null,
      },
    ],
  });
  f.get('/api/inward-custody', {
    'goods': [
      {
        'id': 'g1',
        'owner_name': 'Asha',
        'owner_type': 'other',
        'description': 'Motor for rewinding',
        'unit': 'PCS',
        'qty': 2,
        'received_date': '2026-11-01',
        'days_held': 9,
        'reason': 'repair',
        'warehouse_name': 'Main godown',
      },
    ],
  });
  f.get('/api/manufacturing/boms', {
    'boms': [_bom()],
  });
  f.get('/api/manufacturing/production', {
    'entries': [
      {
        'id': 'p1',
        'entry_number': 'PRD-0001',
        'entry_date': '2026-11-06',
        'output_item_name': 'Biscuits',
        'output_qty': '20.000',
        'input_cost': '1500.00',
        'recovery_value': '24.00',
        'output_cost': '1476.00',
        'lines': [
          {'item_name': 'Flour', 'role': 'input', 'qty': '40.000', 'value': '1200'},
          {'item_name': 'Crumbs', 'role': 'scrap', 'qty': '2.000', 'value': '24'},
        ],
      },
    ],
  });
  f.get('/api/insurance-claims', {
    'claims': [
      {
        'id': 'c1',
        'claim_number': 'CLM-0001',
        'loss_date': '2026-11-03',
        'cause': 'theft',
        'insurer': 'New India',
        'policy_number': 'P-77',
        'fir_number': 'FIR-12',
        'fir_date': '2026-11-04',
        'surveyor': 'Mr Rao',
        'loss_value': '4200.00',
        'claimed_amount': '5000.00',
        'admitted_amount': null,
        'settled_amount': null,
        'status': 'lodged',
        'write_offs': [
          {'id': 'a1', 'number': 'ADJ-1', 'item': 'Rice', 'qty': '20', 'value': '4200'},
        ],
      },
    ],
  });
  f.get('/api/insurance-claims/:id', {
    'claim': {'id': 'c1', 'claim_number': 'CLM-0001', 'status': 'lodged'},
  });
  f.get('/api/inventory-adjustments', walkList([_adjustment()], ['adjustments']));
  f.get('/api/inventory-adjustments/repacks', {
    'repacks': [_repack()],
  });
  f.get('/api/inventory-adjustments/repacks/prefill', {
    'source': {'id': 'bulk', 'name': 'Rice', 'unit': 'KG', 'stock': 50, 'unit_cost': 40, 'pack_source_item_id': null, 'pack_source_qty': null},
    'packed': {'id': 'pack', 'name': 'Rice 1 kg pack', 'unit': 'PCS', 'stock': 3, 'pack_source_item_id': 'bulk', 'pack_source_qty': 1},
    'content_per_unit': 1,
    'last': {'source_qty': 10, 'packed_qty': 9, 'wastage_reason': 'SPILLAGE'},
    'vendor_units': <Object>[],
  });
  f.get('/api/inventory-adjustments/repacks/:id', {'repack': _repack()});
  f.get('/api/inventory-adjustments/:id', {'adjustment': _adjustment()});

  // Pricing
  f.get('/api/pricing/party-item', {
    'overrides': [
      {'item_id': _i1, 'variant_id': null, 'price': 50, 'discount_percent': null, 'valid_from': null, 'valid_to': null},
    ],
    'variants': [
      {'id': _v2, 'item_id': 'i2', 'variant_name': 'Large', 'selling_price': 210},
    ],
    'price_level_id': null,
  });
  f.get('/api/pricing/party-category', {
    'categories': [
      {'id': 'f0000000-0000-4000-8000-000000000001', 'name': 'Grains'},
    ],
    'discounts': <Object>[],
  });
  f.get('/api/pricing/history', {
    'history': [
      {
        'id': 'h1',
        'scope': 'party_item',
        'changed_at': '2026-11-10T08:00:00Z',
        'item_name': 'Rice',
        'variant_name': null,
        'old_price': 45,
        'new_price': 50,
        'old_discount_percent': null,
        'new_discount_percent': null,
        'changed_by_name': 'Asha Owner',
        'category_name': null,
        'valid_from': null,
        'valid_to': null,
      },
    ],
  });
  f.get('/api/pricing/levels', {
    'levels': [
      {'id': _l1, 'name': 'Wholesale', 'description': null, 'is_active': true, 'customer_count': 3, 'rate_count': 7},
    ],
  });
  f.get('/api/pricing/levels/:id/rates', {
    'level': {'id': _l1, 'name': 'Wholesale'},
    'rates': [
      {'item_id': _i1, 'variant_id': null, 'min_qty': 10, 'price': 55, 'discount_percent': null, 'valid_from': null, 'valid_to': null},
    ],
    'variants': [
      {'id': _v2, 'item_id': 'i2', 'variant_name': 'Large', 'selling_price': 210},
    ],
    'customers': [
      {'id': _p1, 'name': 'Asha Traders'},
    ],
  });
  f.get('/api/pricing/schemes', {
    'schemes': [
      {
        'id': 'e0000000-0000-4000-8000-000000000001',
        'item_id': _i1,
        'variant_id': null,
        'price_level_id': null,
        'buy_qty': 10,
        'free_qty': 1,
        'valid_from': null,
        'valid_to': null,
        'is_active': true,
        'item_name': 'Rice',
        'variant_name': null,
        'level_name': null,
      },
    ],
    'variants': [
      {'id': _v2, 'item_id': 'i2', 'variant_name': 'Large'},
    ],
  });
  f.get('/api/label-templates', {
    'templates': [
      {'id': 'lt1', 'name': '50 x 25 mm', 'width_mm': 50, 'height_mm': 25, 'is_default': true},
    ],
  });
}
