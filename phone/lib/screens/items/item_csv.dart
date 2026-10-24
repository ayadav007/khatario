import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../api.dart';

const itemImportTemplateName = 'item-import-template.csv';

/// JavaScript `Number(text)`; NaN becomes null, as `JSON.stringify` writes it.
num? _jsNumber(String text) {
  final t = text.trim();
  if (t.isEmpty) return 0;
  return num.tryParse(t);
}

/// The CSV parsing from the Import handler in `app/(app)/items/page.tsx`: a plain comma split,
/// one leading / trailing quote removed per cell.
List<Map<String, dynamic>> parseItemImportCsv(String text) {
  final lines = text.split(RegExp(r'\r?\n')).where((l) => l.trim().isNotEmpty).toList();
  if (lines.length < 2) throw const FormatException('CSV has no data rows');
  final headers = lines.first.split(',').map((h) => h.trim()).toList();
  return [
    for (final line in lines.skip(1))
      () {
        final cols = line.split(',').map((c) => c.trim().replaceAll(RegExp(r'^"|"$'), '')).toList();
        final row = <String, String?>{};
        for (final (idx, h) in headers.indexed) {
          row[h] = idx < cols.length ? cols[idx] : null;
        }
        String? orNull(String key) {
          final v = row[key];
          return v == null || v.isEmpty ? null : v;
        }

        num? numOr(String key, num fallback) {
          final v = orNull(key);
          return v == null ? fallback : _jsNumber(v);
        }

        final mrp = orNull('mrp');
        return <String, dynamic>{
          if (row['name'] != null) 'name': row['name'],
          'code': orNull('code'),
          'barcode': orNull('barcode'),
          'unit': orNull('unit') ?? 'PCS',
          'item_type': orNull('item_type') ?? 'goods',
          'category_name': orNull('category_name'),
          'selling_price': numOr('selling_price', 0),
          'purchase_price': numOr('purchase_price', 0),
          'mrp': mrp == null ? null : _jsNumber(mrp),
          'tax_rate': numOr('tax_rate', 18),
          'hsn_sac': orNull('hsn_sac'),
          'opening_stock': numOr('opening_stock', 0),
          'min_stock': numOr('min_stock', 0),
          'description': orNull('description'),
          'image_url': orNull('image_url'),
          'is_active': row['is_active'] == null ? true : row['is_active'] == 'true',
        };
      }(),
  ];
}

/// Template button: the website downloads `/item-import-template.csv`; the phone hands it to the share menu.
Future<void> shareItemImportTemplate(KhatarioApi api) async {
  final bytes = await api.getBytes('/$itemImportTemplateName');
  final dir = await getTemporaryDirectory();
  final file = File('${dir.path}/$itemImportTemplateName');
  await file.writeAsBytes(bytes, flush: true);
  await SharePlus.instance.share(ShareParams(
    files: [XFile(file.path, mimeType: 'text/csv')],
    title: itemImportTemplateName,
  ));
}

/// Import button (`accept=".csv,text/csv"`). Returns null when nothing was picked, otherwise the
/// `Import completed…` message. The business comes from the session cookie, never the body.
Future<String?> importItemsCsv(KhatarioApi api) async {
  final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: const ['csv']);
  if (file == null) return null;
  final text = utf8.decode(await file.readAsBytes(), allowMalformed: true);
  final items = parseItemImportCsv(text.startsWith('\uFEFF') ? text.substring(1) : text);
  final data = await api.postJson('/api/items/import', {'items': items});
  return 'Import completed. Success: ${data['success']}, Failed: ${data['failed']}';
}
