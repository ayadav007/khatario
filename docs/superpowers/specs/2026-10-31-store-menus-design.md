# Store menus (dropdowns and mega menus): design

Date: 2026-10-31
Status: approved in chat section by section, awaiting written review
Part of: store page customisation, sub-project 1 of 4 (menus, then cart page, checkout page, sign-up and login page; each gets its own spec)

## 1. Goal

Let any store owner build the header and footer navigation they want in Studio 2: plain links, simple dropdowns, mega menus with grouped columns and a picture, and an automatic "All categories" menu, on computers and phones. Every store gets the same tools; nothing is limited to a store type.

### Decisions taken with the user

| Topic | Decision |
|---|---|
| Who it is for | Every store: boutiques that hand-build menus and stores with many categories that want them automatic |
| How owners build menus | Option 3: named menus in a **Menus** area of the theme (Shopify style); the Header and Footer each pick a menu |
| Depth | Three levels. Links under a top item = simple dropdown; groups with links = mega menu (the shape decides, no setting) |
| Automatic categories | A top item can be **All categories (automatic)**, listing every category with products, optional photos |
| Pictures | One optional picture per top item (image, caption, link), at the side of its dropdown |
| Header layouts | Two: **Menu below logo** (today) and **All on one line**; plus **Menu text: Normal / CAPITALS** |
| Phones | A ☰ button opening a side panel; items with children expand in place |
| Today's links | Converted once into menus, then the old blocks go away: Menus is the only place to edit links |

### Assumptions (not stated by the user)

- Menus live **inside the theme** (`ThemeData.settings.menus`), so they are drafted, previewed, undone, versioned and published with it. Shopify keeps menus store-wide; the user can still ask for that.
- The Quick preset keeps its app-style header: its pills come from the menu's top items.
- No database migration: menus are part of the theme JSON.

### Out of scope

Menus shared across themes; products inside a mega menu; a centred-logo layout; more than one picture per item; translations.

## 2. Data

```ts
// lib/store/engine/types.ts
interface MenuItem {
  id: string;              // stable id (same alphabet as section/block ids)
  label: string;           // 1..40 chars
  link: string;            // '' = no link (a group heading); same rules as a `url` setting
  children?: MenuItem[];   // depth 3 at most: top -> group -> link
  // Top items only (dropped elsewhere by the sanitiser):
  highlight?: boolean;
  source?: 'links' | 'categories';   // 'categories' = automatic; its children are ignored
  category_photos?: boolean;         // with source 'categories'
  picture?: { image: string; caption: string; link: string };  // caption <= 60
}
interface Menu { id: string; name: string; items: MenuItem[] }   // name <= 40
interface ThemeSettings { /* existing fields */ menus: Menu[] }
```

Limits (new `ENGINE_LIMITS.menus` in `lib/store/engine/shared.ts`): 10 menus, 12 items per level, 3 levels, 40-character labels and names, 60-character captions. The ids `main` and `footer` are the starting menus.

Header section settings (replacing its `menu_link` blocks): `menu` (new setting type `menu`, a menu id, default `main`), `menu_layout` (`below` | `inline`, default `below`), `menu_caps` (checkbox, default false). Footer section: `menu` (default `footer`), replacing its `link_column` blocks.

What a top item's dropdown is, from its shape (`menuItemKind` in `lib/store/engine/menus.ts`): `categories` when `source` is categories; `mega` when any child has children; `dropdown` when it has children; `link` otherwise.

## 3. Conversion of existing themes

Runs inside `sanitizeThemeData` (load, save, version restore, preset creation), on the **raw** data, before the header and footer are sanitised (their schemas no longer declare the old block types, so sanitising first would drop them). When the raw settings have no `menus` array:

