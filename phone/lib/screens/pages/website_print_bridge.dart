import 'dart:convert';

import 'package:printing/printing.dart';

/// Name of the JavaScript channel the in-app website uses to hand printing to the phone.
const printChannelName = 'KhatarioPrint';

/// An Android web view cannot print: `window.print()` does nothing and `window.open()` gives no
/// window. The website prints three ways — `window.print()`, `window.open('')` + `document.write`
/// + `print()`, and `print()` on an iframe — so this script catches all three and posts the HTML to
/// [printChannelName]. A `window.open(url)` with a real address is posted as `open` so the app can
/// show that page. Safe to run more than once on a page.
const websitePrintBridgeScript = r'''
(function () {
  if (window.__khatarioPrintBridge || !window.KhatarioPrint) return;
  window.__khatarioPrintBridge = true;
  var send = function (msg) { try { KhatarioPrint.postMessage(JSON.stringify(msg)); } catch (e) {} };
  var pageHtml = function (doc) { return '<!doctype html>' + doc.documentElement.outerHTML; };

  window.print = function () { send({ kind: 'print', title: document.title, html: pageHtml(document) }); };

  window.open = function (url) {
    var target = url ? String(url) : '';
    if (target && target !== 'about:blank') {
      send({ kind: 'open', url: new URL(target, location.href).href, title: document.title });
    }
    var buffer = [];
    var fake = {
      closed: false,
      document: {
        write: function (h) { buffer.push(String(h)); },
        writeln: function (h) { buffer.push(String(h) + '\n'); },
        open: function () { buffer = []; },
        close: function () {},
        title: document.title,
      },
      focus: function () {},
      close: function () { fake.closed = true; },
      print: function () { if (buffer.length) send({ kind: 'print', title: document.title, html: buffer.join('') }); },
      addEventListener: function () {},
      location: { href: target },
    };
    return fake;
  };

  var patchFrame = function (frame) {
    try {
      var w = frame.contentWindow;
      if (!w || w.__khatarioPrintBridge) return;
      w.__khatarioPrintBridge = true;
      w.print = function () { send({ kind: 'print', title: document.title, html: pageHtml(w.document) }); };
    } catch (e) {}
  };
  var patchAll = function () { document.querySelectorAll('iframe').forEach(patchFrame); };
  new MutationObserver(function (records) {
    records.forEach(function (r) {
      r.addedNodes.forEach(function (n) {
        if (n.tagName === 'IFRAME') { patchFrame(n); n.addEventListener('load', function () { patchFrame(n); }); }
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
  patchAll();
})();
''';

/// What the in-app website asked the phone to do.
sealed class WebsitePrintRequest {
  const WebsitePrintRequest();

  /// Reads a message from [printChannelName]; null when it is not one of ours.
  static WebsitePrintRequest? parse(String message) {
    try {
      final data = jsonDecode(message);
      if (data is! Map) return null;
      final title = (data['title'] as String?)?.trim();
      return switch (data['kind']) {
        'print' when data['html'] is String && (data['html'] as String).isNotEmpty =>
          PrintHtml(data['html'] as String, title: title == null || title.isEmpty ? 'Khatario' : title),
        'open' when data['url'] is String => OpenUrl(data['url'] as String),
        _ => null,
      };
    } catch (_) {
      return null;
    }
  }
}

class PrintHtml extends WebsitePrintRequest {
  const PrintHtml(this.html, {required this.title});
  final String html;
  final String title;
}

class OpenUrl extends WebsitePrintRequest {
  const OpenUrl(this.url);
  final String url;
}

/// Opens Android's print dialog for website HTML (Wi-Fi and network printers, or Save as PDF).
/// [baseUrl] lets the page's stylesheets and images load.
Future<void> printWebsiteHtml(PrintHtml request, {required String baseUrl}) => Printing.layoutPdf(
      name: request.title,
      // Converted on the phone by Android's own web engine. Deprecated in `printing` without a
      // replacement; sending page HTML to the server's PDF renderer instead would let a page make
      // the server fetch any address.
      // ignore: deprecated_member_use
      onLayout: (format) => Printing.convertHtml(format: format, html: request.html, baseUrl: baseUrl),
    );
