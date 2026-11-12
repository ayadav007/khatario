import 'package:flutter/material.dart';

import '../../theme.dart';
import '../../ui/kit.dart';

/// Asks before a WhatsApp reminder goes to a customer. True only when the owner confirms.
Future<bool> askSendReminder(BuildContext context, String customerName) async {
  final yes = await showKSheet<bool>(
    context,
    title: 'Send a WhatsApp reminder to $customerName?',
    builder: (ctx) => Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.xl, AppSpace.sm, AppSpace.xl, 0),
      child: KButton(label: 'Send reminder', onPressed: () => Navigator.of(ctx).pop(true)),
    ),
  );
  return yes == true;
}
