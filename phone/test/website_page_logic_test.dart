import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/pages/website_page_logic.dart';

class _FakeHistory implements WebHistory {
  _FakeHistory(this.canGo);

  bool canGo;
  int backs = 0;

  @override
  Future<bool> canGoBack() async => canGo;

  @override
  Future<void> goBack() async => backs++;
}

void main() {
  group('Back', () {
    test('walks the page history first', () async {
      final history = _FakeHistory(true);
      final status = WebPageStatus();
      expect(await status.back(history), WebBack.pageHistory);
      expect(history.backs, 1);
    });

    test('leaves the screen when the page has no history', () async {
      final history = _FakeHistory(false);
      final status = WebPageStatus();
      expect(await status.back(history), WebBack.leaveScreen);
      expect(history.backs, 0);
    });

    test('after a failed page, Back returns to the previous page and clears the error', () async {
      final history = _FakeHistory(true);
      final status = WebPageStatus()..mainFrameError(isMainFrame: true);
      expect(status.failed, isTrue);
      expect(await status.back(history), WebBack.pageHistory);
      expect(status.failed, isFalse);
      expect(status.loading, isTrue);
    });

    test('a failed first page with no history leaves the screen', () async {
      final status = WebPageStatus()..mainFrameError(isMainFrame: true);
      expect(await status.back(_FakeHistory(false)), WebBack.leaveScreen);
    });
  });

  group('Loading and offline', () {
    test('starts loading, with the bar shown', () {
      final status = WebPageStatus();
      expect(status.loading, isTrue);
      expect(status.showBar, isTrue);
      expect(status.barValue, isNull);
    });

    test('progress fills the bar and 100 finishes it', () {
      final status = WebPageStatus()..progress(40);
      expect(status.barValue, 0.4);
      expect(status.showBar, isTrue);
      status.progress(100);
      expect(status.loading, isFalse);
      expect(status.showBar, isFalse);
    });

    test('finished hides the bar', () {
      final status = WebPageStatus()..finished();
      expect(status.showBar, isFalse);
      expect(status.failed, isFalse);
    });

    test('a main-frame error shows the offline state and hides the bar', () {
      final status = WebPageStatus()..mainFrameError(isMainFrame: true);
      expect(status.failed, isTrue);
      expect(status.showBar, isFalse);
      expect(status.loading, isFalse);
    });

    test('an error on a picture or script inside the page is ignored', () {
      final status = WebPageStatus()..mainFrameError(isMainFrame: false);
      expect(status.failed, isFalse);
      expect(status.loading, isTrue);
    });

    test('an error with no frame information counts as the main frame', () {
      final status = WebPageStatus()..mainFrameError(isMainFrame: null);
      expect(status.failed, isTrue);
    });

    test(
      'finishing after an error keeps the offline state until Try again',
      () {
        final status = WebPageStatus()
          ..mainFrameError(isMainFrame: true)
          ..finished();
        expect(status.failed, isTrue);
        status.retry();
        expect(status.failed, isFalse);
        expect(status.loading, isTrue);
        expect(status.barValue, isNull);
      },
    );

    test(
      'a page starting does not clear the error; only Try again and Back do',
      () {
        final status = WebPageStatus()
          ..mainFrameError(isMainFrame: true)
          ..started();
        expect(status.failed, isTrue);
        expect(status.showBar, isFalse);
      },
    );

    test('tells listeners when it changes', () {
      var calls = 0;
      final status = WebPageStatus()..addListener(() => calls++);
      status.progress(10);
      status.finished();
      expect(calls, 2);
    });
  });
}
