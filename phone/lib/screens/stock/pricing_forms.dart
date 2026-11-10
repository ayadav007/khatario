import 'package:flutter/material.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import '../sales/doc_action_sheets.dart';
import 'pricing_logic.dart';

/// A date that can also be left empty: the calendar field with a Clear link. [value] is
/// `yyyy-MM-dd` or ''.
class OptionalDateField extends StatelessWidget {
  const OptionalDateField({super.key, required this.label, required this.value, required this.onChanged});

  final String label;
  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        KDateField(label: label, value: DateTime.tryParse(value), onChanged: (d) => onChanged(ymd(d))),
        if (value.isNotEmpty) Align(alignment: Alignment.centerLeft, child: KTextButton(label: 'Clear', onTap: () => onChanged(''))),
      ],
    );
  }
}

/// A variant pick for [itemId]: "All variants" or one of its variants. Nothing when the item has none.
/// [variants] holds `{id, item_id, variant_name}` rows.
class VariantPickField extends StatelessWidget {
  const VariantPickField({super.key, required this.itemId, required this.variants, required this.value, required this.onChanged});

  final String itemId;
  final List<Map<String, dynamic>> variants;
  final String value;
  final ValueChanged<String> onChanged;

  static List<Map<String, dynamic>> of(List<Map<String, dynamic>> all, String itemId) =>
      [for (final v in all) if (docText(v['item_id']) == itemId && docText(v['id']).isNotEmpty) v];

  @override
  Widget build(BuildContext context) {
    final mine = of(variants, itemId);
    if (itemId.isEmpty || mine.isEmpty) return const SizedBox.shrink();
    return KPickField<String>(
      label: 'Variant',
      value: value,
      options: [('', 'All variants'), for (final v in mine) (docText(v['id']), docText(v['variant_name']))],
      onChanged: onChanged,
    );
  }
}

/// What a rate form hands to its save.
class RateFormValues {
  const RateFormValues({required this.itemId, required this.itemName, required this.variantId, required this.minQty, required this.rate});

  final String itemId;
  final String itemName;
  final String variantId;
  final String minQty;
  final RateFields rate;
}

/// The form behind a customer price, a category discount and a level rate: optional item and
/// variant, optional minimum quantity, price, discount and dates. [onSave] posts and throws an
/// [ApiException] when the server refuses (the page then stays filled); the page pops with true
/// when it, or [onRemove], finishes.
class RateFormPage extends StatefulWidget {
  const RateFormPage({
    super.key,
    required this.session,
    required this.title,
    required this.onSave,
    this.pickItem = false,
    this.itemId = '',
    this.itemName = '',
    this.subject,
    this.variants = const [],
    this.variantId = '',
    this.showPrice = true,
    this.showMinQty = false,
    this.initial = const RateDraft(),
    this.initialMinQty = '0',
    this.onRemove,
    this.removeLabel = 'Remove price',
    this.removeTitle = 'Remove price?',
    this.removeText = '',
    this.hint,
  });

  final AppSession session;
  final String title;
  final Future<void> Function(RateFormValues v) onSave;

  /// Ask for the item (adding). When false the item is fixed: [subject] names what is edited.
  final bool pickItem;
  final String itemId;
  final String itemName;
  final String? subject;
  final List<Map<String, dynamic>> variants;
  final String variantId;
  final bool showPrice;
  final bool showMinQty;
  final RateDraft initial;
  final String initialMinQty;
  final Future<void> Function()? onRemove;
  final String removeLabel;
  final String removeTitle;
  final String removeText;

  /// A line of help under the fields.
  final String? hint;

  @override
  State<RateFormPage> createState() => _RateFormPageState();
}

class _RateFormPageState extends State<RateFormPage> {
  late final _price = TextEditingController(text: widget.initial.price);
  late final _discount = TextEditingController(text: widget.initial.discount);
  late final _minQty = TextEditingController(text: widget.initialMinQty);
  late String _itemId = widget.itemId;
  late String _itemName = widget.itemName;
  late String _variantId = widget.variantId;
  late String _from = widget.initial.from;
  late String _to = widget.initial.to;
  bool _touched = false;
  bool _removing = false;

  @override
  void dispose() {
    _price.dispose();
    _discount.dispose();
    _minQty.dispose();
    super.dispose();
  }

  void _touch() => setState(() => _touched = true);

  Future<void> _save() async {
    if (widget.pickItem && _itemId.isEmpty) {
      showKToast(context, 'Pick an item', tone: KTone.negative);
      return;
    }
    final qtyError = widget.showMinQty ? minQtyError(_minQty.text) : null;
    if (qtyError != null) {
      showKToast(context, qtyError, tone: KTone.negative);
      return;
    }
    final check = checkRate(RateDraft(price: widget.showPrice ? _price.text : '', discount: _discount.text, from: _from, to: _to));
    if (check.error != null) {
      showKToast(context, check.error!, tone: KTone.negative);
      return;
    }
    if (check.rate!.isRemoval) {
      showKToast(context, widget.showPrice ? 'Enter a price, a discount %, or both' : 'Enter a discount %', tone: KTone.negative);
      return;
    }
    await widget.onSave(RateFormValues(itemId: _itemId, itemName: _itemName, variantId: _variantId, minQty: _minQty.text, rate: check.rate!));
    if (mounted) Navigator.of(context).pop(true);
  }

