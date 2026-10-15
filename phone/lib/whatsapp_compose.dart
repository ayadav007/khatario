import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api.dart';
import 'theme.dart';
import 'ui/kit.dart';

/// Sends a WhatsApp message from the business number. The phone's own WhatsApp app stays closed.
Future<void> composeBusinessWhatsApp(
  BuildContext context,
  KhatarioApi api, {
  required String to,
  required String message,
  String title = 'Send on WhatsApp',
}) async {
  final draft = TextEditingController(text: message);
  var sending = false;
  var error = '';
  await showKSheet<void>(
    context,
    title: title,
    scrollable: true,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, set) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(to.trim().isEmpty ? 'No WhatsApp number on this contact.' : 'To $to', style: AppText.caption),
            const SizedBox(height: 12),
            TextField(
              controller: draft,
              minLines: 4,
              maxLines: 8,
              decoration: const InputDecoration(labelText: 'Message'),
            ),
            if (error.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(error, style: AppText.caption.copyWith(color: AppColors.negative)),
            ],
            const SizedBox(height: 16),
            KButton(
              label: 'Send from Khatario',
              loading: sending,
              onPressed: to.trim().isEmpty || sending
                  ? null
                  : () async {
                      set(() {
                        sending = true;
                        error = '';
                      });
                      try {
                        await api.postJson('/api/whatsapp/send', {'to': to.trim(), 'message': draft.text.trim()});
                        if (ctx.mounted) Navigator.pop(ctx);
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Sent on WhatsApp')));
                        }
                      } on ApiException catch (e) {
                        set(() => error = e.message.isEmpty ? 'Could not send' : e.message);
                      } catch (_) {
                        set(() => error = 'Could not send');
                      } finally {
                        set(() => sending = false);
                      }
                    },
            ),
            const SizedBox(height: 8),
            KButton.secondary(
              label: 'Copy message',
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: draft.text));
                if (ctx.mounted) {
                  ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(content: Text('Message copied')));
                }
              },
            ),
          ],
        ),
      ),
    ),
  );
  draft.dispose();
}
