import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import 'barcode_capture_screen.dart';
import 'item_form_logic.dart';
import 'items_screen.dart' show itemImage;

bool _set(dynamic v) => v != null && v != false && v != 0 && v != '';

/// A picture chosen from the phone, before it is uploaded.
typedef PickedPhoto = ({List<int> bytes, String name});

Future<PickedPhoto?> _pickFromPhone() async {
  final file = await FilePicker.pickFile(type: FileType.image);
  if (file == null) return null;
  return (bytes: await file.readAsBytes(), name: file.name);
}

/// Create and edit form for the fields on `app/(app)/items/new/page.tsx` that the phone collects.
/// Variants, bundles, images and opening stock stay as they are when [itemId] is set.
class ItemFormScreen extends StatefulWidget {
  const ItemFormScreen({super.key, required this.session, this.itemId, this.scanBarcode, this.pickPhoto});

  final AppSession session;

  /// Opens the camera and returns a code. Defaults to [BarcodeCaptureScreen]; tests pass their own.
  final Future<String?> Function(BuildContext context)? scanBarcode;

  /// Picks a picture to upload. Defaults to the phone's file picker; tests pass their own.
  final Future<PickedPhoto?> Function()? pickPhoto;

  /// Null creates an item. Set to edit.
  final String? itemId;

  bool get editing => itemId != null;

  @override
  State<ItemFormScreen> createState() => _ItemFormScreenState();
}