  Future<void> _remove() async {
    if (_removing) return;
    final ok = await askSheet(
      context,
      title: widget.removeTitle,
      text: widget.removeText,
      confirmLabel: 'Remove',
      cancelLabel: 'Keep it',
    );
    if (!ok || !mounted) return;
    _removing = true;
    try {
      await widget.onRemove!();
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not remove. Try again.', tone: KTone.negative);
    } finally {
      _removing = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: widget.title,
      saveLabel: 'Save',
      dirty: _touched,
      onSave: _save,
      children: [
        if (widget.pickItem)
          KAsyncPickField(
            label: 'Item',
            valueLabel: _itemName.isEmpty ? null : _itemName,
            search: (q) => searchItems(widget.session.api, q),
            onPicked: (id, name) => setState(() {
              if (id != _itemId) _variantId = '';
              _itemId = id;
              _itemName = name;
              _touched = true;
            }),
          )
        else if (widget.subject != null)
          Text(widget.subject!, style: AppText.bodyStrong),
        // An existing rate keeps its item and variant (its title names them); only a new one picks.
        if (widget.pickItem)
          VariantPickField(
            itemId: _itemId,
            variants: widget.variants,
            value: _variantId,
            onChanged: (v) => setState(() {
              _variantId = v;
              _touched = true;
            }),
          ),
        if (widget.showMinQty)
          KTextField(
            key: const Key('minQty'),
            label: 'Min qty',
            controller: _minQty,
            keyboard: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => _touch(),
          ),
        if (widget.showPrice) KAmountField(key: const Key('price'), label: 'Price', controller: _price),
        KTextField(
          key: const Key('discount'),
          label: 'Disc %',
          controller: _discount,
          hint: '0',
          keyboard: const TextInputType.numberWithOptions(decimal: true),
          onChanged: (_) => _touch(),
        ),
        OptionalDateField(label: 'From', value: _from, onChanged: (v) => setState(() { _from = v; _touched = true; })),
        OptionalDateField(label: 'To', value: _to, onChanged: (v) => setState(() { _to = v; _touched = true; })),
        if (widget.hint != null) Text(widget.hint!, style: AppText.caption),
        if (widget.onRemove != null) KButton(label: widget.removeLabel, kind: KButtonKind.danger, onPressed: _remove),
      ],
    );
  }
}

/// A one-field form (a level's name, a percentage). [onSave] posts and throws on refusal.
class SingleFieldFormPage extends StatefulWidget {
  const SingleFieldFormPage({
    super.key,
    required this.title,
    required this.label,
    required this.onSave,
    this.initial = '',
    this.hint,
    this.help,
    this.numeric = false,
    this.saveLabel = 'Save',
  });

  final String title;
  final String label;
  final String initial;
  final String? hint;
  final String? help;
  final bool numeric;
  final String saveLabel;

  /// Gets the trimmed text; returns the sentence to show when it cannot be saved, or null after saving.
  final Future<String?> Function(String text) onSave;

  @override
  State<SingleFieldFormPage> createState() => _SingleFieldFormPageState();
}

class _SingleFieldFormPageState extends State<SingleFieldFormPage> {
  late final _controller = TextEditingController(text: widget.initial);
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final error = await widget.onSave(_controller.text.trim());
    if (!mounted) return;
    if (error != null) {
      setState(() => _error = error);
      return;
    }
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: widget.title,
      saveLabel: widget.saveLabel,
      dirty: _controller.text.trim() != widget.initial.trim(),
      onSave: _save,
      children: [
        KTextField(
          key: const Key('single'),
          label: widget.label,
          controller: _controller,
          hint: widget.hint,
          error: _error,
          keyboard: widget.numeric ? const TextInputType.numberWithOptions(decimal: true, signed: true) : null,
          autofocus: true,
          onChanged: (_) => setState(() => _error = null),
        ),
        if (widget.help != null) Text(widget.help!, style: AppText.caption),
      ],
    );
  }
}

/// "Rice - Large" for an item id (and variant id) from the lookups the screens keep.
String rateTitle(Map<String, Map<String, dynamic>> items, List<Map<String, dynamic>> variants, String itemId, String? variantId) {
  final name = docText(items[itemId]?['name']);
  final base = name.isEmpty ? 'Item' : name;
  if (variantId == null) return base;
  for (final v in variants) {
    if (docText(v['id']) == variantId) return '$base - ${docText(v['variant_name'])}';
  }
  return base;
}

/// Items by id from `GET /api/items`.
Map<String, Map<String, dynamic>> itemsById(dynamic body) => {
      for (final i in docRows(body, 'items'))
        if (docText(i['id']).isNotEmpty) docText(i['id']): i,
    };

/// The item's own price line: "Item price ₹60".
String itemPriceLine(Map<String, dynamic>? item) {
  final price = docNum(item?['selling_price']);
  return price == null ? '' : 'Item price ${inr(price, maxFraction: 2)}';
}
