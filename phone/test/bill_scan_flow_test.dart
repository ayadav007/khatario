import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:khatario_phone/screens/purchases/bill_camera.dart';
import 'package:khatario_phone/screens/purchases/bill_scan_flow.dart';

void main() {
  group('bill photo', () {
    final photo = img.encodePng(img.Image(width: 3000, height: 2000));

    test('is capped at 2400px before cropping', () {
      final normal = normalizeBillPhoto(photo);
      expect((normal.width, normal.height), (2400, 1600));
    });

    test('crop keeps the box round the corners and sends at most 1600px', () {
      final normal = normalizeBillPhoto(photo);
      final page = img.decodeJpg(cropBillPhoto((normal.bytes, const Rect.fromLTRB(0.25, 0, 0.75, 0.5))))!;
      expect((page.width, page.height), (1200, 800));
      final tall = img.decodeJpg(cropBillPhoto((normal.bytes, const Rect.fromLTRB(0, 0, 1, 1))))!;
      expect((tall.width, tall.height), (1600, 1067));
    });
  });

  testWidgets('preview counts pages and removes one', (tester) async {
    final page = img.encodeJpg(img.Image(width: 40, height: 60));
    final removed = <int>[];
    var proceeded = false;
    await tester.pumpWidget(MaterialApp(
      home: BillPreviewScreen(pages: [page, page], onAddPage: () {}, onRemovePage: removed.add, onProceed: () => proceeded = true, onBack: () {}),
    ));
    expect(find.text('Purchase Bill Preview'), findsOneWidget);
    expect(find.text('Add'), findsOneWidget);
    await tester.tap(find.text('Proceed (2 pages)'));
    await tester.tap(find.bySemanticsLabel('Remove page').last);
    expect(proceeded, isTrue);
    expect(removed, [1]);
  });

  testWidgets('reading screen counts up and turns tips', (tester) async {
    await tester.pumpWidget(MaterialApp(home: BillReadingScreen(startedAt: DateTime.now())));
    expect(find.text('Reading invoice…'), findsOneWidget);
    expect(find.textContaining('Any Party / Item tagged', findRichText: true), findsOneWidget);
    await tester.pump(const Duration(seconds: 3));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.textContaining('HSN codes', findRichText: true), findsOneWidget);
    expect(find.textContaining(RegExp(r'^\d+\.\ds$')), findsOneWidget);
  });

  testWidgets('finish shows the time and minutes saved, then closes itself', (tester) async {
    var dismissed = 0;
    await tester.pumpWidget(MaterialApp(
      home: BillReadSuccessScreen(elapsed: const Duration(milliseconds: 6400), itemCount: 5, onDismiss: () => dismissed++),
    ));
    expect(find.text('Scanned in 6.4s!'), findsOneWidget);
    expect(find.text('✨ We saved you ~6 mins of typing'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 2900));
    expect(dismissed, 1);
  });

  testWidgets('a PDF goes straight to reading, then the finish closes the flow', (tester) async {
    final reading = Completer<int?>();
    BillCapture? read;
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => TextButton(
          onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => BillScanFlow(read: (c) {
                read = c;
                return reading.future;
              }))),
          child: const Text('Scan'),
        ),
      ),
    ));
    await tester.tap(find.text('Scan'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    final camera = tester.widget<BillCameraScreen>(find.byType(BillCameraScreen));
    camera.onCapture(BillCapture(bytes: img.encodePng(img.Image(width: 2, height: 2)), name: 'bill.PDF'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(read?.name, 'bill.PDF');
    expect(find.byType(BillReadingScreen), findsOneWidget);
    reading.complete(3);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byType(BillReadSuccessScreen), findsOneWidget);
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    expect(find.text('Scan'), findsOneWidget);
    expect(find.byType(BillScanFlow), findsNothing);
  });
}
