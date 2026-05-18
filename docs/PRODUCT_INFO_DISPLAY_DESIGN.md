# Product Information Display Section - Design Documentation

## Overview

The Product Information Display section allows businesses to configure which product fields are shown to customers and in what priority order. Includes industry presets for quick setup.

## UI Layout Structure

### Section Layout

```
┌─────────────────────────────────────────────────────────┐
│ Product Information Display                              │
│                                                          │
│ Choose which product details to show to customers and    │
│ set their display priority.                             │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ Industry Preset: [Dropdown ▼]                          │
│   ○ Food Business                                       │
│   ○ Retail Goods                                        │
│   ○ Services                                            │
│   ○ Custom                                              │
│                                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Fields to Display (Drag to prioritize)              │ │
│ │                                                       │ │
│ │ Priority  Field                    Visible          │ │
│ │ ─────────────────────────────────────────────────── │ │
│ │ [⋮⋮] ☑ Price                       ✓               │ │
│ │ [⋮⋮] ☑ Ingredients                 ✓               │ │
│ │ [⋮⋮] ☑ Stock Availability          ✓               │ │
│ │ [⋮⋮] ☑ Description                 ✓               │ │
│ │       ☐ Specifications                             │ │
│ │       ☐ Sizes                                      │ │
│ │       ☐ Colors                                     │ │
│ │       ☐ Dimensions                                 │ │
│ │       ☐ Warranty                                   │ │
│ │                                                       │ │
│ │ ℹ️ Fields are only shown if data exists             │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ ☑ Show Out of Stock Products                            │
│   Display products even when they are out of stock      │
│                                                          │
│ ☑ Highlight Best Sellers                                │
│   Emphasize popular products in responses               │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Field Definitions

### Available Product Fields

| Field | Label | Description | Applicable To |
|-------|-------|-------------|---------------|
| **price** | Price | Product selling price | All industries |
| **stock** | Stock Availability | Current stock quantity | Food, Retail |
| **description** | Description | Product description and features | All industries |
| **specifications** | Specifications | Technical specifications | Retail, Services |
| **ingredients** | Ingredients | List of ingredients | Food |
| **sizes** | Sizes | Available sizes (S, M, L, XL) | Retail |
| **colors** | Colors | Available colors and variants | Retail |
| **dimensions** | Dimensions | Product dimensions | Retail |
| **warranty** | Warranty | Warranty period and terms | Retail, Services |

## Industry Presets

### 1. Food Business
**Fields (Priority Order):**
1. Price
2. Ingredients
3. Stock Availability
4. Description

**Settings:**
- Show Out of Stock: Off (default)
- Highlight Best Sellers: On (default)

**Use Case:** Restaurants, food delivery, catering

### 2. Retail Goods
**Fields (Priority Order):**
1. Price
2. Stock Availability
3. Sizes
4. Colors
5. Description
6. Specifications
7. Dimensions
8. Warranty

**Settings:**
- Show Out of Stock: On (default)
- Highlight Best Sellers: Off (default)

**Use Case:** Clothing, electronics, furniture, general merchandise

### 3. Services
**Fields (Priority Order):**
1. Price
2. Description
3. Specifications
4. Warranty

**Settings:**
- Show Out of Stock: On (default)
- Highlight Best Sellers: Off (default)

**Use Case:** Professional services, consulting, maintenance

### 4. Custom
**Fields (Priority Order):**
1. Price
2. Stock Availability
3. Description

**Settings:**
- Show Out of Stock: On (default)
- Highlight Best Sellers: Off (default)

**Use Case:** Custom configuration

## Field Selection UI

### Checkbox Selection

- **Selected Fields:** Shown in prioritized list (draggable)
- **Unselected Fields:** Shown in available fields list
- **Visual Indicator:** Checkbox shows selection state
- **Drag Handle:** Visible on selected fields (⋮⋮ icon)

### Drag-to-Prioritize

**Behavior:**
- Selected fields are draggable
- Drag handle (⋮⋮) on the left side
- Top of list = highest priority
- Bottom of list = lowest priority
- Visual feedback during drag
- Snapshot on drop

**Priority Effect:**
- Higher priority fields are shown first
- Higher priority fields are emphasized in responses
- Order affects how information is presented

## Validation Rules

### Required Fields

- **Selected Fields:** At least one field must be selected
- **Industry Preset:** Must be one of: food, retail, services, custom

### Field Validation

1. **At Least One Field:**
   - Error if no fields selected

2. **Valid Fields:**
   - Error if invalid field in selection
   - Only fields from available list allowed

3. **No Duplicates:**
   - Error if duplicate fields in selection

4. **Boolean Values:**
   - showOutOfStock must be boolean
   - highlightBestSellers must be boolean

### Warnings (Non-blocking)

1. **Price Not Selected:**
   - Warning: "Price is typically important information for customers"

2. **Industry Mismatch:**
   - Warning if selected fields don't match industry preset
   - Suggests using preset defaults

## Field Visibility Rules

**Important:** Fields are only shown if data exists in the product catalog.

| Field | When Shown |
|-------|------------|
| Price | Always (if product has a price) |
| Stock | Only for products (not services), if stock tracking enabled |
| Description | If product has a description |
| Specifications | If product has specifications data |
| Ingredients | If product has ingredients data |
| Sizes | If product has size variants |
| Colors | If product has color variants |
| Dimensions | If product has dimensions data |
| Warranty | If product has warranty information |

**Note to Users:**
"Fields are only displayed if the data exists in your product catalog. Selecting a field does not guarantee it will always appear - it depends on your product data."

## Mapping Logic

### Industry Preset → Configuration

```typescript
// User selects "Food Business" preset
applyIndustryPreset('food')
// Returns:
{
  industryPreset: 'food',
  selectedFields: ['price', 'ingredients', 'stock', 'description'],
  showOutOfStock: false,
  highlightBestSellers: true
}
```

### Configuration → Internal Config

```typescript
// User config
{
  selectedFields: ['price', 'ingredients', 'stock', 'description'],
  showOutOfStock: false,
  highlightBestSellers: true
}

