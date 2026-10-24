import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/items/scan_add_draft.dart';
import 'package:khatario_phone/screens/items/scan_add_screen.dart';
import 'package:khatario_phone/session.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';

/// Scan & Add on the phone, driven through its screens against a fake Khatario server.
/// The camera plugin answers "permission denied", as on a phone where camera access was refused.
void main() {
  const scannerChannel = MethodChannel('dev.steenbakker.mobile_scanner/scanner/method');

  setUp(() {
    SharedPreferencesAsyncPlatform.instance = InMemorySharedPreferencesAsync.empty();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(scannerChannel, (call) async {
      // 2 = denied; the request for permission is then refused.
      if (call.method == 'state') return 2;
      if (call.method == 'request') return false;
      return null;
    });
  });

  tearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(scannerChannel, null));

  Future<void> open(WidgetTester tester, _FakeServer api, {String businessId = 'b1'}) async {
    await tester.binding.setSurfaceSize(const Size(420, 900));
    await tester.pumpWidget(MaterialApp(home: ScanAddScreen(session: _session(api, businessId), canAddStock: true)));
    await tester.pumpAndSettle();
  }

  Future<void> typeCode(WidgetTester tester, String code) async {
    await tester.enterText(find.widgetWithText(TextField, 'Or type the barcode'), code);
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
  }

  Future<void> fill(WidgetTester tester, String label, String value) async {
    final f = find.widgetWithText(TextField, label);
    await tester.scrollUntilVisible(f, 200, scrollable: find.byType(Scrollable).first);
    await tester.enterText(f, value);
    await tester.pump();
  }

  Future<void> tapText(WidgetTester tester, String text) async {
    final f = find.text(text);
    if (find.byType(Scrollable).evaluate().isNotEmpty) {
      await tester.ensureVisible(f.first);
    }
    await tester.tap(f.first);
    await tester.pumpAndSettle();
  }

  testWidgets('camera refused: the screen says so and a typed barcode still works', (tester) async {
    final api = _FakeServer();
    await open(tester, api);
    expect(find.text('Allow camera access for Khatario in phone settings, or type the code below.'), findsOneWidget);

    await typeCode(tester, _known);
    expect(find.text('Already in your shop'), findsOneWidget);
    expect(find.textContaining('Known soap'), findsWidgets);
    await tapText(tester, 'Skip, scan next');
    expect(find.text('1 scanned'), findsOneWidget);

    // The same barcode again is still one row.
    await typeCode(tester, _known);
    await tapText(tester, 'Skip, scan next');
    expect(find.text('1 scanned'), findsOneWidget);
  });

  testWidgets('unknown barcode typed in by hand posts once with stock and a retry key', (tester) async {
    final api = _FakeServer();
    await open(tester, api);
    await typeCode(tester, _unknown);
    await tapText(tester, 'Type details instead');
    await fill(tester, 'Product name *', 'Loose dal 1 kg');
    await fill(tester, 'Purchase price', '90');
    await fill(tester, 'Stock you have', '12');
    await tapText(tester, 'Save and scan next');

    expect(api.itemPosts, hasLength(1));
    final (body, key) = api.itemPosts.single;
    expect(body['barcode'], _unknown);
    expect(body['opening_stock'], 12);
    expect(body.containsKey('business_id'), isFalse);
    expect(key, startsWith('scan-add-'));
    expect(find.text('1 scanned'), findsOneWidget);
    expect(find.textContaining('Added Loose dal 1 kg'), findsOneWidget);
  });

  testWidgets('prices-include-GST starts from the business setting and is sent with the item', (tester) async {
    final api = _FakeServer()..pricesIncludeGst = true;
    await open(tester, api);
    await typeCode(tester, _unknown);
    await tapText(tester, 'Type details instead');
    final gst = find.widgetWithText(SwitchListTile, 'Prices include GST');
    await tester.scrollUntilVisible(gst, 200, scrollable: find.byType(Scrollable).first);
    expect(tester.widget<SwitchListTile>(gst).value, isTrue);
    await fill(tester, 'Product name *', 'Ghee 1 L');
    await tapText(tester, 'Save and scan next');
    expect(api.itemPosts.single.$1['gst_included'], isTrue);

    // Turned off by the shopkeeper, it is sent off.
    await typeCode(tester, '2000000000039');
    await tapText(tester, 'Type details instead');
    await tester.scrollUntilVisible(gst, 200, scrollable: find.byType(Scrollable).first);
    await tester.tap(gst);
    await tester.pumpAndSettle();
    await fill(tester, 'Product name *', 'Salt 1 kg');
    await tapText(tester, 'Save and scan next');
    expect(api.itemPosts.last.$1['gst_included'], isFalse);
  });

  testWidgets('a product database suggestion fills the form for checking before it is saved', (tester) async {
    final api = _FakeServer();
    await open(tester, api);
    await typeCode(tester, _harpic);
    expect(find.textContaining('in a product database'), findsOneWidget);
    await tapText(tester, 'Skip');
    expect(find.textContaining('Filled from a product database'), findsOneWidget);
    expect(find.textContaining('Data: ProductGuru'), findsOneWidget);
    expect(find.widgetWithText(TextField, 'Harpic 500 ml'), findsOneWidget);
    expect(api.itemPosts, isEmpty);
  });

  testWidgets('a failed save is kept as not saved and retried with the same key', (tester) async {
    final api = _FakeServer()..failNextItemPost = true;
    await open(tester, api);
    await typeCode(tester, _unknown);
    await tapText(tester, 'Type details instead');
    await fill(tester, 'Product name *', 'Retry soap');
    await fill(tester, 'Purchase price', '20');
    await fill(tester, 'Stock you have', '5');
    await tapText(tester, 'Save and scan next');
    expect(find.text('Network down'), findsOneWidget);

    await tester.tap(find.bySemanticsLabel('Close'));
    await tester.pumpAndSettle();
    expect(find.textContaining('was not saved'), findsOneWidget);

    // The "Network down" snackbar covers the bottom buttons until it times out, as on a phone.
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
    await tapText(tester, 'Review');
    expect(find.text('Session review'), findsOneWidget);
    await tapText(tester, 'Try again');
    expect(api.itemPosts, hasLength(2));
    expect(api.itemPosts[1].$2, api.itemPosts[0].$2);
    expect(api.itemPosts[1].$1, api.itemPosts[0].$1);
    expect(find.text('Every product in this session was saved.'), findsNothing);
  });

  testWidgets('an unfinished product survives closing Scan & Add and keeps its retry key', (tester) async {
    final api = _FakeServer();
    await open(tester, api);
    await typeCode(tester, _unknown);
    await tapText(tester, 'Type details instead');
    await fill(tester, 'Product name *', 'Half done');
    await fill(tester, 'Stock you have', '4');
    // The app is closed while the form is open.
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();

    await open(tester, api);
    expect(find.text('Unfinished product on this phone, not saved yet'), findsOneWidget);
    expect(find.textContaining('Half done · Barcode $_unknown · Stock 4'), findsOneWidget);
    await tapText(tester, 'Continue');
    expect(find.widgetWithText(TextField, 'Half done'), findsOneWidget);
    await fill(tester, 'Purchase price', '7');
    await tapText(tester, 'Save and scan next');
    expect(api.itemPosts, hasLength(1));
    expect(find.text('Unfinished product on this phone, not saved yet'), findsNothing);
  });

  testWidgets('an unfinished product can be discarded after confirming', (tester) async {
    final store = ScanAddDraftStore(businessId: 'b1', userId: 'u1');
    await store.save(const [], null);
    final api = _FakeServer();
    await open(tester, api);
    await typeCode(tester, _unknown);
    await tapText(tester, 'Type details instead');
    await fill(tester, 'Product name *', 'Throw away');
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();

    await open(tester, api);
    await tapText(tester, 'Discard');
    expect(find.text('Discard this product?'), findsOneWidget);
    await tester.tap(find.descendant(of: find.byType(AlertDialog), matching: find.text('Discard')));
    await tester.pumpAndSettle();
    expect(find.text('Unfinished product on this phone, not saved yet'), findsNothing);
    expect((await store.load())?.current, isNull);
  });

  testWidgets("another business on the same phone sees none of this business's draft", (tester) async {
    final api = _FakeServer();
    await open(tester, api, businessId: 'b1');
    await typeCode(tester, _known);
    await tapText(tester, 'Skip, scan next');
    expect(find.text('1 scanned'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();

    await open(tester, api, businessId: 'b2');
    expect(find.text('Scan & add items'), findsOneWidget);
    expect(find.textContaining('Unfinished session restored'), findsNothing);
    expect(await ScanAddDraftStore(businessId: 'b2', userId: 'u1').load(), isNull);
    expect((await ScanAddDraftStore(businessId: 'b1', userId: 'u1').load())?.entries, hasLength(1));
  });
}

const _known = '2000000000015';
const _unknown = '2000000000022';
const _harpic = '8901396151005';

AppSession _session(KhatarioApi api, String businessId) => AppSession(api, {
      'user': {'id': 'u1', 'name': 'Owner'},
      'business': {'id': businessId, 'name': 'Shop $businessId'},
    });

/// Answers the Scan & Add routes the way the server does.
class _FakeServer extends KhatarioApi {
  _FakeServer() : super(Dio());

  final itemPosts = <(Map<String, dynamic>, String?)>[];
  bool failNextItemPost = false;
  bool pricesIncludeGst = false;
  var _seq = 0;

  @override
  Future<Map<String, dynamic>> getJson(String path) async {
    final uri = Uri.parse(path);
    if (uri.path == '/api/settings/invoice-defaults') {
      return {
        'defaults': {'pricesIncludeGst': pricesIncludeGst},
      };
    }
    final code = uri.queryParameters['code'];
    if (uri.path == '/api/items/scan-add/barcode') {
      if (code == _known) {
        return {
          'match': {
            'item': {'id': 'known-1', 'name': 'Known soap', 'unit': 'PCS', 'current_stock': 4, 'has_variants': false, 'net_quantity': '100 g'},
            'matched_variant_id': null,
            'variants': [],
            'has_history': false,
          },
        };
      }
      return {'match': null};
    }
    if (uri.path == '/api/items/scan-add/lookup') {
      if (code == _harpic) {
        return {
          'status': 'found',
          'suggestions': [
            {
              'provider': 'productguru',
              'name': 'harpic',
              'brand': 'Harpic',
              'quantity': '500 ml',
              'attribution': 'Data: ProductGuru',
              'certainty': 65,
              'source_url': 'https://myproduct.guru/p/$_harpic',
            },
          ],
          'conflicts': [],
        };
      }
      return {'status': 'not_found', 'suggestions': [], 'conflicts': []};
    }
    return {};
  }

  @override
  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body, {Map<String, String>? headers}) async {
    if (path == '/api/items') {
      itemPosts.add((body, headers?['X-Idempotency-Key']));
      if (failNextItemPost) {
        failNextItemPost = false;
        throw ApiException('Network down');
      }
      return {
        'item': {'id': 'new-${++_seq}', 'name': body['name']},
      };
    }
    if (path == '/api/items/scan-add/review') {
      return {'items': []};
    }
    return {};
  }
}
