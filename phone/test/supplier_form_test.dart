import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/parties/supplier_detail_screen.dart';
import 'package:khatario_phone/screens/parties/supplier_form_logic.dart';
import 'package:khatario_phone/screens/parties/supplier_form_screen.dart';
import 'package:khatario_phone/session.dart';

const _validGstin = '27AAPFU0939F1ZV';

class _Api extends KhatarioApi {
  _Api({this.business = const {'state': 'Gujarat'}, this.refuse, this.dedupe = false}) : super(Dio());

  final bool dedupe;
  final gets = <String>[];

  final Map<String, dynamic> business;
  final String? refuse;
  final posts = <String, Map<String, dynamic>>{};
  final puts = <String, Map<String, dynamic>>{};

  @override
  Future<Map<String, dynamic>> getJson(String path) async {
    gets.add(path);
    if (path.startsWith('/api/gstin/lookup')) {
      return {'legal_name': 'Acme Traders', 'address': '5 Mill Rd', 'city': 'Pune', 'state': 'Maharashtra', 'pincode': '411001'};
    }
    if (path.startsWith('/api/businesses/')) return {'business': business};
    if (path.startsWith('/api/suppliers/')) {
      return {
        'supplier': {'id': 's1', 'name': 'Acme', 'phone': '919876543210'},
        'purchases': [],
        'payments': [],
        'totalPayable': 0,
      };
    }
    return {};
  }

  @override
  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body, {Map<String, String>? headers}) async {
    if (refuse != null) throw ApiException(refuse!, status: 400);
    posts[path] = body;
    if (dedupe) return {'deduplicated': true, 'message': 'Existing supplier with this GSTIN returned.', 'supplier': {'id': 's9'}};
    return {
      'supplier': {'id': 's1'}
    };
  }

  @override
  Future<Map<String, dynamic>> putJson(String path, Map<String, dynamic> body) async {
    if (refuse != null) throw ApiException(refuse!, status: 400);
    puts[path] = body;
    return {
      'supplier': {'id': 's1'}
    };
  }
}

AppSession _session(_Api api, {Map<String, dynamic>? business}) => AppSession(api, {
      'user': {'id': 'u'},
      'business': business ?? {'id': 'b'},
    });

Future<void> _tall(WidgetTester t) async {
  t.view.physicalSize = const Size(800, 3200);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
}

Future<void> _open(WidgetTester t, AppSession s, {Map<String, dynamic>? supplier}) async {
  await _tall(t);
  await t.pumpWidget(MaterialApp(
    home: Builder(
      builder: (c) => TextButton(
        onPressed: () => Navigator.of(c).push(MaterialPageRoute(builder: (_) => SupplierFormScreen(session: s, supplier: supplier))),
        child: const Text('go'),
      ),
    ),
  ));
  await t.tap(find.text('go'));
  await t.pumpAndSettle();
}

/// The text box under the label [label].
Finder _field(String label) => find.descendant(
      of: find.ancestor(of: find.text(label), matching: find.byType(Column)).first,
      matching: find.byType(TextField),
    );

String _text(WidgetTester t, String label) => t.widget<TextField>(_field(label)).controller!.text;

