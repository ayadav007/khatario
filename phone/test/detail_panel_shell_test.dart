import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/theme.dart';
import 'package:khatario_phone/ui/detail_panel_shell.dart';
import 'package:khatario_phone/ui/kit.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

void main() {
  testWidgets('a subtitle that needs two lines grows the header and does not overflow it', (t) async {
    t.view.physicalSize = const Size(360, 800);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.reset);
    await t.pumpWidget(MaterialApp(
      theme: khatarioTheme(),
      home: Scaffold(
        body: DetailPanelShell<int>(
          title: 'DAL CHANA',
          avatar: const SizedBox(width: 40, height: 40),
          tabs: const [(0, 'Details', LucideIcons.info)],
          activeTab: 0,
          onTabChange: (_) {},
          onClose: () {},
          subtitle: const [Text('In store'), Text('Bundle'), Text('₹74 per KGS'), Text('-5.434 KGS in stock')],
          actions: [KIconButton(icon: LucideIcons.pencil, tooltip: 'Edit', onTap: () {})],
          moreActions: [DetailMoreAction(label: 'Share', icon: LucideIcons.share, onTap: () {})],
          body: const SizedBox(height: 40),
        ),
      ),
    ));
    await t.pump();
    expect(t.takeException(), isNull);
    expect(find.text('-5.434 KGS in stock'), findsOneWidget);
  });
}