class _ItemFormScreenState extends State<ItemFormScreen> {
  final _name = TextEditingController();
  final _code = TextEditingController();
  final _selling = TextEditingController();
  final _purchase = TextEditingController();
  final _tax = TextEditingController();
  final _hsn = TextEditingController();
  final _opening = TextEditingController();
  final _min = TextEditingController();
  final _description = TextEditingController();
  final _barcode = TextEditingController();
  final _brand = TextEditingController();
  final _mrp = TextEditingController();
  final _packSize = TextEditingController();
  final _packUnit = TextEditingController();
  List<(String, String)> _categories = const [];
  String _categoryId = '';
  String _supplierId = '';
  String? _supplierName;
  String _image = '';
  bool _uploading = false;
  Map<String, String> _errors = const {};
  String _type = 'goods';
  String _unit = 'PCS';
  bool _store = false;
  bool _featured = false;
  bool _returnable = true;
  bool _saving = false;
  bool _loading = false;
  bool _missing = false;
  bool _complex = false;
  Map<String, dynamic>? _existing;

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
      _existing = row;
      _name.text = row['name']?.toString() ?? '';
      _code.text = row['code']?.toString() ?? '';
      _selling.text = itemFieldText(row['selling_price']);
      _purchase.text = itemFieldText(row['purchase_price']);
      _tax.text = itemFieldText(row['tax_rate']);
      _hsn.text = row['hsn_sac']?.toString() ?? '';
      _min.text = itemFieldText(row['min_stock']);
      _description.text = row['description']?.toString() ?? '';
      _type = row['item_type'] == 'service' ? 'service' : 'goods';
      final unit = row['unit']?.toString() ?? '';
      _unit = unit.isEmpty ? 'PCS' : unit;
      _store = row['show_in_store'] == true;
      _featured = row['featured_in_store'] == true;
      _returnable = row['store_returnable'] != false;
      _barcode.text = row['barcode']?.toString() ?? '';
      _brand.text = row['brand']?.toString() ?? '';
      _mrp.text = itemFieldText(row['mrp']);
      _packSize.text = itemFieldText(row['pack_size']);
      _packUnit.text = row['pack_unit']?.toString() ?? '';
      _categoryId = row['category_id']?.toString() ?? '';
      _supplierId = row['default_supplier_id']?.toString() ?? '';
      _image = row['image_url']?.toString() ?? '';
      _complex = _set(row['has_variants']) || _set(row['is_bundle']);
      _more = _code.text.isNotEmpty || _purchase.text.isNotEmpty || _hsn.text.isNotEmpty || _description.text.isNotEmpty || _store || _featured || !_returnable;
    } catch (_) {
      _missing = true;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
    _loadSupplierName();
  }

  /// The item only carries the supplier's id; the name is shown in the field.
  Future<void> _loadSupplierName() async {
    if (_supplierId.isEmpty) return;
    try {
      final body = await widget.session.api.getJson('/api/suppliers/$_supplierId');
      final supplier = body['supplier'];
      final name = supplier is Map ? supplier['name']?.toString() : null;
      if (mounted && name != null && name.isNotEmpty) setState(() => _supplierName = name);
    } catch (_) {}
  }

  /// `GET /api/categories` -> `{categories: [{id, name}]}`.
  Future<void> _loadCategories() async {
    try {
      final body = await widget.session.api.getJson('/api/categories');
      final rows = body['categories'];
      if (rows is! List || !mounted) return;
      setState(() {
        _categories = [
          for (final r in rows)
            if (r is Map && r['id'] != null && '${r['name'] ?? ''}'.isNotEmpty) ('${r['id']}', '${r['name']}'),
        ];
      });
    } catch (_) {}
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

  @override
  void dispose() {
    for (final c in [_name, _code, _selling, _purchase, _tax, _hsn, _opening, _min, _description, _barcode, _brand, _mrp, _packSize, _packUnit]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Name is required')));
      return;
    }
    final errors = validateItemExtras(barcode: _barcode.text, mrp: _mrp.text, packSize: _packSize.text, packUnit: _packUnit.text, unit: _unit);
    setState(() => _errors = errors);
    if (errors.isNotEmpty) return;
    setState(() => _saving = true);
    try {
      final fields = (
        name: _name.text,
        code: _code.text,
        itemType: _type,
        unit: _unit,
        sellingPrice: _selling.text,
        purchasePrice: _purchase.text,
        taxRate: _tax.text,
        hsn: _hsn.text,
        minStock: _min.text,
        description: _description.text,
        showInStore: _store,
        featuredInStore: _featured,
        storeReturnable: _returnable,
      );
      if (widget.editing) {
        final existing = _existing;
        if (existing == null) return;
        await widget.session.api.patchJson('/api/items/${widget.itemId}', itemUpdateBody(
          existing: existing,
          name: fields.name,
          code: fields.code,
          itemType: fields.itemType,
          unit: fields.unit,
          sellingPrice: fields.sellingPrice,
          purchasePrice: fields.purchasePrice,
          taxRate: fields.taxRate,
          hsn: fields.hsn,
          minStock: fields.minStock,
          description: fields.description,
          showInStore: fields.showInStore,
          featuredInStore: fields.featuredInStore,
          storeReturnable: fields.storeReturnable,
          barcode: _barcode.text,
          categoryId: _categoryId,
          brand: _brand.text,
          mrp: _mrp.text,
          defaultSupplierId: _supplierId,
          packSize: _packSize.text,
          packUnit: _packUnit.text,
          imageUrl: _image,
        ));
      } else {
        await widget.session.api.postJson('/api/items', itemCreateBody(
          name: fields.name,
          code: fields.code,
          itemType: fields.itemType,
          unit: fields.unit,
          sellingPrice: fields.sellingPrice,
          purchasePrice: fields.purchasePrice,
          taxRate: fields.taxRate,
          hsn: fields.hsn,
          openingStock: _opening.text,
          minStock: fields.minStock,
          description: fields.description,
          showInStore: fields.showInStore,
          featuredInStore: fields.featuredInStore,
          storeReturnable: fields.storeReturnable,
          barcode: _barcode.text,
          categoryId: _categoryId,
          brand: _brand.text,
          mrp: _mrp.text,
          defaultSupplierId: _supplierId,
          packSize: _packSize.text,
          packUnit: _packUnit.text,
          imageUrl: _image,
        ));
      }
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  bool _more = false;

  void _clearError(String key) {
    if (_errors.containsKey(key)) setState(() => _errors = {..._errors}..remove(key));
  }

  Future<void> _scan() async {
    final code = await (widget.scanBarcode ?? BarcodeCaptureScreen.open)(context);
    if (code == null || code.isEmpty || !mounted) return;
    setState(() => _barcode.text = normalizeItemBarcode(code));
    _clearError('barcode');
  }

  /// Same 2 MB limit as the website's item form. The upload route returns the picture as a data URL.
  Future<void> _addPhoto() async {
    final picked = await (widget.pickPhoto ?? _pickFromPhone)();
    if (picked == null || !mounted) return;
    if (picked.bytes.length > 2 * 1024 * 1024) {
      showKToast(context, 'Image size should be less than 2MB', tone: KTone.negative);
      return;
    }
    setState(() => _uploading = true);
    try {
      final res = await widget.session.api.uploadImage('/api/upload/image', bytes: picked.bytes, fileName: picked.name, fields: const {'type': 'item'});
      final url = res['url']?.toString() ?? '';
      if (url.isEmpty) throw ApiException('Upload failed');
      if (mounted) setState(() => _image = url);
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  /// Identify (barcode, category, brand, MRP), Stock (supplier, pack) and Photos, as on the website's item form.
  /// Batch and serial tracking and the valuation method are left out: the items routes do not accept them.
  List<Widget> _extraSections() {
    final hasVariants = _existing != null && _set(_existing!['has_variants']);
    final image = itemImage(_image);
    return [
      KFormSection(title: 'Identify', children: [
        KTextField(
          label: 'Barcode',
          controller: _barcode,
          hint: 'Scan or type the barcode',
          error: _errors['barcode'],
          onChanged: (_) => _clearError('barcode'),
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: KButton.secondary(label: 'Scan with camera', icon: LucideIcons.scanBarcode, expand: false, onPressed: _scan),
        ),
        KPickField<String>(
          label: 'Category',
          value: _categoryId,
          searchable: _categories.length > 8,
          options: [
            ('', 'No category'),
            if (_categoryId.isNotEmpty && !_categories.any((c) => c.$1 == _categoryId)) (_categoryId, 'Current category'),
            ..._categories,
          ],
          onChanged: (v) => setState(() => _categoryId = v),
        ),
        if (_type == 'goods') KTextField(label: 'Brand', controller: _brand, hint: 'e.g. Parle, Britannia'),
        if (!hasVariants) KAmountField(label: 'MRP', controller: _mrp, error: _errors['mrp']),
      ]),
      const SizedBox(height: AppSpace.md),
      KFormSection(title: 'Stock', children: [
        KAsyncPickField(
          label: 'Default supplier',
          valueLabel: _supplierId.isEmpty ? null : (_supplierName ?? 'Selected supplier'),
          search: (q) => searchSuppliers(widget.session.api, q),
          onPicked: (id, label) => setState(() {
            _supplierId = id;
            _supplierName = label;
          }),
        ),
        if (_supplierId.isNotEmpty)
          Align(
            alignment: Alignment.centerLeft,
            child: KTextButton(label: 'Remove supplier', onTap: () => setState(() {
              _supplierId = '';
              _supplierName = null;
            })),
          ),
        KTextField(
          label: 'Pack size',
          controller: _packSize,
          keyboard: TextInputType.number,
          hint: 'Pieces in one pack, e.g. 12',
          error: _errors['pack_size'],
          onChanged: (_) {
            _clearError('pack_size');
            _clearError('pack_unit');
          },
        ),
        KTextField(
          label: 'Pack name',
          controller: _packUnit,
          caps: true,
          hint: 'CTN',
          error: _errors['pack_unit'],
          onChanged: (_) => _clearError('pack_unit'),
        ),
      ]),
      const SizedBox(height: AppSpace.md),
      KFormSection(title: 'Photos', children: [
        KCard(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Container(
                width: 64,
                height: 64,
                clipBehavior: Clip.antiAlias,
                decoration: BoxDecoration(color: AppColors.sunken, borderRadius: BorderRadius.circular(AppRadius.sm)),
                child: image != null
                    ? Image(image: image, fit: BoxFit.cover, errorBuilder: (_, _, _) => Icon(LucideIcons.image, size: 22, color: AppColors.ink3))
                    : Icon(LucideIcons.image, size: 22, color: AppColors.ink3),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Main image', style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 2),
                    Text('Up to 2 MB, JPG, PNG or WebP.', style: AppText.caption),
                    const SizedBox(height: 6),
                    Wrap(spacing: 12, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [KButton.secondary(label: _image.isEmpty ? 'Add photo' : 'Replace photo', icon: LucideIcons.upload, expand: false, loading: _uploading, onPressed: _uploading ? null : _addPhoto),
                      if (_image.isNotEmpty) KTextButton(label: 'Remove', onTap: () => setState(() => _image = '')),
                    ]),
                  ],
                ),
              ),
            ],
          ),
        ),
      ]),
    ];
  }

  Widget _f(TextEditingController c, String label, {bool number = false, int lines = 1}) => KTextField(
        label: label,
        controller: c,
        maxLines: lines,
        keyboard: number ? const TextInputType.numberWithOptions(decimal: true) : null,
      );

  @override
  Widget build(BuildContext context) {
    const units = [('PCS', 'PCS'), ('KG', 'KG'), ('LTR', 'LTR'), ('MTR', 'MTR'), ('BOX', 'BOX')];
    const rates = [('0', '0%'), ('5', '5%'), ('12', '12%'), ('18', '18%'), ('28', '28%')];
    final unitOptions = units.any((u) => u.$1 == _unit) ? units : [(_unit, _unit), ...units];
    final taxValue = _tax.text.isEmpty ? '0' : _tax.text;
    final rateOptions = rates.any((r) => r.$1 == taxValue) ? rates : [(taxValue, '$taxValue%'), ...rates];
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
                        _f(_name, 'Name *'),
                        const SizedBox(height: AppSpace.md),
                        _f(_selling, 'Selling price', number: true),
                        const SizedBox(height: AppSpace.md),
                        Text('GST rate', style: AppText.label),
                        const SizedBox(height: AppSpace.sm),
                        KChipBar<String>(
                          value: taxValue,
                          padding: EdgeInsets.zero,
                          options: rateOptions,
                          onChanged: (v) => setState(() => _tax.text = v),
                        ),
                        const SizedBox(height: AppSpace.md),
                        Text('Unit', style: AppText.label),
                        const SizedBox(height: AppSpace.sm),
                        KChipBar<String>(value: _unit, padding: EdgeInsets.zero, options: unitOptions, onChanged: (v) => setState(() => _unit = v)),
                        if (_type == 'goods' && !widget.editing) ...[
                          const SizedBox(height: AppSpace.md),
                          Row(children: [
                            Expanded(child: _f(_opening, 'Opening stock', number: true)),
                            const SizedBox(width: AppSpace.md),
                            Expanded(child: _f(_min, 'Low stock alert', number: true)),
                          ]),
                        ],
                        if (_type == 'goods' && widget.editing) ...[
                          const SizedBox(height: AppSpace.md),
                          _f(_min, 'Low stock alert', number: true),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpace.md),
                  ..._extraSections(),
                  const SizedBox(height: AppSpace.md),
                  KCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        KListRow(
                          onTap: () => setState(() => _more = !_more),
                          title: 'More details',
                          subtitle: 'Code, purchase price, HSN, description, online store',
                          trailing: Icon(_more ? LucideIcons.chevronUp : LucideIcons.chevronDown, size: 18, color: AppColors.ink3),
                        ),
                        if (_more)
                          Padding(
                            padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                _f(_code, 'Code'),
                                const SizedBox(height: AppSpace.md),
                                _f(_purchase, 'Purchase price', number: true),
                                const SizedBox(height: AppSpace.md),
                                _f(_hsn, 'HSN/SAC'),
                                const SizedBox(height: AppSpace.md),
                                _f(_description, 'Description', lines: 3),
                                SwitchListTile.adaptive(
                                  contentPadding: EdgeInsets.zero,
                                  activeTrackColor: AppColors.brand,
                                  title: Text('Show in online store', style: AppText.body),
                                  value: _store,
                                  onChanged: (v) => setState(() => _store = v),
                                ),
                                SwitchListTile.adaptive(
                                  contentPadding: EdgeInsets.zero,
                                  activeTrackColor: AppColors.brand,
                                  title: Text('Customers can return this online', style: AppText.body),
                                  value: _returnable,
                                  onChanged: (v) => setState(() => _returnable = v),
                                ),
                                SwitchListTile.adaptive(
                                  contentPadding: EdgeInsets.zero,
                                  activeTrackColor: AppColors.brand,
                                  title: Text('Featured in store', style: AppText.body),
                                  value: _featured,
                                  onChanged: (v) => setState(() => _featured = v),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            KBottomBar(children: [
              Expanded(child: KButton(label: widget.editing ? 'Save changes' : 'Save item', icon: LucideIcons.check, loading: _saving, onPressed: _loading || _missing ? null : _save)),
            ]),
          ],
        ),
      ),
    );
  }
}