// Internal config
{
  productInfo: {
    showFields: ['price', 'ingredients', 'stock', 'description'],
    showOutOfStock: false,
    highlightBestSellers: true
  }
}
```

### Internal Config → Configuration (Reverse)

```typescript
// Internal config
{
  productInfo: {
    showFields: ['price', 'ingredients', 'stock', 'description'],
    showOutOfStock: false,
    highlightBestSellers: true
  }
}

// Determines industry preset by matching fields
// Returns: industryPreset: 'food' (if matches preset exactly)
```

## Restaurant Example Configuration

```typescript
{
  industryPreset: 'food',
  selectedFields: [
    'price',        // 1. Price (highest priority)
    'ingredients',  // 2. Ingredients
    'stock',        // 3. Stock availability
    'description'   // 4. Description
  ],
  showOutOfStock: false,      // Don't show unavailable items
  highlightBestSellers: true  // Highlight popular dishes
}
```

### Behavior Example

**Product:** "Butter Chicken" (₹350, In stock, Popular dish)

**Response with this config:**
```
Butter Chicken
Price: ₹350
Ingredients: Chicken, tomato, cream, spices
Stock: Available
Description: Creamy tomato-based curry with tender chicken pieces
```

**Priority Effect:**
- Price is shown first and emphasized
- Ingredients shown second (important for food)
- Stock shown third
- Description shown last

## UI Implementation Notes

### Industry Preset Selector

**Type:** Radio buttons or dropdown
**Behavior:**
- Selecting a preset applies default fields
- User can then customize if needed
- Selecting "Custom" clears preset association

### Field Selection List

**Type:** Draggable list with checkboxes
**Layout:**
- Selected fields: Draggable list (top section)
- Available fields: Static checkboxes (bottom section)
- Drag handle: Left side of selected items
- Visual feedback: Highlight on drag

### Drag-to-Reorder

**Implementation:**
- Use drag-and-drop library (e.g., react-beautiful-dnd, dnd-kit)
- Visual feedback during drag
- Snapshot on drop
- Maintains order in state

### Field Visibility Indicator

**Show:**
- ✓ icon for selected fields
- Field count: "X fields selected"
- Help text: "Fields only shown if data exists"

## Usage Example

```typescript
import { 
  ProductInfoField,
  applyIndustryPreset,
  validateProductInfoConfig,
  reorderFields,
  RestaurantProductInfoExample
} from '@/types/product-info-presets';

// 1. Apply industry preset
const config = applyIndustryPreset('food');

// 2. Reorder fields (drag-and-drop)
const reorderedFields = reorderFields(config.selectedFields, 2, 0);
// Moves field from index 2 to index 0

// 3. Validate
const validation = validateProductInfoConfig(config);
if (!validation.valid) {
  // Handle errors
}

// 4. Map to internal config
const internalConfig = mapProductInfoToInternalConfig(config);

// 5. Save
await saveConfig(internalConfig);
```

## Design Principles

### ✅ Rules Followed

1. **Checkbox-based Selection:**
   - ✅ All fields use checkboxes
   - ✅ Clear visual selection state

2. **Industry Presets:**
   - ✅ Food business preset
   - ✅ Retail goods preset
   - ✅ Services preset
   - ✅ Custom option

3. **Drag-to-Prioritize:**
   - ✅ Selected fields are draggable
   - ✅ Order determines priority
   - ✅ Visual feedback during drag

4. **Fields Only Shown if Data Exists:**
   - ✅ System handles this (not user configurable)
   - ✅ Clear note to users

5. **No Custom Field Creation:**
   - ✅ Users can only select from predefined fields
   - ✅ No free text input for fields

## Accessibility

- Checkboxes have proper labels
- Drag handles have ARIA labels ("Drag to reorder")
- Keyboard navigation for field selection
- Screen reader announces field order changes
- Clear focus indicators
- Help text for each field
