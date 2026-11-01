import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/items/item_form_logic.dart';
import 'package:khatario_phone/screens/orders/orders_logic.dart';

void main() {
  group('ReturnWayForm.initial', () {
    const known = {'address': '12 MG Road', 'pincode': '411001', 'phone': '98765 43210', 'weight_kg': '0.500'};

    test('courier pickup only when Shiprocket is connected and the address and PIN are known', () {
      expect(ReturnWayForm.initial(shiprocketConnected: true, pickup: known).method, 'courier_pickup');
      expect(ReturnWayForm.initial(shiprocketConnected: false, pickup: known).method, 'customer_sends');
      expect(ReturnWayForm.initial(shiprocketConnected: true, pickup: {...known, 'pincode': ''}).method, 'customer_sends');
      expect(ReturnWayForm.initial(shiprocketConnected: true, pickup: {...known, 'address': ' '}).method, 'customer_sends');
      expect(ReturnWayForm.initial(shiprocketConnected: true).method, 'customer_sends');
    });

    test('starting a return leaves a blank address to the server', () {
      expect(ReturnWayForm.initial(shiprocketConnected: true, serverFillsPickup: true).method, 'courier_pickup');
      expect(ReturnWayForm.initial(shiprocketConnected: false, serverFillsPickup: true).method, 'customer_sends');
    });

    test('fills the saved details and drops trailing zeros from the weight', () {
      final f = ReturnWayForm.initial(shiprocketConnected: true, pickup: known, defaultInstructions: 'Send to the shop');
      expect(f.address, '12 MG Road');
      expect(f.weightKg, '0.5');
      expect(f.instructions, 'Send to the shop');
    });
  });

  group('ReturnWayForm body and error', () {
    test('courier pickup sends only the details that are filled', () {
      final f = ReturnWayForm(method: 'courier_pickup', address: ' 12 MG Road ', pincode: '411001');
      expect(f.body, {
        'method': 'courier_pickup',
        'pickup': {'address': '12 MG Road', 'pincode': '411001'},
      });
      expect(f.error, isNull);
    });

    test('customer sends carries the instructions; no return carries nothing else', () {
      expect(ReturnWayForm(method: 'customer_sends', instructions: ' Post it ').body, {'method': 'customer_sends', 'instructions': 'Post it'});
      expect(ReturnWayForm(method: 'customer_sends').body, {'method': 'customer_sends'});
      expect(ReturnWayForm(method: 'no_return', pincode: 'x').body, {'method': 'no_return'});
    });

    test('a typed PIN must be 6 digits and a typed weight must be above zero', () {
      expect(ReturnWayForm(method: 'courier_pickup', pincode: '4110').error, 'Enter a 6-digit PIN code');
      expect(ReturnWayForm(method: 'courier_pickup', weightKg: '0').error, 'Enter the parcel weight in kg');
      expect(ReturnWayForm(method: 'courier_pickup', pincode: '411001', weightKg: '1.2').error, isNull);
      expect(ReturnWayForm(method: 'customer_sends', pincode: '4110').error, isNull);
    });
  });

  test('a pickup is live only while a booked courier can still be called off', () {
    expect(hasLivePickup({'carrier_order_id': 'c1', 'pickup_status': 'booked'}), isTrue);
    expect(hasLivePickup({'carrier_order_id': 'c1', 'pickup_status': 'pickup_issue'}), isTrue);
    expect(hasLivePickup({'carrier_order_id': 'c1', 'pickup_status': 'in_transit'}), isFalse);
    expect(hasLivePickup({'carrier_order_id': 'c1', 'pickup_status': 'cancelled'}), isFalse);
    expect(hasLivePickup({'carrier_order_id': null, 'pickup_status': 'booked'}), isFalse);
  });

  test('the original-payment refund is the lesser of what is left and what the gateway can take back', () {
    expect(originalRefundAmount(1180, 1000), 1000);
    expect(originalRefundAmount(500, 1000), 500);
  });

  test('items are returnable online unless switched off', () {
    expect(itemCreateBody(name: 'Rice')['store_returnable'], isTrue);
    expect(itemCreateBody(name: 'Rice', storeReturnable: false)['store_returnable'], isFalse);
    expect(itemUpdateBody(existing: const {}, name: 'Rice', storeReturnable: false)['store_returnable'], isFalse);
  });
}
