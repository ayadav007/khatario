import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:khatario_phone/screens/purchases/bill_camera.dart';
import 'package:khatario_phone/screens/purchases/bill_scan_flow.dart';

void main() {
  group('bill photo', () {
    final photo = img.encodePng(img.Image(width: 3000, height: 2000));

    test('keeps a phone-sized photo whole and caps a bigger one at 4000px', () {
      final normal = normalizeBillPhoto(photo);
      expect((normal.width, normal.height), (3000, 2000));
      final big = normalizeBillPhoto(img.encodePng(img.Image(width: 6000, height: 4500)));
      expect((big.width, big.height), (4000, 3000));
    });

    test('crop keeps the box round the corners and sends a normal page at most 1600px', () {
      final normal = normalizeBillPhoto(photo);
      final page = img.decodeJpg(cropBillPhoto((normal.bytes, const Rect.fromLTRB(0.25, 0, 0.75, 0.5))))!;
      expect((page.width, page.height), (1500, 1000));
      final whole = img.decodeJpg(cropBillPhoto((normal.bytes, const Rect.fromLTRB(0, 0, 1, 1))))!;
      expect((whole.width, whole.height), (1600, 1067));
    });

    test('a till roll keeps its width instead of shrinking to 1600px tall', () {
      final roll = normalizeBillPhoto(img.encodePng(img.Image(width: 3000, height: 4000)));
      // Receipt is a narrow strip of the photo: 750 x 3500. It keeps its width, up to 3200px tall.
      final page = img.decodeJpg(cropBillPhoto((roll.bytes, const Rect.fromLTRB(0.25, 0.0625, 0.5, 0.9375))))!;
      expect((page.width, page.height), (686, 3200));
    });

    test('billVisionSize matches the server rule', () {
      expect(billVisionSize(4032, 3024), (width: 1600, height: 1200));
      expect(billVisionSize(1100, 3300), (width: 800, height: 2400));
      expect(billVisionSize(8000, 2000), (width: 3200, height: 800));
      expect(billVisionSize(700, 2600), (width: 700, height: 2600));
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
