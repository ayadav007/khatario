import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'item_form_logic.dart';
import 'items_screen.dart' show itemImage;

bool _set(dynamic v) => v != null && v != false && v != 0 && v != '';

/// Create and edit form for `app/(app)/items/new/page.tsx` at the phone breakpoint.
/// Variants, bundles, opening stock on edit, gallery and SEO stay as they are when [itemId] is set.
class ItemFormScreen extends StatefulWidget {
  const ItemFormScreen({super.key, required this.session, this.itemId});

  final AppSession session;

  /// Null creates an item. Set to edit.
  final String? itemId;

  bool get editing => itemId != null;

  @override
  State<ItemFormScreen> createState() => _ItemFormScreenState();
}

class _ItemFormScreenState extends State<ItemFormScreen> {
  final _name = TextEditingController();
  final _code = TextEditingController();
  final _barcode = TextEditingController();
  final _selling = TextEditingController();
  final _purchase = TextEditingController();
  final _mrp = TextEditingController();
  final _hsn = TextEditingController();
  final _opening = TextEditingController();
  final _min = TextEditingController();
  final _description = TextEditingController();
  final _packSize = TextEditingController();
  final _packUnit = TextEditingController();
  final _brand = TextEditingController();
  final _netQuantity = TextEditingController();
  final _fssai = TextEditingController();
  final _plu = TextEditingController();
  String _type = 'goods';
  String _unit = 'PCS';
  String _tax = '0';
  String _uqc = '';
  String _categoryId = '';
  String _supplierId = '';
  String _supplierName = '';
  String _country = 'IN';
  String _weightMode = 'weight';
  String _imageUrl = '';
  bool _gstIncluded = false;
  bool _weighed = false;
  bool _store = false;
  bool _featured = false;
  bool _saving = false;
  bool _loading = false;
  bool _missing = false;
  bool _complex = false;
  bool _uploading = false;
  bool _more = false;
  bool _label = false;
  List<(String, String)> _categories = const [];

  @override
  void initState() {
    super.initState();
    _loadCategories();
    if (widget.editing) {
      _loading = true;
      _loadItem();
    } else {
      _loadDefaults();
    }
  }

