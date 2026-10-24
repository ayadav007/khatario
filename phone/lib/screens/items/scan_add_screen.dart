import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../purchases/bill_camera.dart';
import 'scan_add_draft.dart';
import 'scan_add_existing_screen.dart';
import 'scan_add_review_screen.dart';
import 'scan_add_logic.dart';

/// Label photos Scan & Add asks for, in order. Same steps as the website's PHOTO_STEPS.
const _photoSteps = {
  'front': ('Photo of the name', 'The front of the pack, where the brand and product name are printed.'),
  'details': ('Photo of MRP, batch and expiry', 'The panel where MRP, batch number and dates are printed together.'),
  'size': ('Photo of the pack size', 'Where the net weight or volume is printed, e.g. 100 g or 500 ml.'),
};

enum _Stage { looking, photo, form }

/// Scan & Add Items, the phone side of `app/(app)/items/scan-add/page.tsx`.
/// Scan a barcode; if the shop already has it, say so; otherwise fill in the new item and its stock.
class ScanAddScreen extends StatefulWidget {
  const ScanAddScreen({super.key, required this.session, this.canAddStock = false, this.onOpen, this.draftStore});

  final AppSession session;

  /// Plan has inventory adjustments, so a product already in the shop can get more stock.
  final bool canAddStock;

  /// Shell navigation, for the item page opened from the review.
  final ValueChanged<String>? onOpen;

  /// Where the unfinished session is kept on this phone. Defaults to this business and user.
  final ScanAddDraftStore? draftStore;

  @override
  State<ScanAddScreen> createState() => _ScanAddScreenState();
}

class _ScanAddScreenState extends State<ScanAddScreen> {
  final _controller = MobileScannerController(detectionSpeed: DetectionSpeed.normal);
  final _typed = TextEditingController();
  List<ScanAddEntry> _entries = const [];
  String? _last;
  DateTime _lastAt = DateTime(2000);
  bool _busy = false;
  String? _message;
  bool _error = false;
  ScanAddDraftStore? _draft;
  // The product being filled in on the form, or the one left unfinished last time.
  ScanAddDraftProduct? _current;

  @override
  void initState() {
    super.initState();
    final businessId = widget.session.businessId;
    final userId = widget.session.user['id']?.toString();
    _draft = widget.draftStore ?? (businessId != null && userId != null ? ScanAddDraftStore(businessId: businessId, userId: userId) : null);
    _restore();
  }

  /// Brings back the last unfinished session for this business and user, if any.
  Future<void> _restore() async {
    final draft = await _draft?.load();
    if (!mounted || draft == null) return;
    setState(() {
      _entries = draft.entries;
      _current = draft.current;
    });
    final failed = draft.entries.where((e) => e.outcome == 'failed').length;
    _say(
      'Unfinished session restored: ${draft.entries.length} scanned'
      '${failed > 0 ? ', $failed not saved yet' : ''}. Saved products are already in your shop.',
      error: failed > 0,
    );
  }

  void _persist() => _draft?.save(_entries, _current);

  @override
  void dispose() {
    _controller.dispose();
    _typed.dispose();
    super.dispose();
  }

  void _say(String message, {bool error = false}) => setState(() {
    _message = message;
    _error = error;
  });

