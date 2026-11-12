import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:khatario_phone/ui/form_kit.dart';

/// The TextField inside the kit field ([KTextField] unless [within] says otherwise) labelled [label].
/// The kit draws the label above the box, so it is not a descendant of the TextField itself.
Finder textFieldLabelled(String label, {Type within = KTextField}) {
  return find.descendant(
    of: find.ancestor(of: find.text(label), matching: find.byType(within)),
    matching: find.byType(TextField),
  );
}