  Future<void> _loadItem() async {
    try {
      final data = await widget.session.api.getJson('/api/items/${widget.itemId}');
      final item = data['item'];
      if (item is! Map) {
        _missing = true;
        return;
      }
      final row = Map<String, dynamic>.from(item);
      final f = ItemFields.fromItem(row);
      _name.text = f.name;
      _code.text = f.code;
      _barcode.text = f.barcode;
      _selling.text = f.sellingPrice;
      _purchase.text = f.purchasePrice;
      _mrp.text = f.mrp;
      _tax = f.taxRate.isEmpty ? '0' : f.taxRate;
      _hsn.text = f.hsn;
      _min.text = f.minStock;
      _description.text = f.description;
      _packSize.text = f.packSize;
      _packUnit.text = f.packUnit;
      _brand.text = f.brand;
      _netQuantity.text = f.netQuantity;
      _fssai.text = f.fssai;
      _plu.text = f.pluCode;
      _type = f.itemType;
      _unit = f.unit;
      _uqc = f.uqc;
      _categoryId = f.categoryId;
      _supplierId = f.supplierId;
      _country = f.countryOfOrigin;
      _weightMode = f.weightBarcodeMode;
      _imageUrl = f.imageUrl;
      _gstIncluded = f.gstIncluded;
      _weighed = f.isWeighed;
      _store = f.showInStore;
      _featured = f.featuredInStore;
      _complex = _set(row['has_variants']) || _set(row['is_bundle']);
      _more = [f.code, f.purchasePrice, f.hsn, f.description, f.categoryId, f.supplierId, f.uqc, f.packSize, f.packUnit].any((v) => v.isNotEmpty) || _store || _featured;
      _label = [f.brand, f.netQuantity, f.fssai].any((v) => v.isNotEmpty) || f.countryOfOrigin != 'IN' || _weighed;
      if (_supplierId.isNotEmpty) unawaited(_loadSupplierName());
    } catch (_) {
      _missing = true;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Settings › Items & stock › Low-stock alert at: filled in until the user types their own.
  Future<void> _loadDefaults() async {
    try {
      final body = await widget.session.api.getJson('/api/settings/invoice-defaults');
      final d = body['defaults'];
      final low = d is Map ? d['lowStockAlert'] : null;
      if (mounted && low is num && _min.text.isEmpty) setState(() => _min.text = low == low.roundToDouble() ? '${low.toInt()}' : '$low');
    } catch (_) {}
  }

  Future<void> _loadCategories() async {
    try {
      final body = await widget.session.api.getJson('/api/categories');
      final list = body['categories'];
      if (!mounted || list is! List) return;
      setState(() => _categories = [
            for (final c in list.whereType<Map>()) (c['id'].toString(), c['name']?.toString() ?? ''),
          ]);
    } catch (_) {}
  }

  Future<void> _loadSupplierName() async {
    try {
      final body = await widget.session.api.getJson('/api/suppliers/$_supplierId');
      final s = body['supplier'];
      if (mounted && s is Map) setState(() => _supplierName = s['name']?.toString() ?? '');
    } catch (_) {}
  }

  @override
  void dispose() {
    for (final c in [_name, _code, _barcode, _selling, _purchase, _mrp, _hsn, _opening, _min, _description, _packSize, _packUnit, _brand, _netQuantity, _fssai, _plu]) {
      c.dispose();
    }
    super.dispose();
  }

  ItemFields _fields() => ItemFields(
        name: _name.text,
        code: _code.text,
        itemType: _type,
        unit: _unit,
        sellingPrice: _selling.text,
        purchasePrice: _purchase.text,
        taxRate: _tax,
        hsn: _hsn.text,
        minStock: _min.text,
        description: _description.text,
        showInStore: _store,
        featuredInStore: _featured,
        barcode: _barcode.text,
        mrp: _mrp.text,
        gstIncluded: _gstIncluded,
        brand: _brand.text,
        netQuantity: _netQuantity.text,
        categoryId: _categoryId,
        imageUrl: _imageUrl,
        packSize: _packSize.text,
        packUnit: _packUnit.text,
        uqc: _uqc,
        supplierId: _supplierId,
        fssai: _fssai.text,
        countryOfOrigin: _country,
        isWeighed: _weighed,
        pluCode: _plu.text,
        weightBarcodeMode: _weightMode,
      );

  void _toast(String message) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      _toast('Name is required');
      return;
    }
    setState(() => _saving = true);
    try {
      if (widget.editing) {
        await widget.session.api.patchJson('/api/items/${widget.itemId}', itemUpdateBody(_fields()));
      } else {
        await widget.session.api.postJson('/api/items', itemCreateBody(_fields(), openingStock: _opening.text));
      }
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) _toast(e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// `handleImageUpload`: the same 2 MB limit, stored through `/api/upload/image`.
  Future<void> _pickPhoto() async {
    final file = await FilePicker.pickFile(type: FileType.image);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    if (!mounted) return;
    if (bytes.length > 2 * 1024 * 1024) {
      _toast('Image size should be less than 2MB');
      return;
    }
    setState(() => _uploading = true);
    try {
      final res = await widget.session.api.uploadImage('/api/upload/image', bytes: bytes, fileName: file.name, fields: const {'type': 'item'});
      final url = res['url']?.toString();
      if (url == null || url.isEmpty) throw ApiException('Upload failed');
      if (mounted) setState(() => _imageUrl = url);
    } on ApiException catch (e) {
      if (mounted) _toast(e.message);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _scanBarcode() async {
    final code = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const _BarcodeScanPage()));
    if (code != null && code.isNotEmpty && mounted) setState(() => _barcode.text = code);
  }

  Future<void> _pickSupplier() async {
    final picked = await showKSheet<(String, String)>(
      context,
      title: 'Default supplier',
      builder: (_) => _SupplierPicker(api: widget.session.api, selectedId: _supplierId),
    );
    if (picked != null && mounted) {
      setState(() {
        _supplierId = picked.$1;
        _supplierName = picked.$2;
      });
    }
  }

  Widget _f(TextEditingController c, String label, {bool number = false, int lines = 1, String? hint, String? help, Widget? suffix, int? maxLength, List<TextInputFormatter>? formatters}) => TextField(
        controller: c,
        maxLines: lines,
        maxLength: maxLength,
        inputFormatters: formatters,
        keyboardType: number ? const TextInputType.numberWithOptions(decimal: true) : null,
        style: AppText.body,
        cursorColor: AppColors.brand,
        decoration: InputDecoration(
          labelText: label,
          hintText: hint,
          helperText: help,
          helperMaxLines: 2,
          counterText: '',
          suffixIcon: suffix,
          labelStyle: AppText.body.copyWith(color: AppColors.ink3),
          filled: true,
          fillColor: AppColors.surface,
          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppRadius.md),
            borderSide: const BorderSide(color: AppColors.hairline, width: 1.5),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppRadius.md),
            borderSide: BorderSide(color: AppColors.brand, width: 2),
          ),
        ),
      );

  Widget _switch(String title, bool value, ValueChanged<bool> onChanged, {String? subtitle}) => SwitchListTile.adaptive(
        contentPadding: EdgeInsets.zero,
        activeTrackColor: AppColors.brand,
        title: Text(title, style: AppText.body),
        subtitle: subtitle == null ? null : Text(subtitle, style: AppText.caption),
        value: value,
        onChanged: onChanged,
      );

  /// A select shown as a tappable row that opens [showKPicker].
  Widget _select(String title, String value, List<(String, String)> options, ValueChanged<String> onChanged) {
    final label = options.where((o) => o.$1 == value).map((o) => o.$2).firstOrNull ?? value;
    return KListRow(
      padding: const EdgeInsets.symmetric(vertical: 6),
      title: title,
      subtitle: label,
      trailing: Icon(LucideIcons.chevronDown, size: 18, color: AppColors.ink3),
      onTap: () => showKPicker<String>(context, title: title, value: value, options: options, onChanged: (v) => setState(() => onChanged(v))),
    );
  }

  Widget _section(String title, String subtitle, bool open, VoidCallback toggle, List<Widget> children) => KCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KListRow(
              onTap: toggle,
              title: title,
              subtitle: subtitle,
              trailing: Icon(open ? LucideIcons.chevronUp : LucideIcons.chevronDown, size: 18, color: AppColors.ink3),
            ),
            if (open)
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
              ),
          ],
        ),
      );

  Widget _photo() {
    final image = itemImage(_imageUrl);
    return Row(children: [
      ClipRRect(
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Container(
          width: 64,
          height: 64,
          color: AppColors.sunken,
          child: image == null
              ? Icon(LucideIcons.image, color: AppColors.ink3)
              : Image(image: image, fit: BoxFit.cover, errorBuilder: (_, _, _) => Icon(LucideIcons.imageOff, color: AppColors.ink3)),
        ),
      ),
      const SizedBox(width: AppSpace.md),
      Expanded(
        child: Wrap(spacing: AppSpace.sm, runSpacing: AppSpace.sm, children: [
          KButton.secondary(label: image == null ? 'Add photo' : 'Replace', expand: false, loading: _uploading, onPressed: _uploading ? null : _pickPhoto),
          if (image != null) KButton.secondary(label: 'Remove', expand: false, onPressed: () => setState(() => _imageUrl = '')),
        ]),
      ),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final goods = _type == 'goods';
    final unitOptions = [for (final u in [if (!itemUnits.contains(_unit)) _unit, ...itemUnits]) (u, u)];
    final rateOptions = itemGstRates.any((r) => r.$1 == _tax) ? itemGstRates : [(_tax, '$_tax% (old)'), ...itemGstRates];
    final categoryOptions = [('', 'No category'), ..._categories, if (_categoryId.isNotEmpty && !_categories.any((c) => c.$1 == _categoryId)) (_categoryId, 'Current category')];
    final uqcOptions = [('', 'Work out from unit'), for (final u in itemUqcCodes) (u, u), if (_uqc.isNotEmpty && !itemUqcCodes.contains(_uqc)) (_uqc, _uqc)];
    final countryOptions = itemCountries.any((c) => c.$1 == _country) ? itemCountries : [(_country, _country), ...itemCountries];
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              height: 64,
              child: Row(children: [
                const SizedBox(width: 4),
                KIconButton(icon: LucideIcons.x, tooltip: 'Close', onTap: () => Navigator.pop(context)),
                const SizedBox(width: 4),
                Expanded(child: Text(widget.editing ? 'Edit item' : 'New item', style: AppText.heading.copyWith(fontSize: 18))),
              ]),
            ),
            Expanded(
              child: _loading
                  ? const KSpinner()
                  : _missing
                      ? KEmptyState(icon: LucideIcons.package, title: 'Item not found', action: KButton.secondary(label: 'Close', expand: false, onPressed: () => Navigator.pop(context)))
                      : ListView(
                padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
                children: [
                  if (_complex)
                    Padding(
                      padding: const EdgeInsets.only(bottom: AppSpace.md),
                      child: Text('Variants and the bundle list stay as they are. Change quantity on hand with Adjust stock.', style: AppText.body.copyWith(color: AppColors.ink3)),
                    ),
                  KSegmented<String>(
                    value: _type,
                    options: const [('goods', 'Goods'), ('service', 'Service')],
                    onChanged: (v) => setState(() => _type = v),
                  ),
                  const SizedBox(height: AppSpace.md),
                  KCard(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _photo(),
                        const SizedBox(height: AppSpace.md),
                        _f(_name, 'Name *'),
                        if (goods) ...[
                          const SizedBox(height: AppSpace.md),
                          _f(
                            _barcode,
                            'Barcode',
                            hint: 'Scan or enter barcode',
                            maxLength: 50,
                            suffix: IconButton(tooltip: 'Scan barcode', icon: Icon(LucideIcons.scanBarcode, color: AppColors.brand), onPressed: _scanBarcode),
                          ),
                        ],
                        const SizedBox(height: AppSpace.md),
                        Row(children: [
                          Expanded(child: _f(_selling, 'Selling price', number: true)),
                          const SizedBox(width: AppSpace.md),
                          Expanded(child: _f(_mrp, 'MRP', number: true)),
                        ]),
                        _switch('Selling price includes GST', _gstIncluded, (v) => setState(() => _gstIncluded = v), subtitle: 'GST is worked out backwards from the price instead of added on top.'),
                        const SizedBox(height: AppSpace.sm),
                        Text('GST rate', style: AppText.label),
                        const SizedBox(height: AppSpace.sm),
                        KChipBar<String>(
                          value: _tax,
                          padding: EdgeInsets.zero,
                          options: rateOptions,
                          onChanged: (v) => setState(() => _tax = v),
                        ),
                        const SizedBox(height: AppSpace.md),
                        Text('Unit', style: AppText.label),
                        const SizedBox(height: AppSpace.sm),
                        KChipBar<String>(value: _unit, padding: EdgeInsets.zero, options: unitOptions, onChanged: (v) => setState(() => _unit = v)),
                        if (goods && !widget.editing) ...[
                          const SizedBox(height: AppSpace.md),
                          Row(children: [
                            Expanded(child: _f(_opening, 'Opening stock', number: true)),
                            const SizedBox(width: AppSpace.md),
                            Expanded(child: _f(_min, 'Low stock alert', number: true)),
                          ]),
                        ],
                        if (goods && widget.editing) ...[
                          const SizedBox(height: AppSpace.md),
                          _f(_min, 'Low stock alert', number: true),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpace.md),
                  _section('More details', 'Code, purchase price, HSN, category, supplier, packs, store', _more, () => setState(() => _more = !_more), [
                    _f(_code, 'Code'),
                    const SizedBox(height: AppSpace.md),
                    _f(_purchase, 'Purchase price', number: true),
                    const SizedBox(height: AppSpace.md),
                    _f(_hsn, 'HSN/SAC'),
                    const SizedBox(height: AppSpace.sm),
                    _select('Category', _categoryId, categoryOptions, (v) => _categoryId = v),
                    KListRow(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      title: 'Default supplier',
                      subtitle: _supplierId.isEmpty ? 'None' : (_supplierName.isEmpty ? 'Selected' : _supplierName),
                      trailing: Icon(LucideIcons.chevronDown, size: 18, color: AppColors.ink3),
                      onTap: _pickSupplier,
                    ),
                    _select('GST UQC', _uqc, uqcOptions, (v) => _uqc = v),
                    if (goods) ...[
                      const SizedBox(height: AppSpace.sm),
                      Row(children: [
                        Expanded(child: _f(_packSize, 'Pieces in one pack', number: true, hint: '10')),
                        const SizedBox(width: AppSpace.md),
                        Expanded(child: _f(_packUnit, 'Pack name', hint: 'CTN', maxLength: 20)),
                      ]),
                      Padding(
                        padding: const EdgeInsets.only(top: AppSpace.xs),
                        child: Text('Leave blank if you do not sell this in packs. Stock stays in the unit above.', style: AppText.caption),
                      ),
                    ],
                    const SizedBox(height: AppSpace.md),
                    _f(_description, 'Description', lines: 3),
                    _switch('Show in online store', _store, (v) => setState(() => _store = v)),
                    _switch('Featured in store', _featured, (v) => setState(() => _featured = v)),
                  ]),
                  if (goods) ...[
                    const SizedBox(height: AppSpace.md),
                    _section('Retail label', 'Brand, net quantity, FSSAI, origin, sold by weight', _label, () => setState(() => _label = !_label), [
                      _f(_brand, 'Brand / Manufacturer', hint: 'e.g. Parle, Britannia'),
                      const SizedBox(height: AppSpace.md),
                      _f(_netQuantity, 'Net quantity', hint: 'e.g. 100 g, 1 L, 12 x 50 g'),
                      const SizedBox(height: AppSpace.md),
                      _f(_fssai, 'FSSAI licence no.', hint: '14-digit FSSAI number', maxLength: 20),
                      const SizedBox(height: AppSpace.sm),
                      _select('Country of origin', _country, countryOptions, (v) => _country = v),
                      _switch('Sold by weight or variable price', _weighed, (v) => setState(() => _weighed = v), subtitle: 'For items a weighing scale prices at the counter, like loose rice.'),
                      if (_weighed) ...[
                        const SizedBox(height: AppSpace.sm),
                        _f(
                          _plu,
                          'PLU code',
                          hint: 'e.g. 01234',
                          help: '4-5 digit code the scale uses to look up this item.',
                          maxLength: 5,
                          formatters: [FilteringTextInputFormatter.digitsOnly],
                        ),
                        const SizedBox(height: AppSpace.md),
                        Text('Barcode encodes', style: AppText.label),
                        const SizedBox(height: AppSpace.sm),
                        KChipBar<String>(
                          value: _weightMode,
                          padding: EdgeInsets.zero,
                          options: const [('weight', 'Weight in grams'), ('price', 'Price in paise')],
                          onChanged: (v) => setState(() => _weightMode = v),
                        ),
                      ],
                    ]),
                  ],
                ],
              ),
            ),
            KBottomBar(children: [
              Expanded(child: KButton(label: widget.editing ? 'Save changes' : 'Save item', icon: LucideIcons.check, loading: _saving, onPressed: _loading || _missing || _uploading ? null : _save)),
            ]),
          ],
        ),
      ),
    );
  }
}