  Future<void> _handle(String code) async {
    final c = code.replaceAll(RegExp(r'\s+'), '');
    if (c.isEmpty || _busy) return;
    // The camera reports the same code many times a second; one lookup per 2 s per code.
    final now = DateTime.now();
    if (c == _last && now.difference(_lastAt) < const Duration(seconds: 2)) return;
    _last = c;
    _lastAt = now;
    setState(() => _busy = true);
    Map<String, dynamic>? match;
    try {
      final body = await widget.session.api.getJson(Uri(path: '/api/items/scan-add/barcode', queryParameters: {'code': c}).toString());
      final m = body['match'];
      match = m is Map ? Map<String, dynamic>.from(m) : null;
    } on ApiException catch (e) {
      // The shopkeeper can still add the item by hand.
      if (mounted) _say(e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    if (!mounted) return;
    HapticFeedback.mediumImpact();
    await _controller.stop();
    if (match != null) {
      await _showExisting(c, match);
    } else {
      await _openForm(c);
    }
    _last = null;
    if (mounted) await _controller.start();
  }

  void _remember(ScanAddEntry entry) {
    setState(() => _entries = addScanAddEntry(_entries, entry));
    _persist();
  }

  Future<void> _openForm(String barcode, {ScanAddDraftProduct? resume}) async {
    final entry = await Navigator.of(context).push<ScanAddEntry>(
      MaterialPageRoute(
        builder: (_) => ScanAddFormScreen(
          session: widget.session,
          barcode: barcode,
          resume: resume,
          onDraft: (product) {
            _current = product;
            _persist();
          },
        ),
      ),
    );
    if (!mounted) return;
    // Saved, failed (kept as a row) or closed on purpose: the product is no longer in progress.
    _current = null;
    _persist();
    if (entry == null) return;
    _remember(entry);
    if (entry.outcome == 'failed') {
      _say('${entry.name} was not saved. Try it again from Review.', error: true);
    } else {
      _say('Added ${entry.name}. Scan the next product.');
    }
  }

  Future<void> _showExisting(String barcode, Map<String, dynamic> match) async {
    final item = match['item'] is Map ? Map<String, dynamic>.from(match['item'] as Map) : const <String, dynamic>{};
    final done = await Navigator.of(context).push<ScanAddEntry>(
      MaterialPageRoute(
        builder: (_) => ScanAddExistingScreen(session: widget.session, barcode: barcode, match: match, canAddStock: widget.canAddStock),
      ),
    );
    if (!mounted) return;
    if (done != null) {
      _remember(done);
      _say('${done.name}: ${done.outcome == 'size' ? 'size added' : '${done.qty} added'}. Scan the next product.');
    } else {
      _remember(ScanAddEntry(name: item['name']?.toString() ?? '', outcome: 'existing', barcode: barcode, itemId: item['id']?.toString()));
      _say('${item['name'] ?? 'This product'} is already in your shop.');
    }
  }

  /// The product left half-filled last time: continue it with its original retry key, or discard it.
  Widget _unfinished(ScanAddDraftProduct p) {
    final v = p.values;
    final label = [
      v.name.trim().isEmpty ? 'No name yet' : v.name.trim(),
      if (v.barcode.isNotEmpty) 'Barcode ${v.barcode}',
      if (v.openingStock.trim().isNotEmpty) 'Stock ${v.openingStock.trim()}',
    ].join(' · ');
    return Container(
      padding: const EdgeInsets.all(10),
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(color: AppColors.dueSoft, borderRadius: BorderRadius.circular(AppRadius.sm)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Unfinished product on this phone, not saved yet', style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
          Text(label, style: AppText.label),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: KButton(
                  label: 'Continue',
                  expand: false,
                  onPressed: () async {
                    final resume = _current!;
                    await _controller.stop();
                    await _openForm(resume.values.barcode, resume: resume);
                    if (mounted) await _controller.start();
                  },
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: KButton.secondary(label: 'Discard', expand: false, onPressed: _discardUnfinished),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _discardUnfinished() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Discard this product?'),
        content: const Text('What was typed for it will be lost.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Discard')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _current = null);
    _persist();
  }

  /// Review the session; Finish there closes Scan & Add, Back returns here with any retries applied.
  Future<void> _review() async {
    await _controller.stop();
    if (!mounted) return;
    final result = await Navigator.of(context).push<ScanAddReviewResult>(
      MaterialPageRoute(
        builder: (_) => ScanAddReviewScreen(session: widget.session, entries: _entries, onOpen: widget.onOpen),
      ),
    );
    if (!mounted) return;
    if (result != null) setState(() => _entries = result.entries);
    if (result?.finished == true) {
      final anySaved = _entries.any((e) => e.outcome != 'existing' && e.outcome != 'failed');
      // Finishing ends the session, so the draft on this phone goes too.
      await _draft?.clear();
      if (mounted) Navigator.of(context).pop(anySaved);
      return;
    }
    _persist();
    await _controller.start();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(_entries.isEmpty ? 'Scan & add items' : '${_entries.length} scanned'),
        actions: [IconButton(tooltip: 'Torch', icon: const Icon(LucideIcons.flashlight), onPressed: () => _controller.toggleTorch())],
      ),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                MobileScanner(
                  controller: _controller,
                  onDetect: (capture) {
                    final code = capture.barcodes.map((b) => b.rawValue).whereType<String>().firstOrNull;
                    if (code != null) _handle(code);
                  },
                  errorBuilder: (context, error) => Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        error.errorCode == MobileScannerErrorCode.permissionDenied
                            ? 'Allow camera access for Khatario in phone settings, or type the code below.'
                            : 'The camera is not available. Type the code below.',
                        textAlign: TextAlign.center,
                        style: AppText.body.copyWith(color: Colors.white),
                      ),
                    ),
                  ),
                ),
                Center(
                  child: Container(
                    width: 260,
                    height: 150,
                    decoration: BoxDecoration(
                      border: Border.all(color: Colors.white.withValues(alpha: 0.85), width: 2),
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                ),
                if (_busy) const Center(child: CircularProgressIndicator(color: Colors.white)),
              ],
            ),
          ),
          Container(
            color: AppColors.surface,
            padding: EdgeInsets.fromLTRB(16, 12, 16, 12 + MediaQuery.of(context).padding.bottom),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_message != null)
                  Container(
                    padding: const EdgeInsets.all(10),
                    margin: const EdgeInsets.only(bottom: 10),
                    decoration: BoxDecoration(
                      color: _error ? AppColors.negativeSoft : AppColors.positiveSoft,
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                    ),
                    child: Text(_message!, style: AppText.body.copyWith(color: _error ? AppColors.negative : AppColors.positive)),
                  ),
                if (_current != null) _unfinished(_current!),
                TextField(
                  controller: _typed,
                  keyboardType: TextInputType.number,
                  textInputAction: TextInputAction.done,
                  decoration: const InputDecoration(isDense: true, hintText: 'Or type the barcode', prefixIcon: Icon(LucideIcons.scanBarcode, size: 18)),
                  onSubmitted: (v) {
                    _last = null;
                    _handle(v);
                    _typed.clear();
                  },
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: KButton.secondary(
                        label: 'No barcode',
                        onPressed: () async {
                          await _controller.stop();
                          await _openForm('');
                          if (mounted) await _controller.start();
                        },
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: KButton(
                        label: _entries.isEmpty ? 'Done' : 'Review',
                        onPressed: _entries.isEmpty ? () => Navigator.of(context).pop(false) : _review,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// New item details and opening stock for one scanned product. Pops with the saved item's name.
class ScanAddFormScreen extends StatefulWidget {
  const ScanAddFormScreen({super.key, required this.session, required this.barcode, this.resume, this.onDraft});

  final AppSession session;
  final String barcode;

  /// A product left unfinished earlier: its fields and original retry key. Skips lookup and photos.
  final ScanAddDraftProduct? resume;

  /// Called as the form changes, so the scan screen can keep it in the draft on this phone.
  final ValueChanged<ScanAddDraftProduct?>? onDraft;

  @override
  State<ScanAddFormScreen> createState() => _ScanAddFormScreenState();
}

class _ScanAddFormScreenState extends State<ScanAddFormScreen> {
  late final _barcode = TextEditingController(text: widget.barcode);
  final _name = TextEditingController();
  final _brand = TextEditingController();
  final _size = TextEditingController();
  final _mrp = TextEditingController();
  final _selling = TextEditingController();
  final _purchase = TextEditingController();
  final _hsn = TextEditingController();
  final _opening = TextEditingController();
  final _batch = TextEditingController();
  final _mfg = TextEditingController();
  final _exp = TextEditingController();
  String _unit = 'PCS';
  String _tax = '0';
  // Prices include GST; starts from the business's invoice setting unless a draft says otherwise.
  bool _gstIncluded = false;
  bool _gstTouched = false;
  // Item picture from the front photo (a data URL from the server), empty when none.
  String _imageUrl = '';
  bool _saving = false;
  Map<String, String> _errors = const {};
  // One key per product, reused when a failed save is retried, and kept with a resumed draft.
  late final String _key = widget.resume?.idempotencyKey ?? newScanAddKey();
  _Stage _stage = _Stage.looking;
  List<String> _queue = const [];
  List<Map<String, dynamic>> _suggestions = const [];
  List<Map<String, dynamic>> _conflicts = const [];
  // The database whose suggestion filled the form, while the shopkeeper keeps it.
  String? _lookupSource;
  bool _reading = false;
  // A label photo filled some details (for the session's source count).
  bool _usedPhoto = false;
  // Message of the last failed save; set until a save goes through.
  String? _lastError;

  @override
  void initState() {
    super.initState();
    final resume = widget.resume;
    if (resume != null) {
      final v = resume.values;
      _barcode.text = v.barcode;
      for (final (c, text) in [
        (_name, v.name),
        (_brand, v.brand),
        (_size, v.size),
        (_mrp, v.mrp),
        (_selling, v.sellingPrice),
        (_purchase, v.purchasePrice),
        (_hsn, v.hsn),
        (_opening, v.openingStock),
        (_batch, v.batchNumber),
        (_mfg, v.manufacturingDate),
        (_exp, v.expiryDate),
      ]) {
        c.text = text;
      }
      _unit = v.unit;
      _tax = v.taxRate;
      _gstIncluded = v.pricesIncludeGst;
      _imageUrl = v.imageUrl;
      _lookupSource = resume.lookupSource;
      _usedPhoto = resume.usedPhoto;
      _stage = _Stage.form;
    } else {
      _start();
      _loadGstDefault();
    }
    for (final c in [_barcode, _name, _brand, _size, _mrp, _selling, _purchase, _hsn, _opening, _batch, _mfg, _exp]) {
      c.addListener(_draftChanged);
    }
  }

  /// Hands the current fields and retry key to the scan screen, which keeps them on this phone.
  void _draftChanged() => widget.onDraft?.call(ScanAddDraftProduct(values: _values, idempotencyKey: _key, lookupSource: _lookupSource, usedPhoto: _usedPhoto));

  /// Database lookup first; found → only the MRP/batch/expiry photo, otherwise all three photos.
  Future<void> _start() async {
    const all = ['front', 'details', 'size'];
    if (widget.barcode.isEmpty) {
      setState(() {
        _stage = _Stage.photo;
        _queue = all;
      });
      return;
    }
    Map<String, dynamic>? result;
    try {
      result = await widget.session.api.getJson(Uri(path: '/api/items/scan-add/lookup', queryParameters: {'code': widget.barcode}).toString());
    } on ApiException {
      result = null;
    }
    if (!mounted) return;
    final suggestions = (result?['suggestions'] as List? ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    final conflicts = (result?['conflicts'] as List? ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    if (suggestions.isNotEmpty) {
      _apply(ProductFacts.fromSuggestion(suggestions.first), sizeInDoubt: conflicts.any((c) => c['field'] == 'quantity'));
      setState(() {
        _suggestions = suggestions;
        _conflicts = conflicts;
        _lookupSource = suggestions.first['provider']?.toString();
        _stage = _Stage.photo;
        _queue = const ['details'];
      });
    } else {
      if (result == null || result['status'] == 'unavailable') {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Product databases did not answer. Add the details from the label.')));
      }
      setState(() {
        _stage = _Stage.photo;
        _queue = all;
      });
    }
  }

  void _apply(ProductFacts facts, {bool sizeInDoubt = false}) {
    final next = fillFromFacts((name: _name.text, brand: _brand.text, size: _size.text, mrp: _mrp.text), facts, sizeInDoubt: sizeInDoubt);
    _name.text = next.name;
    _brand.text = next.brand;
    _size.text = next.size;
    _mrp.text = next.mrp;
  }

  void _nextPhoto(List<String> queue) {
    final rest = queue.skip(1).toList();
    setState(() {
      _queue = rest;
      _stage = rest.isEmpty ? _Stage.form : _Stage.photo;
    });
  }

  Future<void> _takePhoto() async {
    final step = _queue.first;
    final capture = await Navigator.of(context).push<BillCapture>(
      MaterialPageRoute(
        builder: (ctx) =>
            BillCameraScreen(title: _photoSteps[step]!.$1, allowPdf: false, onCapture: (c) => Navigator.of(ctx).pop(c), onClose: () => Navigator.of(ctx).pop()),
      ),
    );
    if (capture == null || !mounted) return;
    setState(() => _reading = true);
    try {
      final form = FormData.fromMap({'step': step, 'image': MultipartFile.fromBytes(capture.bytes, filename: capture.name)});
      final res = await widget.session.api.dio.post<dynamic>('/api/items/scan-add/read-label', data: form);
      final body = res.data is Map ? Map<String, dynamic>.from(res.data as Map) : <String, dynamic>{};
      // The front photo becomes the item picture even when its text could not be read.
      final thumb = body['thumbnail']?.toString() ?? '';
      if (thumb.startsWith('data:image/') && mounted) {
        setState(() => _imageUrl = thumb);
        _draftChanged();
      }
      if ((res.statusCode ?? 500) >= 400) throw ApiException(body['error']?.toString() ?? 'Could not read this photo');
      final reading = body['reading'] is Map ? Map<String, dynamic>.from(body['reading'] as Map) : <String, dynamic>{};
      _apply(ProductFacts.fromReading(reading));
      _usedPhoto = true;
      // Batch and dates from the details photo fill only empty fields.
      for (final (c, key) in [(_batch, 'batch_number'), (_mfg, 'manufacturing_date'), (_exp, 'expiry_date')]) {
        final v = reading[key]?.toString().trim() ?? '';
        if (c.text.trim().isEmpty && v.isNotEmpty) c.text = v;
      }
      // Once any photo has shown the pack size, the size photo is not asked for.
      final hasSize = (reading['size']?.toString() ?? '').isNotEmpty;
      final queue = <String>[];
      for (var i = 0; i < _queue.length; i++) {
        if (i == 0 || !hasSize || _queue[i] != 'size') queue.add(_queue[i]);
      }
      _nextPhoto(queue);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } on DioException {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not read this photo. Try again or type the details.')));
    } finally {
      if (mounted) setState(() => _reading = false);
    }
  }

  /// The front photo as the item's picture, with a way to drop it.
  Widget _picture() {
    final data = Uri.tryParse(_imageUrl)?.data;
    return KCard(
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          if (data != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.sm),
              child: Image.memory(data.contentAsBytes(), width: 64, height: 64, fit: BoxFit.cover),
            ),
          const SizedBox(width: 12),
          Expanded(child: Text('Item picture from the front photo', style: AppText.body)),
          KTextButton(
            label: 'Remove',
            onTap: () {
              setState(() => _imageUrl = '');
              _draftChanged();
            },
          ),
        ],
      ),
    );
  }

  void _clearSuggestion() {
    setState(() {
      _lookupSource = null;
      for (final c in [_name, _brand, _size, _mrp]) {
        c.clear();
      }
    });
  }

  @override
  void dispose() {
    for (final c in [_barcode, _name, _brand, _size, _mrp, _selling, _purchase, _hsn, _opening, _batch, _mfg, _exp]) {
      c.dispose();
    }
    super.dispose();
  }

  ScanAddValues get _values => ScanAddValues(
    barcode: _barcode.text,
    name: _name.text,
    brand: _brand.text,
    size: _size.text,
    unit: _unit,
    mrp: _mrp.text,
    sellingPrice: _selling.text,
    purchasePrice: _purchase.text,
    taxRate: _tax,
    hsn: _hsn.text,
    openingStock: _opening.text,
    batchNumber: _batch.text,
    manufacturingDate: _mfg.text,
    expiryDate: _exp.text,
    pricesIncludeGst: _gstIncluded,
    imageUrl: _imageUrl,
  );

  /// Settings › Invoice defaults › prices include GST, so new items match how the shop bills.
  Future<void> _loadGstDefault() async {
    try {
      final body = await widget.session.api.getJson('/api/settings/invoice-defaults');
      final d = body['defaults'];
      if (mounted && !_gstTouched && d is Map && d['pricesIncludeGst'] == true) setState(() => _gstIncluded = true);
    } catch (_) {}
  }

  Future<void> _save() async {
    final errors = validateScanAdd(_values);
    setState(() => _errors = errors);
    if (errors.isNotEmpty) return;
    setState(() => _saving = true);
    try {
      final body = await widget.session.api.postJson('/api/items', scanAddItemBody(_values, lookupSource: _lookupSource), headers: {'X-Idempotency-Key': _key});
      final item = body['item'] is Map ? Map<String, dynamic>.from(body['item'] as Map) : const <String, dynamic>{};
      _lastError = null;
      if (mounted) {
        Navigator.of(context).pop(
          ScanAddEntry(
            name: item['name']?.toString() ?? _name.text.trim(),
            outcome: 'created',
            barcode: _barcode.text.trim(),
            itemId: item['id']?.toString(),
            qty: num.tryParse(_opening.text.trim()) ?? 0,
            source: _source,
            idempotencyKey: _key,
          ),
        );
      }
    } on ApiException catch (e) {
      // Everything typed stays; retrying sends the same key, so it cannot add the item twice.
      _lastError = e.message;
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String get _source => _lookupSource != null ? 'database' : (_usedPhoto ? 'photo' : 'manual');

  /// Leaving after a failed save keeps the product in the session as not saved, with its body and
  /// retry key, so the review can try it again.
  void _close() {
    final error = _lastError;
    if (error == null) {
      Navigator.of(context).pop();
      return;
    }
    Navigator.of(context).pop(
      ScanAddEntry(
        name: _name.text.trim().isEmpty ? (_barcode.text.trim().isEmpty ? 'Unnamed product' : _barcode.text.trim()) : _name.text.trim(),
        outcome: 'failed',
        barcode: _barcode.text.trim(),
        qty: num.tryParse(_opening.text.trim()) ?? 0,
        source: _source,
        body: scanAddItemBody(_values, lookupSource: _lookupSource),
        idempotencyKey: _key,
        error: error,
      ),
    );
  }

  /// Database lookup in progress, or the current label photo step with Take photo / Skip.
  Widget _stepView() {
    if (_stage == _Stage.looking) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const KSpinner(),
            const SizedBox(height: AppSpace.md),
            Text('Looking up ${widget.barcode} in product databases…', style: AppText.label),
          ],
        ),
      );
    }
    final (title, hint) = _photoSteps[_queue.first]!;
    return ListView(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
      children: [
        KCard(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(title, style: AppText.heading.copyWith(fontSize: 17)),
              const SizedBox(height: 4),
              Text(hint, style: AppText.label),
              if (_suggestions.isNotEmpty) ...[
                const SizedBox(height: AppSpace.sm),
                Text('Found ${_name.text} in a product database. You can check the details after this photo.', style: AppText.body),
              ],
              const SizedBox(height: AppSpace.md),
              KButton(
                label: _reading ? 'Reading the label…' : 'Take photo',
                icon: LucideIcons.camera,
                loading: _reading,
                onPressed: _reading ? null : _takePhoto,
              ),
              const SizedBox(height: AppSpace.sm),
              KButton.secondary(label: 'Skip', onPressed: _reading ? null : () => _nextPhoto(_queue)),
              const SizedBox(height: AppSpace.sm),
              KButton.secondary(label: 'Type details instead', onPressed: _reading ? null : () => setState(() => _stage = _Stage.form)),
            ],
          ),
        ),
      ],
    );
  }

  /// Which database filled the form, with its attribution link text and any disagreements.
  Widget _databaseNotice() {
    return KCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            _lookupSource != null
                ? 'Filled from a product database. Check the name and pack size against the pack before saving.'
                : 'Database details not used for this product.',
            style: AppText.body,
          ),
          if (_lookupSource != null)
            for (final c in _conflicts) ...[
              const SizedBox(height: AppSpace.sm),
              Text('Databases disagree on the ${c['field'] == 'quantity' ? 'pack size' : c['field']}. Pick the one on the pack:', style: AppText.label),
              const SizedBox(height: 4),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final v in (c['values'] as List? ?? const []).map((e) => e.toString()))
                    ActionChip(
                      label: Text(v),
                      onPressed: () => setState(() {
                        if (c['field'] == 'quantity') {
                          _size.text = v;
                        } else if (c['field'] == 'brand') {
                          _brand.text = v;
                        } else {
                          _name.text = v;
                        }
                      }),
                    ),
                ],
              ),
            ],
          const SizedBox(height: AppSpace.sm),
          for (final s in _suggestions)
            Text(
              '${s['attribution'] ?? ''}${s['certainty'] is num ? ' · match ${s['certainty']}/100' : ''}${s['source_url'] != null ? ' · ${s['source_url']}' : ''}',
              style: AppText.label,
            ),
          if (_lookupSource != null)
            Align(
              alignment: Alignment.centerLeft,
              child: KTextButton(label: 'Wrong product? Clear it', onTap: _clearSuggestion),
            ),
        ],
      ),
    );
  }

  Widget _f(TextEditingController c, String label, {String? field, bool number = false, String? hint}) => TextField(
    controller: c,
    keyboardType: number ? const TextInputType.numberWithOptions(decimal: true) : null,
    style: AppText.body,
    cursorColor: AppColors.brand,
    onChanged: field == null || !_errors.containsKey(field) ? null : (_) => setState(() => _errors = {..._errors}..remove(field)),
    decoration: InputDecoration(
      labelText: label,
      hintText: hint,
      errorText: field == null ? null : _errors[field],
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

  @override
  Widget build(BuildContext context) {
    // Same stock units as the website's New Item form; the pack size goes in "Size on pack".
    const units = [('PCS', 'PCS'), ('KG', 'KG'), ('LTR', 'LTR'), ('BOX', 'BOX'), ('NOS', 'NOS')];
    // GST_RATE_SLABS in lib/gst/rates.ts, the ones a grocery shop uses.
    const rates = [('0', '0%'), ('5', '5%'), ('18', '18%'), ('40', '40%')];
    const gap = SizedBox(height: AppSpace.md);
    return PopScope(
      // Back after a failed save goes through _close so the product is kept as not saved.
      canPop: _lastError == null,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _close();
      },
      child: Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(
                height: 64,
                child: Row(
                  children: [
                    const SizedBox(width: 4),
                    KIconButton(icon: LucideIcons.x, tooltip: 'Close', onTap: _close),
                    const SizedBox(width: 4),
                    Expanded(child: Text('New product', style: AppText.heading.copyWith(fontSize: 18))),
                  ],
                ),
              ),
              Expanded(
                child: _stage != _Stage.form
                    ? _stepView()
                    : ListView(
                        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
                        children: [
                          Text(
                            widget.barcode.isEmpty ? 'Adding a product without a barcode.' : 'Barcode ${widget.barcode} is not in your shop yet.',
                            style: AppText.label,
                          ),
                          gap,
                          if (_suggestions.isNotEmpty) ...[_databaseNotice(), gap],
                          if (_imageUrl.isNotEmpty) ...[_picture(), gap],
                          KCard(
                            padding: const EdgeInsets.all(14),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                _f(_name, 'Product name *', field: 'name', hint: 'Parle-G Biscuit'),
                                gap,
                                Row(
                                  children: [
                                    Expanded(child: _f(_brand, 'Brand', hint: 'Parle')),
                                    const SizedBox(width: AppSpace.md),
                                    Expanded(child: _f(_size, 'Size on pack', hint: '100 g')),
                                  ],
                                ),
                                gap,
                                Text('Unit', style: AppText.label),
                                const SizedBox(height: AppSpace.sm),
                                KChipBar<String>(
                                  value: _unit,
                                  padding: EdgeInsets.zero,
                                  options: units,
                                  onChanged: (v) {
                                    setState(() => _unit = v);
                                    _draftChanged();
                                  },
                                ),
                                gap,
                                _f(_barcode, 'Barcode', number: true),
                              ],
                            ),
                          ),
                          gap,
                          KCard(
                            padding: const EdgeInsets.all(14),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Row(
                                  children: [
                                    Expanded(child: _f(_mrp, 'MRP', field: 'mrp', number: true)),
                                    const SizedBox(width: AppSpace.md),
                                    Expanded(child: _f(_selling, 'Selling price', field: 'selling_price', number: true)),
                                  ],
                                ),
                                gap,
                                Row(
                                  children: [
                                    Expanded(child: _f(_purchase, 'Purchase price', field: 'purchase_price', number: true)),
                                    const SizedBox(width: AppSpace.md),
                                    Expanded(child: _f(_opening, 'Stock you have', field: 'opening_stock', number: true)),
                                  ],
                                ),
                                gap,
                                Text('GST rate', style: AppText.label),
                                const SizedBox(height: AppSpace.sm),
                                KChipBar<String>(
                                  value: _tax,
                                  padding: EdgeInsets.zero,
                                  options: rates,
                                  onChanged: (v) {
                                    setState(() => _tax = v);
                                    _draftChanged();
                                  },
                                ),
                                gap,
                                SwitchListTile.adaptive(
                                  contentPadding: EdgeInsets.zero,
                                  activeTrackColor: AppColors.brand,
                                  title: Text('Prices include GST', style: AppText.body),
                                  value: _gstIncluded,
                                  onChanged: (v) {
                                    setState(() {
                                      _gstIncluded = v;
                                      _gstTouched = true;
                                    });
                                    _draftChanged();
                                  },
                                ),
                                _f(_hsn, 'HSN (optional)', field: 'hsn_sac', number: true),
                                gap,
                                _f(_batch, 'Batch no. (optional)'),
                                gap,
                                Row(
                                  children: [
                                    Expanded(
                                      child: _f(_mfg, 'Mfg date', field: 'manufacturing_date', hint: '2026-09'),
                                    ),
                                    const SizedBox(width: AppSpace.md),
                                    Expanded(
                                      child: _f(_exp, 'Expiry date', field: 'expiry_date', hint: '2027-03'),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: AppSpace.sm),
                                Text(
                                  'With a batch or date, the stock you have is saved in that batch and sales use the oldest batch first.',
                                  style: AppText.label,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
              ),
              if (_stage == _Stage.form)
                KBottomBar(
                  children: [
                    Expanded(
                      child: KButton(label: 'Save and scan next', icon: LucideIcons.check, loading: _saving, onPressed: _save),
                    ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }
}
