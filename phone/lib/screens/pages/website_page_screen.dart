import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:printing/printing.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'website_print_bridge.dart';

/// Marks the phone app to the website, which then hides its own sidebar, top bar and bottom bar.
const phoneUserAgentMark = 'KhatarioPhone';

/// The website address for a menu link, on the same server the app talks to.
Uri websiteUri(String href) => Uri.parse(apiBaseUrl).resolve(href.startsWith('/') ? href : '/$href');

/// A website page shown inside the app, already signed in, for anything without a phone screen.
class WebsitePageScreen extends StatefulWidget {
  const WebsitePageScreen({super.key, required this.session, required this.href, required this.title});

  final AppSession session;
  final String href;
  final String title;

  @override
  State<WebsitePageScreen> createState() => _WebsitePageScreenState();
}

class _WebsitePageScreenState extends State<WebsitePageScreen> {
  WebViewController? _controller;
  bool _loading = true;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _open();
  }

  /// Hands the app's sign-in cookies to the web view, so the page opens signed in.
  Future<void> _copySessionCookies(Uri uri) async {
    final jar = widget.session.api.cookies;
    if (jar == null) return;
    final cookies = await jar.loadForRequest(uri);
    final manager = WebViewCookieManager();
    for (final c in cookies) {
      await manager.setCookie(WebViewCookie(name: c.name, value: c.value, domain: c.domain ?? uri.host, path: c.path ?? '/'));
    }
  }

  Future<void> _open() async {
    setState(() {
      _loading = true;
      _failed = false;
    });
    final uri = websiteUri(widget.href);
    try {
      await _copySessionCookies(uri);
      final controller = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setBackgroundColor(AppColors.bg);
      final agent = await controller.getUserAgent();
      await controller.setUserAgent('${agent ?? ''} $phoneUserAgentMark'.trim());
      // The web view cannot print; the website's print buttons are handed to the phone instead.
      await controller.addJavaScriptChannel(printChannelName, onMessageReceived: (m) => _onPrintMessage(m.message));
      await controller.setNavigationDelegate(NavigationDelegate(
        onPageFinished: (_) {
          controller.runJavaScript(websitePrintBridgeScript).catchError((_) {});
          if (mounted) setState(() => _loading = false);
        },
        onWebResourceError: (error) {
          if (error.isForMainFrame ?? true) {
            if (mounted) setState(() => _failed = true);
          }
        },
      ));
      await controller.loadRequest(uri);
      if (mounted) setState(() => _controller = controller);
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _onPrintMessage(String message) async {
    final request = WebsitePrintRequest.parse(message);
    try {
      switch (request) {
        case PrintHtml():
          await printWebsiteHtml(request, baseUrl: Uri.parse(apiBaseUrl).origin);
        case OpenUrl(:final url):
          await _openFromPage(url);
        case null:
          return;
      }
    } catch (_) {
      if (mounted) _toast('Could not print this page. Try again.');
    }
  }

  /// A page the website tried to open in a new window: a PDF prints; another page opens here.
  Future<void> _openFromPage(String url) async {
    final target = Uri.tryParse(url);
    final base = Uri.parse(apiBaseUrl);
    if (target == null || target.host != base.host) {
      if (mounted) _toast('This link opens outside Khatario.');
      return;
    }
    final path = target.hasQuery ? '${target.path}?${target.query}' : target.path;
    if (target.path.endsWith('/pdf') || target.path.endsWith('.pdf')) {
      final bytes = await widget.session.api.getBytes(path);
      await Printing.layoutPdf(name: widget.title, onLayout: (_) async => Uint8List.fromList(bytes));
      return;
    }
    if (mounted) openWebsiteInApp(context, widget.session, path, widget.title);
  }

  Future<bool> _goBackInPage() async {
    final controller = _controller;
    if (controller != null && await controller.canGoBack()) {
      await controller.goBack();
      return true;
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await _goBackInPage()) return;
        if (context.mounted) Navigator.of(context).pop();
      },
      child: Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              KBackBar(
                widget.title,
                trailing: KIconButton(icon: LucideIcons.refreshCw, tooltip: 'Reload', onTap: _open),
              ),
              if (_loading && !_failed) LinearProgressIndicator(minHeight: 2, color: AppColors.brand),
              Expanded(
                child: _failed
                    ? ListView(children: [
                        KEmptyState(
                          icon: LucideIcons.cloudOff,
                          title: 'Could not open this page',
                          body: 'Check the internet connection and try again.',
                          action: KButton(label: 'Try again', onPressed: _open, expand: false),
                        ),
                      ])
                    : controller == null
                        ? const KSpinner()
                        : WebViewWidget(controller: controller),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Opens [href] inside the app on the website, signed in.
void openWebsiteInApp(BuildContext context, AppSession session, String href, String title) {
  Navigator.of(context).push(MaterialPageRoute(builder: (_) => WebsitePageScreen(session: session, href: href, title: title)));
}
