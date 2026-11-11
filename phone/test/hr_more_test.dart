import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/api.dart';
import 'package:khatario_phone/screens/hr/engagement_screen.dart';
import 'package:khatario_phone/screens/hr/hr_documents_screen.dart';
import 'package:khatario_phone/screens/hr/hr_more_logic.dart';
import 'package:khatario_phone/ui/form_kit.dart';

import 'support/hr_fake_api.dart';

/// A new screen each call (a same-type screen would keep its state).
Future<void> _fresh(WidgetTester t, Widget screen) => openScreen(t, KeyedSubtree(key: UniqueKey(), child: screen));

Future<void> _tapText(WidgetTester t, String text, {bool last = false}) async {
  final f = last ? find.text(text).last : find.text(text).first;
  await t.ensureVisible(f);
  await t.tap(f);
  await t.pumpAndSettle();
}

/// Taps the save button; it spins while a question is open, so pump by hand.
Future<void> _tapSave(WidgetTester t, String label) async {
  final f = find.text(label).last;
  await t.ensureVisible(f);
  await t.tap(f);
  await t.pump(const Duration(milliseconds: 600));
  await t.pump(const Duration(milliseconds: 600));
}

Future<void> _confirm(WidgetTester t, String label) async {
  await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text(label)));
  await t.pumpAndSettle();
}

/// Types into the text field of the labelled form field.
Future<void> _type(WidgetTester t, String label, String text) async {
  final f = find.descendant(of: find.ancestor(of: find.text(label), matching: find.byType(Column)).first, matching: find.byType(TextField)).first;
  await t.enterText(f, text);
  await t.pump();
}

class _Bytes extends FakeHrApi {
  _Bytes(super.handler);
  final posted = <(String, Map<String, dynamic>)>[];

  @override
  Future<List<int>> postForBytes(String path, Map<String, dynamic> body) async {
    posted.add((path, body));
    if (path.contains('fail')) throw ApiException('Employee not found', status: 500);
    return <int>[37, 80, 68, 70];
  }
}

const _announcements = {
  'announcements': [
    {'id': 'a1', 'title': 'Diwali holiday', 'body': 'Shop closed on 12 Nov', 'author_name': 'HR', 'published_at': '2026-11-09 10:00:00+00', 'expires_at': null, 'audience': {'type': 'all'}, 'is_active': true, 'archived_at': null},
  ],
};
const _polls = {
  'polls': [
    {'id': 'p1', 'question': 'Lunch place?', 'audience': {'type': 'departments', 'departments': ['Sales']}, 'allow_multiple': false, 'expires_at': null, 'is_active': true, 'created_at': '2026-11-08 09:00:00+00', 'options': [{'id': 'o1', 'option_text': 'Cafe', 'sort_order': 0}, {'id': 'o2', 'option_text': 'Canteen', 'sort_order': 1}]},
  ],
};
const _articles = {
  'articles': [
    {'id': 'r1', 'title': 'Safety tips', 'body_html': '<p>Wear <b>gloves</b></p>', 'author_name': null, 'allow_employee_posts': false, 'published_at': '2026-11-07 09:00:00+00', 'expires_at': null, 'is_published': true},
  ],
};

Object? _eng(String m, String p, Map<String, dynamic>? b) {
  if (p == '/api/hr/announcements') return _announcements;
  if (p == '/api/hr/engagement/polls') return _polls;
  if (p == '/api/hr/engagement/articles') return _articles;
  if (p == '/api/settings/hr-org-catalog') return {'catalog': {'departments': ['Sales', 'Stores']}};
  return null;
}