/// Searches `GET /api/suppliers` and returns the picked (id, name); ('', '') clears it.
class _SupplierPicker extends StatefulWidget {
  const _SupplierPicker({required this.api, required this.selectedId});

  final KhatarioApi api;
  final String selectedId;

  @override
  State<_SupplierPicker> createState() => _SupplierPickerState();
}

class _SupplierPickerState extends State<_SupplierPicker> {
  final _query = TextEditingController();
  List<(String, String)> _rows = const [];
  bool _loading = true;
  Timer? _debounce;
  int _request = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final request = ++_request;
    setState(() => _loading = true);
    try {
      final body = await widget.api.getJson(Uri(path: '/api/suppliers', queryParameters: {'search': _query.text.trim(), 'limit': '50'}).toString());
      final list = body['suppliers'];
      if (request != _request || !mounted) return;
      setState(() => _rows = [
            if (list is List)
              for (final s in list.whereType<Map>()) (s['id'].toString(), s['name']?.toString() ?? ''),
          ]);
    } catch (_) {
      if (request == _request && mounted) setState(() => _rows = const []);
    } finally {
      if (request == _request && mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.6,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter, vertical: AppSpace.sm),
            child: TextField(
              controller: _query,
              autofocus: false,
              style: AppText.body,
              decoration: const InputDecoration(isDense: true, hintText: 'Search suppliers', prefixIcon: Icon(LucideIcons.search, size: 18)),
              onChanged: (_) {
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 300), _load);
              },
            ),
          ),
          Expanded(
            child: _loading && _rows.isEmpty
                ? const KSpinner()
                : ListView(children: [
                    KSheetAction(icon: LucideIcons.x, label: 'No supplier', selected: widget.selectedId.isEmpty, onTap: () => Navigator.of(context).pop(('', ''))),
                    for (final (id, name) in _rows)
                      KSheetAction(icon: LucideIcons.truck, label: name, selected: id == widget.selectedId, onTap: () => Navigator.of(context).pop((id, name))),
                    if (!_loading && _rows.isEmpty)
                      Padding(
                        padding: const EdgeInsets.all(AppSpace.gutter),
                        child: Text('No suppliers found. Add one under Purchases › Suppliers.', style: AppText.caption),
                      ),
                  ]),
          ),
        ],
      ),
    );
  }
}

