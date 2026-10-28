import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/invoices/invoice_form_logic.dart';

InvoiceLineDraft line({
  double qty = 1,
  double price = 100,
  double tax = 18,
  bool fixed = false,
  double discount = 0,
  bool ruleDiscount = false,
  PricingScheme? scheme,
  String? item = 'soap',
}) =>
    InvoiceLineDraft(
      itemId: item,
      name: 'Soap',
      quantity: qty,
      unitPrice: price,
      taxRate: tax,
      priceFixed: fixed,
      discountPercent: discount,
      ruleDiscount: ruleDiscount,
      scheme: scheme,
    );

void main() {
  group('storedPriceToBillUnit', () {
    test('converts between GST bases', () {
      expect(storedPriceToBillUnit(118, true, 18, false), closeTo(100, 1e-9));
      expect(storedPriceToBillUnit(100, false, 18, true), closeTo(118, 1e-9));
      expect(storedPriceToBillUnit(118, true, 18, true), 118);
      expect(storedPriceToBillUnit(118, true, 0, false), 118);
    });
  });

  group('applyResolvedPrice', () {
    test('uses the customer price on the bill basis, with the rule discount and notes', () {
      final out = applyResolvedPrice(
        line(),
        {
          'price': 118,
          'gstIncluded': true,
          'priceSource': 'party',
          'discountPercent': 5,
          'lastSale': {'exclusivePrice': 98, 'discountPercent': 0, 'date': '2026-10-01'},
        },
        true,
      );
      expect(out.unitPrice, 118);
      expect(out.discountPercent, 5);
      expect(out.ruleDiscount, isTrue);
      expect(out.note, 'Customer price · Last ₹98.00 + GST on 2026-10-01');
    });

    test('clears a rule discount when the rule goes, and keeps a fixed line as it is', () {
      final cleared = applyResolvedPrice(line(discount: 5, ruleDiscount: true), {'price': 100}, false);
      expect(cleared.discountPercent, 0);
      expect(cleared.ruleDiscount, isFalse);

      final fixed = applyResolvedPrice(line(fixed: true, price: 77, discount: 2), {'price': 90, 'discountPercent': 10}, false);
      expect(fixed.unitPrice, 77);
      expect(fixed.discountPercent, 2);
    });

    test('warns below purchase price and notes MRP cap and scheme', () {
      final out = applyResolvedPrice(
        line(),
        {'price': 60, 'costPrice': 70, 'mrpCapped': true, 'scheme': {'buyQty': 10, 'freeQty': 1}},
        false,
      );
      expect(out.warning, 'Below purchase price');
      expect(out.note, 'Scheme: 1 free on every 10 · Capped at MRP');
      expect(out.scheme, const PricingScheme(10, 1));
    });
  });

  group('reconcileSchemeLines', () {
    const scheme = PricingScheme(10, 1);

    test('adds, resizes and removes the free line', () {
      final added = reconcileSchemeLines([line(qty: 25, scheme: scheme), line(item: 'oil')]);
      expect(added.map((l) => (l.name, l.quantity, l.unitPrice)).toList(), [
        ('Soap', 25.0, 100.0),
        ('Soap (free)', 2.0, 0.0),
        ('Soap', 1.0, 100.0),
      ]);
      expect(added[1].priceFixed, isTrue);

      final resized = reconcileSchemeLines([added[0].copyWith(quantity: 30), added[1]]);
      expect(resized[1].quantity, 3);

      expect(reconcileSchemeLines([added[0].copyWith(quantity: 5), added[1]]), hasLength(1));
      expect(reconcileSchemeLines([added[1]]), isEmpty);
    });

    test('leaves fixed lines without a free line', () {
      expect(reconcileSchemeLines([line(qty: 20, scheme: scheme, fixed: true)]), hasLength(1));
    });
  });
}
