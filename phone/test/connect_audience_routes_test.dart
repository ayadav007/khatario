import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/capability.dart';
import 'package:khatario_phone/screens/chats/campaign_report_screen.dart';
import 'package:khatario_phone/screens/chats/campaigns_screen.dart';
import 'package:khatario_phone/screens/chats/contact_groups_screen.dart';
import 'package:khatario_phone/screens/chats/contacts_screen.dart';
import 'package:khatario_phone/screens/chats/send_message_screen.dart';
import 'package:khatario_phone/screens/chats/unsubscribes_screen.dart';
import 'package:khatario_phone/screens/chats/who_to_message_screen.dart';
import 'package:khatario_phone/screens/pages/native_routes.dart';

import 'support/recorded_session.dart';

void main() {
  final (session, _) = recordedSession((o, b) => (200, <String, dynamic>{}));

  group('audience and sending links open their phone screens', () {
    test('each href has its screen', () {
      expect(nativeScreenFor(session, '/whatsapp/contacts'), isA<ContactsScreen>());
      expect(nativeScreenFor(session, '/whatsapp/contacts/groups'), isA<ContactGroupsScreen>());
      expect(nativeScreenFor(session, '/whatsapp/unsubscribes'), isA<UnsubscribesScreen>());
      expect(nativeScreenFor(session, '/whatsapp/send-message'), isA<SendMessageScreen>());
      expect(nativeScreenFor(session, '/whatsapp/who-to-message'), isA<WhoToMessageScreen>());
      expect(nativeScreenFor(session, '/whatsapp/campaigns'), isA<CampaignsScreen>());
    });

    test('a campaign link opens its report', () {
      final screen = nativeScreenFor(session, '/whatsapp/campaigns/abc-123') as CampaignReportScreen;
      expect(screen.campaignId, 'abc-123');
    });

    test('send-message?tab=campaign opens the campaign tab; other queries open the plain page', () {
      expect((nativeScreenFor(session, '/whatsapp/send-message?tab=campaign') as SendMessageScreen).startOnCampaign, isTrue);
      expect((nativeScreenFor(session, '/whatsapp/send-message') as SendMessageScreen).startOnCampaign, isFalse);
      expect(nativeScreenFor(session, '/whatsapp/contacts?source=csv'), isA<ContactsScreen>());
      expect(nativeScreenFor(session, '/whatsapp/campaigns?status=running'), isA<CampaignsScreen>());
    });

    test('the plan of the signed-in user reaches Send message and Who to message', () {
      const caps = Capabilities(sessionIsPrimaryAdmin: true, sessionPermissions: {}, snapshot: null);
      expect((nativeScreenFor(session, '/whatsapp/send-message', capabilities: caps) as SendMessageScreen).capabilities, same(caps));
      expect((nativeScreenFor(session, '/whatsapp/who-to-message', capabilities: caps) as WhoToMessageScreen).capabilities, same(caps));
    });

    test('none falls back to the automatic list or the website, and no Connect link stays listed', () {
      for (final href in [
        '/whatsapp/contacts', '/whatsapp/contacts/groups', '/whatsapp/unsubscribes', '/whatsapp/send-message', '/whatsapp/who-to-message', '/whatsapp/campaigns',
      ]) {
        expect(routeTier(session, href), RouteTier.native, reason: href);
      }
    });
  });

  group('the old broadcast form is gone and the tab uses the new screen', () {
    test('the Contacts bottom tab shows the contacts screen, embedded', () {
      final shell = File('lib/shell/app_shell.dart').readAsStringSync();
      expect(shell, contains('AppTab.contacts => ContactsScreen('));
      expect(shell, contains('embedded: true'));
      expect(shell.contains("_recordTab('/whatsapp/contacts')"), isFalse);
    });

    test('Broadcasts, New broadcast and the old bot replies screen no longer exist; Flows replace them', () {
      expect(File('lib/screens/chats/chat_outreach_screens.dart').existsSync(), isFalse);
      final inbox = File('lib/screens/chats/chats_inbox_screen.dart').readAsStringSync();
      expect(inbox.contains('BroadcastsScreen'), isFalse);
      expect(inbox, contains('CampaignsScreen('));
    });
  });
}