/// Camera scanner that returns the first code it reads.
class _BarcodeScanPage extends StatefulWidget {
  const _BarcodeScanPage();

  @override
  State<_BarcodeScanPage> createState() => _BarcodeScanPageState();
}

class _BarcodeScanPageState extends State<_BarcodeScanPage> {
  final _controller = MobileScannerController(detectionSpeed: DetectionSpeed.normal);
  bool _done = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, title: const Text('Scan barcode')),
      body: Stack(
        fit: StackFit.expand,
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: (capture) {
              final value = capture.barcodes.map((b) => b.rawValue).whereType<String>().firstOrNull;
              if (_done || value == null || value.trim().isEmpty) return;
              _done = true;
              HapticFeedback.mediumImpact();
              Navigator.of(context).pop(value.trim());
            },
            errorBuilder: (context, error) => Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  error.errorCode == MobileScannerErrorCode.permissionDenied
                      ? 'Allow camera access in phone settings, or go back and type the barcode.'
                      : 'The camera is not available. Go back and type the barcode.',
                  textAlign: TextAlign.center,
                  style: AppText.body.copyWith(color: Colors.white),
                ),
              ),
            ),
          ),
          Center(
            child: Container(
              width: 260,
              height: 160,
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white.withValues(alpha: 0.85), width: 2),
                borderRadius: BorderRadius.circular(14),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
