import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import 'campaigns_logic.dart';

export 'send_pictures.dart';

/// The fields behind a message's buttons: up to 3 quick replies, one call button, one link button
/// and a footer. [value] is what the logic checks and sends.
class ButtonsController {
  final replies = <TextEditingController>[];
  final phoneTitle = TextEditingController();
  final phone = TextEditingController();
  final urlTitle = TextEditingController();
  final url = TextEditingController();
  final footer = TextEditingController();

  ButtonSet get value => ButtonSet(
        quickReplies: [for (final r in replies) r.text],
        phoneTitle: phoneTitle.text,
        phone: phone.text,
        urlTitle: urlTitle.text,
        url: url.text,
        footer: footer.text,
      );

  void clear() {
    _disposeLater(List.of(replies));
    replies.clear();
    for (final f in [phoneTitle, phone, urlTitle, url, footer]) {
      f.clear();
    }
  }

  /// A removed field is still on screen until the next frame, so it is disposed after it.
  static void _disposeLater(List<TextEditingController> old) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      for (final r in old) {
        r.dispose();
      }
    });
  }

  void dispose() {
    for (final r in replies) {
      r.dispose();
    }
    for (final f in [phoneTitle, phone, urlTitle, url, footer]) {
      f.dispose();
    }
  }
}

/// Website "Interactive Actions": titles hold 20 characters, 3 quick replies, 1 call and 1 link button.
class ButtonsEditor extends StatefulWidget {
  const ButtonsEditor({super.key, required this.controller});

  final ButtonsController controller;

  @override
  State<ButtonsEditor> createState() => _ButtonsEditorState();
}

class _ButtonsEditorState extends State<ButtonsEditor> {
  ButtonsController get c => widget.controller;

  void _addReply() => setState(() => c.replies.add(TextEditingController()));

  void _removeReply(int i) => setState(() => ButtonsController._disposeLater([c.replies.removeAt(i)]));

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('Buttons go under your message. Titles hold up to 20 characters. Add up to 3 quick replies, and one call and one link button.', style: AppText.caption),
      const SizedBox(height: AppSpace.md),
      for (final (i, r) in c.replies.indexed) ...[
        Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Expanded(child: KTextField(label: 'Quick reply ${i + 1}', controller: r, maxLength: 20)),
          const SizedBox(width: AppSpace.sm),
          KIconButton(icon: LucideIcons.x, tooltip: 'Remove quick reply', onTap: () => _removeReply(i)),
        ]),
        const SizedBox(height: AppSpace.md),
      ],
      if (c.replies.length < 3) Align(alignment: Alignment.centerLeft, child: KTextButton(label: 'Add quick reply', onTap: _addReply)),
      const SizedBox(height: AppSpace.md),
      KTextField(label: 'Call button title', controller: c.phoneTitle, hint: 'e.g. Call us', maxLength: 20),
      const SizedBox(height: AppSpace.md),
      KTextField(label: 'Call button number', controller: c.phone, hint: 'e.g. 919876543210', keyboard: TextInputType.phone),
      const SizedBox(height: AppSpace.md),
      KTextField(label: 'Link button title', controller: c.urlTitle, hint: 'e.g. Visit us', maxLength: 20),
      const SizedBox(height: AppSpace.md),
      KTextField(label: 'Link button URL', controller: c.url, hint: 'https://example.com', keyboard: TextInputType.url),
      const SizedBox(height: AppSpace.md),
      KTextField(label: 'Footer (optional)', controller: c.footer, hint: 'Optional footer text', maxLength: 60),
    ]);
  }
}

/// The website's three message types: Text, Image (a picture with a caption) and Buttons.
enum MessageKind { text, image, buttons }

const messageKindOptions = <(MessageKind, String)>[(MessageKind.text, 'Text'), (MessageKind.image, 'Image'), (MessageKind.buttons, 'Buttons')];
