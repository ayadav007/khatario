import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/printing/thermal_printers.dart';

void main() {
  test('guesses the printer language from the model name', () {
    expect(guessPrinterLanguage('TSC TTP-244 Pro'), PrinterLanguage.tspl);
    expect(guessPrinterLanguage('XP-365B'), PrinterLanguage.tspl);
    expect(guessPrinterLanguage('XP-58IIH'), PrinterLanguage.escpos);
    expect(guessPrinterLanguage('Xprinter XP-420B'), PrinterLanguage.tspl);
    expect(guessPrinterLanguage('Zebra ZD220'), PrinterLanguage.zpl);
    expect(guessPrinterLanguage('RPP02N'), PrinterLanguage.escpos);
  });

  test('saved printers round-trip and send the render spec the server expects', () {
    final p = ThermalPrinter(
      id: 'bluetooth:AA:BB',
      name: 'TVS RP3160',
      connection: PrinterConnection.bluetooth,
      address: 'AA:BB',
      paperWidthMm: 80,
      copies: 2,
      cashDrawer: 'cash',
    );
    final back = ThermalPrinter.fromJson(p.toJson())!;
    expect(back.paperWidthMm, 80);
    expect(back.copies, 2);
    expect(back.cashDrawer, 'cash');
    expect(back.renderSpec(openDrawer: true), containsPair('language', 'ESCPOS'));
    expect(back.renderSpec(openDrawer: true), containsPair('open_drawer', true));
    expect(ThermalPrinter.fromJson({'id': 'x'}), isNull);
  });
}
