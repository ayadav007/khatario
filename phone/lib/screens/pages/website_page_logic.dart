import 'package:flutter/foundation.dart';

/// What the web view can do about its own history. The screen wraps the platform controller in
/// this, so the Back decision can be tested with a fake.
abstract class WebHistory {
  Future<bool> canGoBack();
  Future<void> goBack();
}

/// What Back did: stepped back inside the page, or the screen should close.
enum WebBack { pageHistory, leaveScreen }

/// Loading and load-failed state of a website page shown in the app. Plain Dart, so it is tested
/// without the platform web view.
class WebPageStatus extends ChangeNotifier {
  bool _loading = true;
  bool _failed = false;
  int _percent = 0;

  bool get loading => _loading;

  /// True when the main page did not load (no internet, server down): show "Try again".
  bool get failed => _failed;

  /// The thin bar shows while a page loads and never over the offline state.
  bool get showBar => _loading && !_failed;

  /// 0..1, or null (indeterminate) before the web view reports any progress.
  double? get barValue => _percent <= 0 ? null : _percent / 100;

  bool _disposed = false;

  // The web view can call back after the screen closed; those calls change nothing.
  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  /// A page began loading. An error stays until Try again or Back.
  void started() {
    _loading = true;
    _percent = 0;
    notifyListeners();
  }

  void progress(int percent) {
    _percent = percent.clamp(0, 100);
    if (_percent >= 100) _loading = false;
    notifyListeners();
  }

  /// A page finished. An error already reported for it stays until Try again.
  void finished() {
    _loading = false;
    _percent = 100;
    notifyListeners();
  }

  /// The web view reported an error. Only the main page counts; a missing picture or script inside
  /// a page that did load must not replace it. No frame information counts as the main page.
  void mainFrameError({required bool? isMainFrame}) {
    if (isMainFrame == false) return;
    _failed = true;
    _loading = false;
    notifyListeners();
  }

  /// Try again.
  void retry() {
    _failed = false;
    started();
  }

  /// Back: walks the page's history before leaving. From an error page it returns to the previous
  /// page and clears the error.
  Future<WebBack> back(WebHistory history) async {
    if (await history.canGoBack()) {
      await history.goBack();
      if (_failed) retry();
      return WebBack.pageHistory;
    }
    return WebBack.leaveScreen;
  }
}