void main() {
  group('logic', () {
    test('create body omits empty optionals and sends credit for To pay', () {
      final b = supplierBody(
        name: ' Acme ', phone: '', email: '', address: '', city: '', state: '', pincode: '', gstin: '', pan: '', openingBalance: '', toPay: true,
      );
      expect(b, {'name': 'Acme', 'opening_balance_type': 'credit'});
    });

    test('create body carries typed values, state code, upper-case tax ids and the debit side', () {
      final b = supplierBody(
        name: 'Acme', phone: '98765 43210', email: 'a@b.in', address: 'Lane 1', city: 'Surat', state: 'Gujarat', pincode: '395001',
        gstin: _validGstin.toLowerCase(), pan: 'aapfu0939f', openingBalance: '250.5', toPay: false,
      );
      expect(b['state'], 'Gujarat');
      expect(b['state_code'], '24');
      expect(b['gstin'], _validGstin);
      expect(b['pan'], 'AAPFU0939F');
      expect(b['opening_balance'], 250.5);
      expect(b['opening_balance_type'], 'debit');
      expect(b['phone'], '98765 43210');
      for (final k in ['business_id', 'user_id', 'created_by', 'notes', 'payment_terms']) {
        expect(b.containsKey(k), isFalse);
      }
    });

    test('edit body carries only changed keys', () {
      final existing = {
        'name': 'Acme', 'phone': '919876543210', 'city': 'Surat', 'state': 'Gujarat', 'opening_balance': '100.00', 'opening_balance_type': 'credit',
      };
      final same = supplierEditBody(
        existing: existing, name: 'Acme', phone: '919876543210', email: '', address: '', city: 'Surat', state: 'Gujarat', pincode: '',
        gstin: '', pan: '', openingBalance: '100', toPay: true,
      );
      expect(same, isEmpty);
      final changed = supplierEditBody(
        existing: existing, name: 'Acme Ltd', phone: '919876543210', email: '', address: '', city: 'Pune', state: 'Gujarat', pincode: '',
        gstin: '', pan: '', openingBalance: '100', toPay: true,
      );
      expect(changed, {'name': 'Acme Ltd', 'city': 'Pune'});
    });

    test('edit body sends both opening keys when either changes, and the state code with the state', () {
      final existing = {'name': 'Acme', 'state': 'Gujarat', 'opening_balance': 100, 'opening_balance_type': 'credit'};
      final b = supplierEditBody(
        existing: existing, name: 'Acme', phone: '', email: '', address: '', city: '', state: 'Kerala', pincode: '', gstin: '', pan: '',
        openingBalance: '100', toPay: false,
      );
      expect(b, {'state': 'Kerala', 'state_code': '32', 'opening_balance': 100, 'opening_balance_type': 'debit'});
    });

    test('validation messages', () {
      SupplierErrors v({String name = 'A', String phone = '', String gstin = '', String pan = '', String pincode = ''}) =>
          validateSupplier(name: name, phone: phone, gstin: gstin, pan: pan, pincode: pincode);
      expect(v(name: '').name, isNotNull);
      expect(v(phone: '123').phone, isNotNull);
      expect(v(phone: '+91 98765 43210').phone, isNull);
      expect(v(gstin: '27AAPFU0939F1Z1').gstin, isNotNull);
      expect(v(gstin: _validGstin).gstin, isNull);
      expect(v(pan: 'ABC').pan, isNotNull);
      expect(v(pan: 'AAPFU0939F').pan, isNull);
      expect(v(pincode: '12345').pincode, isNotNull);
      expect(v(pincode: '395001').pincode, isNull);
      expect(v().ok, isTrue);
    });

    test('opening balance text that is not a number is rejected', () {
      expect(parseAmount(''), 0);
      expect(parseAmount('12.5'), 12.5);
      expect(parseAmount('.'), isNull);
      expect(validateSupplier(name: 'A', phone: '', gstin: '', pan: '', pincode: '', openingBalance: '.').amount, 'Enter a valid amount');
    });

    test('default state is the business state, never Karnataka', () {
      expect(businessStateOf({'state': 'Gujarat'}), 'Gujarat');
      expect(businessStateOf({'state': 'gujarat '}), 'Gujarat');
      expect(businessStateOf({}), '');
      expect(businessStateOf({'state': 'Atlantis'}), '');
    });
  });

  group('screen', () {
    testWidgets('default state comes from the session business', (t) async {
      await _open(t, _session(_Api(), business: {'id': 'b', 'state': 'Kerala'}));
      expect(find.text('Kerala'), findsOneWidget);
      expect(find.text('Karnataka'), findsNothing);
    });

    testWidgets('default state falls back to the business record', (t) async {
      await _open(t, _session(_Api()));
      expect(find.text('Gujarat'), findsOneWidget);
    });

    testWidgets('create sends the right body once', (t) async {
      final api = _Api(business: const {});
      await _open(t, _session(api));
      await t.enterText(_field('Supplier name *'), 'Acme');
      await t.tap(find.text('Save supplier'));
      await t.tap(find.text('Save supplier'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(api.posts.keys, ['/api/suppliers']);
      expect(api.posts['/api/suppliers'], {'name': 'Acme', 'opening_balance_type': 'credit'});
    });

    testWidgets('invalid GSTIN shows an error and sends nothing', (t) async {
      final api = _Api(business: const {});
      await _open(t, _session(api));
      await t.enterText(_field('Supplier name *'), 'Acme');
      await t.enterText(_field('GSTIN'), '27AAPFU0939F1Z1');
      await t.tap(find.text('Save supplier'));
      await t.pumpAndSettle();
      expect(find.text('Enter a valid GSTIN'), findsOneWidget);
      expect(api.posts, isEmpty);
    });

    testWidgets('a valid GSTIN fills state and PAN', (t) async {
      await _open(t, _session(_Api(business: const {})));
      await t.enterText(_field('GSTIN'), _validGstin);
      await t.pumpAndSettle();
      expect(find.text('Maharashtra'), findsOneWidget);
      expect(_text(t, 'PAN'), 'AAPFU0939F');
    });

    testWidgets('a refused save shows the server text and keeps the fields', (t) async {
      final api = _Api(business: const {}, refuse: 'Opening balance cannot be modified once transactions exist for this supplier');
      await _open(t, _session(api), supplier: {'id': 's1', 'name': 'Acme', 'opening_balance': 0, 'opening_balance_type': 'credit'});
      await t.enterText(_field('Opening balance'), '50');
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      expect(find.textContaining('Opening balance cannot be modified'), findsOneWidget);
      expect(_text(t, 'Opening balance'), '50');
      expect(find.byType(SupplierFormScreen), findsOneWidget);
    });

    testWidgets('edit is prefilled and sends only changed keys', (t) async {
      final api = _Api();
      await _open(t, _session(api), supplier: {
        'id': 's1', 'name': 'Acme', 'phone': '919876543210', 'city': 'Surat', 'state': 'Gujarat', 'opening_balance': '100.00',
        'opening_balance_type': 'credit',
      });
      expect(_text(t, 'Supplier name *'), 'Acme');
      expect(_text(t, 'City'), 'Surat');
      await t.enterText(_field('City'), 'Pune');
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      expect(api.puts['/api/suppliers/s1'], {'city': 'Pune'});
      expect(api.posts, isEmpty);
    });

    testWidgets('blanking a phone on edit shows an error, sends nothing and stays open', (t) async {
      final api = _Api();
      await _open(t, _session(api), supplier: {'id': 's1', 'name': 'Acme', 'phone': '919876543210', 'state': 'Gujarat'});
      await t.enterText(_field('Phone'), '');
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      expect(find.text("Phone can't be removed once saved"), findsOneWidget);
      expect(api.puts, isEmpty);
      expect(find.byType(SupplierFormScreen), findsOneWidget);
    });

    testWidgets('an unchanged edit sends no request and pops false', (t) async {
      final api = _Api();
      bool? result;
      await _tall(t);
      await t.pumpWidget(MaterialApp(
        home: Builder(
          builder: (c) => TextButton(
            onPressed: () async => result = await Navigator.of(c).push<bool>(MaterialPageRoute(
                builder: (_) => SupplierFormScreen(session: _session(api), supplier: {'id': 's1', 'name': 'Acme', 'state': 'Gujarat'}))),
            child: const Text('go'),
          ),
        ),
      ));
      await t.tap(find.text('go'));
      await t.pumpAndSettle();
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      expect(api.puts, isEmpty);
      expect(result, isFalse);
      expect(find.byType(SupplierFormScreen), findsNothing);
    });

    testWidgets('an existing supplier with this GSTIN shows our wording and keeps the form open', (t) async {
      final api = _Api(business: const {}, dedupe: true);
      await _open(t, _session(api));
      await t.enterText(_field('Supplier name *'), 'Acme');
      await t.tap(find.text('Save supplier'));
      await t.pumpAndSettle();
      expect(find.text('A supplier with this GSTIN already exists.'), findsOneWidget);
      expect(find.textContaining('returned'), findsNothing);
      expect(find.byType(SupplierFormScreen), findsOneWidget);
    });

    testWidgets('tapping the opening balance does not make the form dirty', (t) async {
      await _open(t, _session(_Api(business: const {})));
      await t.tap(_field('Opening balance'));
      await t.pump();
      expect(t.widget<PopScope>(find.byWidgetPredicate((w) => w is PopScope).first).canPop, isTrue);
      await t.enterText(_field('Opening balance'), '5');
      await t.pump();
      expect(t.widget<PopScope>(find.byWidgetPredicate((w) => w is PopScope).first).canPop, isFalse);
    });

    testWidgets('an unreadable opening balance shows an error and sends nothing', (t) async {
      final api = _Api(business: const {});
      await _open(t, _session(api));
      await t.enterText(_field('Supplier name *'), 'Acme');
      await t.enterText(_field('Opening balance'), '.');
      await t.tap(find.text('Save supplier'));
      await t.pumpAndSettle();
      expect(find.text('Enter a valid amount'), findsOneWidget);
      expect(api.posts, isEmpty);
    });

    testWidgets('Fetch GSTIN details fills name, address, state and PAN', (t) async {
      final api = _Api(business: const {});
      await _open(t, _session(api));
      await t.enterText(_field('GSTIN'), _validGstin);
      await t.tap(find.text('Fetch GSTIN details'));
      await t.pumpAndSettle();
      expect(api.gets, contains('/api/gstin/lookup?gstin=$_validGstin'));
      expect(_text(t, 'Supplier name *'), 'Acme Traders');
      expect(_text(t, 'City'), 'Pune');
      expect(_text(t, 'PAN'), 'AAPFU0939F');
    });

    testWidgets('a linked supplier shows the low stock switch and sends only its change', (t) async {
      final api = _Api();
      await _open(t, _session(api), supplier: {'id': 's1', 'name': 'Acme', 'state': 'Gujarat', 'linked_business_id': 'x'});
      await t.tap(find.text('Allow supplier to see low stock'));
      await t.tap(find.text('Save changes'));
      await t.pumpAndSettle();
      expect(api.puts['/api/suppliers/s1'], {'allow_low_stock_access': true});
    });

    testWidgets('Edit on the supplier screen opens the form with the supplier', (t) async {
      final api = _Api();
      await _tall(t);
      await t.pumpWidget(MaterialApp(home: SupplierDetailScreen(session: _session(api), supplierId: 's1', onOpen: (_) {})));
      await t.pumpAndSettle();
      await t.tap(find.byTooltip('Edit'));
      await t.pumpAndSettle();
      expect(find.byType(SupplierFormScreen), findsOneWidget);
      expect(_text(t, 'Supplier name *'), 'Acme');
    });
  });
}