- the header section's enabled `menu_link` blocks, in `block_order`, become the `main` menu (label, link, highlight);
- each enabled footer `link_column` block becomes a top item of the `footer` menu (heading as label, no link), its `Label|/url` lines become its children (bad lines skipped, same parsing as today's `footerColumns`);
- the header's and footer's `menu` settings are set to `main` and `footer`.

A theme that already has `menus` is left alone, so the conversion runs once and repeated runs give the same result. Presets (`lib/store/engine/presets/*`) and the old-store migration (`migrate-studio.ts`) keep producing the old blocks; every theme passes through `sanitizeThemeData`, so the same conversion gives them their menus (one code path).

## 4. Editor (Studio 2)

- A **Menus** row under "Theme settings" in the left tree (`SectionTree.tsx`) opens the menus list in the right panel (`SettingsPanel.tsx`): name, item count, Add menu, Rename, Delete. A menu used by the Header or Footer cannot be deleted ("Used by the Header. Pick another menu there first.").
- **Menu editor**: the items as an indented tree. Each row: drag handle (reorder within its level, `@dnd-kit` as elsewhere), label, ▸ fold, ⋮ with Add item under this, Move up, Move down, Move in (child of the item above), Move out, Duplicate, Delete. "Add item" at the end of each level. The three-level limit and the 12-per-level limit disable the actions that would break them.
- **Item form**: Label, Link (`LinkPicker`); top items also Highlight, Shows: Links / All categories (automatic) with Show category photos, Picture (image field, caption, link). A hand-picked link to a deleted category shows "This category no longer exists".
- **Ops** (`lib/store/engine/editor/ops.ts`, pure, through the existing history so undo/redo work): add, rename and delete menu; add, update, move up/down, move in/out, duplicate, delete item.
- **Preview**: changes show live; selecting a top item tells the preview (editor bridge message) to hold that item's dropdown open.
- Header settings show Menu (select of menus + "Edit menus" link), Layout, Menu text. Footer settings show Menu.

## 5. Storefront

Rendering lives in a new `components/store/engine/menu/` (desktop nav, dropdown panel, phone side panel, footer columns), used by the Header and Footer sections and the Quick header.

- **Menu below logo**: today's nav row; items with children get ▾.
- **All on one line**: logo, menu, search and icons in one row. Items that do not fit fold into a **More ▾** item (measured with `ResizeObserver`; the fold-up rule is a pure function, `foldMenu(widths, available)`).
- **Opening**: hover after a short delay, click on ▾, or keyboard (Enter/Space/arrow keys); closes on Esc, outside click, or pointer leaving after a grace period; one open at a time. A top item with its own link keeps the label as a link and has a separate ▾ button (disclosure navigation pattern); the panel starts with "View all <label>".
- **Panels**: simple dropdown = small card of links; mega = full-width panel, one column per group (bold heading, linked when it has a link), picture on the right with caption; automatic categories = names in as many columns as fit, small round photos when on, scrolling inside a max height. Panels use the Header section's scheme colours (card, text, border) and a soft shadow. CAPITALS = uppercase top items with wider letter spacing.
- **Phones** (store container ≤ 640px): ☰ in the header opens a left side panel with an overlay; closes with ✕, overlay tap or Back; page scroll locked; focus kept inside. Items with children expand in place; groups are small headings; the picture closes its item's list; automatic categories expand into the category list with photos. Search stays in the header.
- **Quick**: pills from the menu's top items; a pill with children shows ▾ and opens the side panel with that item expanded; Quick's category pills are unchanged.
- **Footer**: top items are column headings, their children the links; third-level links are listed under their group.
- All links are server-rendered in the HTML (panels hidden until opened). Automatic categories come from the header's existing optional categories data.

## 6. Errors and fallbacks

- The sanitiser drops invalid menus and items (bad ids, over the limits, too deep, bad links or images) and never stores them; top-only fields are dropped below the top level.
- Header or Footer pointing at a missing menu: fall back to `main` (header) or `footer` (footer), else no menu; the rest of the header still renders.
- Hand-picked links to deleted categories are hidden on the storefront (the header already has the category list).
- Automatic categories when the category lookup fails: the item renders as a plain link to `/catalog`.
- Without JavaScript the top links still work; dropdowns need JavaScript.

## 7. Testing

- Unit (jest): menu sanitiser (limits, depth, top-only fields, links); conversion (header blocks, footer text, highlight, empty, idempotent, before header sanitising); `menuItemKind`; `foldMenu`; every editor op including the depth and per-level limits, deleting a menu in use, and undo; footer columns from a menu; presets have `main` and `footer`.
- DB (`kh_phase2_test` only): save and reload a theme with menus through the themes repo; an old theme without menus loads converted.
- Staging (manual): both desktop layouts with keyboard only, screen reader names, phone side panel, Quick pills, footer, the Menus editor tree with drag and Move in/out, preview holding a dropdown open.