void main() {
  group('engagement logic', () {
    test('request paths and bodies carry no identity fields', () {
      expect(announcementsPath, '/api/hr/announcements');
      expect(pollsPath, '/api/hr/engagement/polls');
      expect(articlesPath, '/api/hr/engagement/articles');
      expect(announcementBody(title: ' Hi ', body: 'Text', audience: const HrAudience.everyone(), expiresAt: DateTime(2026, 12, 1)), {
        'title': 'Hi', 'body': 'Text', 'audience': {'type': 'all'}, 'expires_at': '2026-12-01',
      });
      expect(announcementBody(title: 'Hi', body: '', audience: const HrAudience.departments(['Sales'])), {
        'title': 'Hi', 'body': '', 'audience': {'type': 'departments', 'departments': ['Sales']},
      });
      expect(pollBody(question: 'Q?', options: ['A', ' ', 'B'], audience: const HrAudience.employees(['e1', 'e2'])), {
        'question': 'Q?', 'options': ['A', 'B'], 'audience': {'type': 'employees', 'employee_ids': ['e1', 'e2']},
      });
      expect(articleBody(title: 'T', text: 'One\n\nTwo <b>'), {'title': 'T', 'body_html': '<p>One</p><p>Two &lt;b&gt;</p>'});
      expect(archiveAnnouncementBody('a1'), {'id': 'a1', 'archive': true});
      expect(unpublishArticleBody('r1'), {'id': 'r1', 'is_published': false});
    });

    test('rows read the website replies', () {
      final a = announcementRows(_announcements['announcements']).single;
      expect(a.title, 'Diwali holiday');
      expect(a.audienceLabel, 'Everyone');
      final p = pollRows(_polls['polls']).single;
      expect(p.options, ['Cafe', 'Canteen']);
      expect(p.audienceLabel, 'Sales');
      final r = articleRows(_articles['articles']).single;
      expect(r.text, 'Wear gloves');
      expect(r.isPublished, isTrue);
    });
  });

  group('engagement screen', () {
    testWidgets('lists announcements, polls and articles', (t) async {
      final api = FakeHrApi(_eng);
      await _fresh(t, EngagementScreen(session: hrSession(api)));
      expect(find.text('Diwali holiday'), findsOneWidget);
      expect(find.text('Shop closed on 12 Nov'), findsOneWidget);
      await _tapText(t, 'Polls');
      expect(find.text('Lunch place?'), findsOneWidget);
      expect(find.text('Cafe'), findsOneWidget);
      await _tapText(t, 'Articles');
      expect(find.text('Safety tips'), findsOneWidget);
      expect(find.text('Wear gloves'), findsOneWidget);
    });

    testWidgets('shows empty, error with Try again, and not in plan', (t) async {
      await _fresh(t, EngagementScreen(session: hrSession(FakeHrApi((m, p, b) => {'announcements': [], 'polls': [], 'articles': []}))));
      expect(find.text('No announcements'), findsOneWidget);
      var fail = true;
      final api = FakeHrApi((m, p, b) => fail ? ApiException('Boom', status: 500) : _eng(m, p, b));
      await _fresh(t, EngagementScreen(session: hrSession(api)));
      expect(find.text('Boom'), findsOneWidget);
      fail = false;
      await _tapText(t, 'Try again');
      expect(find.text('Diwali holiday'), findsOneWidget);
      await _fresh(t, EngagementScreen(session: hrSession(FakeHrApi((m, p, b) => ApiException('Upgrade', status: 403, code: 'FEATURE_NOT_IN_PLAN')))));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('archiving an announcement asks first, names it, posts once and reloads', (t) async {
      final api = FakeHrApi(_eng);
      await _fresh(t, EngagementScreen(session: hrSession(api)));
      await _tapText(t, 'Archive');
      expect(find.textContaining('Archive "Diwali holiday"?'), findsOneWidget);
      await _confirm(t, 'Archive');
      expect(api.bodies('PATCH', '/api/hr/announcements'), [{'id': 'a1', 'archive': true}]);
      expect(api.paths('GET', '/api/hr/announcements').length, 2);
    });

    testWidgets('Not now leaves the announcement alone', (t) async {
      final api = FakeHrApi(_eng);
      await _fresh(t, EngagementScreen(session: hrSession(api)));
      await _tapText(t, 'Archive');
      await _confirm(t, 'Not now');
      expect(api.paths('PATCH'), isEmpty);
    });

    testWidgets('unpublishing an article asks first and sends is_published false', (t) async {
      final api = FakeHrApi(_eng);
      await _fresh(t, EngagementScreen(session: hrSession(api)));
      await _tapText(t, 'Articles');
      await _tapText(t, 'Unpublish');
      expect(find.textContaining('Unpublish "Safety tips"?'), findsOneWidget);
      await _confirm(t, 'Unpublish');
      expect(api.bodies('PATCH', '/api/hr/engagement/articles'), [{'id': 'r1', 'is_published': false}]);
    });

    testWidgets('a refused archive shows the server message', (t) async {
      final api = FakeHrApi((m, p, b) => m == 'PATCH' ? ApiException('Not allowed', status: 403) : _eng(m, p, b));
      await _fresh(t, EngagementScreen(session: hrSession(api)));
      await _tapText(t, 'Archive');
      await _confirm(t, 'Archive');
      expect(find.text('Not allowed'), findsOneWidget);
    });

    testWidgets('a new announcement posts the website body', (t) async {
      final api = FakeHrApi(_eng);
      await openScreen(t, AnnouncementFormScreen(session: hrSession(api)));
      await _type(t, 'Title', 'Stock count');
      await _type(t, 'Message', 'Saturday');
      await _tapText(t, 'Publish', last: true);
      expect(api.bodies('POST', '/api/hr/announcements'), [{'title': 'Stock count', 'body': 'Saturday', 'audience': {'type': 'all'}}]);
    });

    testWidgets('a new announcement for specific departments sends them', (t) async {
      final api = FakeHrApi(_eng);
      await openScreen(t, AnnouncementFormScreen(session: hrSession(api)));
      await _type(t, 'Title', 'Sales meet');
      await _tapText(t, 'Everyone');
      await _confirm(t, 'Specific departments');
      await _tapText(t, 'Stores');
      await _tapText(t, 'Publish', last: true);
      expect(api.bodies('POST', '/api/hr/announcements').single!['audience'], {'type': 'departments', 'departments': ['Stores']});
    });

    testWidgets('a new poll needs two options, asks first, then posts', (t) async {
      final api = FakeHrApi(_eng);
      await openScreen(t, PollFormScreen(session: hrSession(api)));
      await _type(t, 'Question', 'Outing?');
      await _type(t, 'Option 1', 'Yes');
      await _tapSave(t, 'Create poll');
      expect(find.text('A poll needs a question and at least two options.'), findsOneWidget);
      expect(api.paths('POST'), isEmpty);
      await _type(t, 'Option 2', 'No');
      await _tapSave(t, 'Create poll');
      expect(find.textContaining('Publish "Outing?"'), findsOneWidget);
      expect(api.paths('POST'), isEmpty);
      await t.tap(find.descendant(of: find.byType(BottomSheet), matching: find.text('Publish poll')));
      await t.pump(const Duration(milliseconds: 600));
      await t.pump(const Duration(milliseconds: 600));
      expect(api.bodies('POST', '/api/hr/engagement/polls'), [{'question': 'Outing?', 'options': ['Yes', 'No'], 'audience': {'type': 'all'}}]);
    });

    testWidgets('a new article turns paragraphs into HTML', (t) async {
      final api = FakeHrApi(_eng);
      await openScreen(t, ArticleFormScreen(session: hrSession(api)));
      await _type(t, 'Title', 'Tips');
      await _type(t, 'Article text', 'Line one');
      await _tapText(t, 'Publish', last: true);
      expect(api.bodies('POST', '/api/hr/engagement/articles'), [{'title': 'Tips', 'body_html': '<p>Line one</p>'}]);
    });
  });

  group('document logic', () {
    test('paths, bodies and file name', () {
      expect(documentTemplatesPath, '/api/hr/document-templates');
      expect(generateDocumentPath('t1'), '/api/hr/document-templates/t1/generate');
      expect(generateDocumentBody('e1'), {'employee_id': 'e1', 'format': 'pdf'});
      expect(createTemplateBody(' Offer '), {'name': 'Offer'});
      expect(renameTemplateBody('t1', ' Offer 2 '), {'id': 't1', 'name': 'Offer 2'});
      expect(templatePdfName('Appointment  letter'), 'Appointment-letter.pdf');
    });
  });

  group('HR documents', () {
    const templates = {
      'templates': [
        {'id': 't1', 'name': 'Appointment letter', 'document_type': 'offer_letter', 'body_html': '<p>Dear</p>'},
      ],
      'attributes': [{'key': 'employee.name', 'label': 'Name'}],
    };

    testWidgets('lists templates; empty, error and plan states', (t) async {
      await _fresh(t, HrDocumentsScreen(session: hrSession(FakeHrApi((m, p, b) => templates))));
      expect(find.text('Appointment letter'), findsOneWidget);
      await _fresh(t, HrDocumentsScreen(session: hrSession(FakeHrApi((m, p, b) => {'templates': []}))));
      expect(find.text('No templates'), findsOneWidget);
      await _fresh(t, HrDocumentsScreen(session: hrSession(FakeHrApi((m, p, b) => ApiException('Down', status: 500)))));
      expect(find.text('Down'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
      await _fresh(t, HrDocumentsScreen(session: hrSession(FakeHrApi((m, p, b) => ApiException('Upgrade', status: 403, code: 'FEATURE_NOT_IN_PLAN')))));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });

    testWidgets('a new template posts only its name', (t) async {
      final api = FakeHrApi((m, p, b) => templates);
      await openScreen(t, NewTemplateScreen(session: hrSession(api)));
      await _type(t, 'Template name', 'Experience letter');
      await _tapText(t, 'Create', last: true);
      expect(api.bodies('POST', '/api/hr/document-templates'), [{'name': 'Experience letter'}]);
    });

    testWidgets('renaming a template patches id and name', (t) async {
      final api = FakeHrApi((m, p, b) => templates);
      await openScreen(t, TemplateScreen(session: hrSession(api), template: templateRows(templates['templates']).single));
      await _type(t, 'Template name', 'Joining letter');
      await _tapText(t, 'Save name');
      expect(api.bodies('PATCH', '/api/hr/document-templates'), [{'id': 't1', 'name': 'Joining letter'}]);
    });

    testWidgets('generating needs an employee, posts employee_id and opens the PDF', (t) async {
      final api = _Bytes((m, p, b) => {
            'employees': [{'id': 'e1', 'name': 'Meena', 'employee_code': 'E9'}],
          });
      final opened = <(String, int)>[];
      await openScreen(
        t,
        TemplateScreen(
          session: hrSession(api),
          template: templateRows(templates['templates']).single,
          openPdf: (context, bytes, title) async => opened.add((title, bytes.length)),
        ),
      );
      await _tapText(t, 'Generate PDF');
      expect(api.posted, isEmpty);
      expect(find.text('Choose an employee first.'), findsOneWidget);
      await t.tap(find.byType(KAsyncPickField));
      await t.pumpAndSettle();
      await t.tap(find.text('Meena').last);
      await t.pumpAndSettle();
      await _tapText(t, 'Generate PDF');
      expect(api.posted.single.$1, '/api/hr/document-templates/t1/generate');
      expect(api.posted.single.$2, {'employee_id': 'e1', 'format': 'pdf'});
      expect(opened, [('Appointment letter', 4)]);
    });

    testWidgets('a refused generation shows the server message and opens nothing', (t) async {
      final api = _Bytes((m, p, b) => {
            'employees': [{'id': 'e1', 'name': 'Meena', 'employee_code': 'E9'}],
          });
      var opened = 0;
      await openScreen(
        t,
        TemplateScreen(
          session: hrSession(api),
          template: const TemplateRow(id: 'fail', name: 'Bad', documentType: 'x'),
          openPdf: (context, bytes, title) async => opened++,
        ),
      );
      await t.tap(find.byType(KAsyncPickField));
      await t.pumpAndSettle();
      await t.tap(find.text('Meena').last);
      await t.pumpAndSettle();
      await _tapText(t, 'Generate PDF');
      expect(find.text('Employee not found'), findsOneWidget);
      expect(opened, 0);
    });
  });
}
