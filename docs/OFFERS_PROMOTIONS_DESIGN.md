# Offers & Promotions Section - Design Documentation

## Overview

The Offers & Promotions section allows businesses to configure how the WhatsApp bot mentions and displays offers to customers. **Important:** This section controls DISPLAY behavior only - offers are created and managed in the Promotions section.

## UI Layout Structure

### Section Layout

```
┌─────────────────────────────────────────────────────────┐
│ Offers & Promotions                                      │
│                                                          │
│ Configure how the bot mentions and displays offers and   │
│ promotions to customers.                                 │
│                                                          │
│ ℹ️ Note: This controls when and how offers are shown.   │
│    To create or manage offers, use the Promotions        │
│    section in Settings.                                  │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ ☑ Automatically Mention Current Offers                  │
│   Enable the bot to automatically mention active offers  │
│   and promotions in conversations                        │
│                                                          │
│ Show Offers: [Dropdown ▼]                               │
│   • Always                                              │
│     Automatically mention offers in relevant             │
│     conversations                                        │
│   • Only when customer asks about price                 │
│     Show offers only when customers ask about            │
│     pricing or discounts                                 │
│                                                          │
│ ☐ Highlight Expiring Offers                             │
│   Emphasize offers that are expiring soon in bot         │
│   responses                                              │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Field Definitions

### 1. Automatically Mention Current Offers

**Type:** Toggle/Switch
**Required:** No
**Default:** Enabled (true)

**Behavior:**
- When **Enabled:** Bot proactively mentions offers
- When **Disabled:** Bot only mentions offers if explicitly asked

**Help Text:**
"When enabled, the bot will proactively mention relevant offers. When disabled, offers are only shown if explicitly asked."

### 2. Show Offers

**Type:** Dropdown/Select
**Required:** Yes (when auto-mention is enabled)
**Default:** "Always"

**Options:**

#### Always
- **Label:** "Always"
- **Description:** "Automatically mention offers in relevant conversations"
- **Example:** Bot mentions offers proactively when discussing products or orders

#### Only when customer asks about price
- **Label:** "Only when customer asks about price"
- **Description:** "Show offers only when customers ask about pricing or discounts"
- **Example:** Bot mentions offers when customer asks "What's the price?" or "Any discounts?"

**Conditional Display:**
- This field is only visible/enabled when "Automatically Mention Current Offers" is enabled
- When auto-mention is disabled, this field is hidden (not applicable)

### 3. Highlight Expiring Offers

**Type:** Toggle/Switch
**Required:** No
**Default:** Disabled (false)

**Behavior:**
- When **Enabled:** Bot emphasizes offers that are expiring soon
- When **Disabled:** All offers are shown equally

**Help Text:**
"When enabled, the bot will emphasize offers that are expiring soon, creating urgency for customers."

## Configuration Options

### Option 1: Aggressive Promotion
```typescript
{
  autoMentionOffers: true,
  showOffersWhen: 'always',
  highlightExpiringOffers: true
}
```
**Behavior:** Always mention offers, emphasize expiring ones

### Option 2: Moderate Promotion
```typescript
{
  autoMentionOffers: true,
  showOffersWhen: 'always',
  highlightExpiringOffers: false
}
```
**Behavior:** Always mention offers, don't over-emphasize

### Option 3: Conservative Promotion
```typescript
{
  autoMentionOffers: true,
  showOffersWhen: 'on_price_inquiry',
  highlightExpiringOffers: false
}
```
**Behavior:** Only mention when asked about price

### Option 4: Disabled
```typescript
{
  autoMentionOffers: false,
  showOffersWhen: 'always', // Doesn't matter when disabled
  highlightExpiringOffers: false
}
```
**Behavior:** Don't automatically mention offers

## Validation Rules

### Required Fields

- **showOffersWhen:** Required when `autoMentionOffers` is enabled
- **autoMentionOffers:** Must be boolean
- **highlightExpiringOffers:** Must be boolean

### Field Validation

1. **autoMentionOffers:**
   - Must be boolean (true/false)
   - Error if not boolean

2. **showOffersWhen:**
   - Must be one of: 'always', 'on_price_inquiry'
   - Error if invalid value
   - Only validated when autoMentionOffers is enabled

3. **highlightExpiringOffers:**
   - Must be boolean (true/false)
   - Error if not boolean

### Warnings (Non-blocking)

1. **Auto-mention disabled + Always mode:**
   - Warning: "Auto-mention is disabled, so 'Always' setting will not have any effect"
   - Still allows the configuration (user might enable later)

## Guardrails

### 1. Conditional Field Display

**Rule:** `showOffersWhen` field is hidden/disabled when `autoMentionOffers` is false

**Implementation:**
- Field has `conditional` property
- UI only shows field when condition is met
- Value is preserved even when hidden

### 2. Valid Option Enforcement

**Rule:** `showOffersWhen` must be a valid option

**Implementation:**
- Validation checks against allowed values
- Invalid values are auto-corrected to default

### 3. Read-Only Offer Data

**Rule:** Users cannot create, edit, or delete offers from this section

**Implementation:**
- Clear disclaimer text
- No offer creation/edit UI
- Link to Promotions section for management
- System reads offers from promotions system

## Mapping Logic

### User Config → Internal Config

```typescript
// User Config
{
  autoMentionOffers: true,
  showOffersWhen: 'always',
  highlightExpiringOffers: true
}

// Internal Config (UI Config Format)
{
  promotions: {
    autoMentionActiveOffers: true,
    highlightDiscounts: true,  // true when showOffersWhen === 'always'
    showExpiryDates: true
  }
}
```

### Internal Config → User Config (Reverse)

```typescript
// Internal Config (UI Config Format)
{
  promotions: {
    autoMentionActiveOffers: true,
    highlightDiscounts: true,
    showExpiryDates: true
  }
}

// User Config
{
  autoMentionOffers: true,
  showOffersWhen: 'always',  // Determined by highlightDiscounts
  highlightExpiringOffers: true
}
```

### Mapping Rules

1. **autoMentionOffers** → `promotions.autoMentionActiveOffers`
   - Direct mapping (boolean to boolean)

2. **showOffersWhen** → `promotions.highlightDiscounts`
   - 'always' → true
   - 'on_price_inquiry' → false (but autoMentionActiveOffers is still true)

3. **highlightExpiringOffers** → `promotions.showExpiryDates`
   - Direct mapping (boolean to boolean)

## Read-Only Offer Data

### What Users CANNOT Do

1. **Create Offers:**
   - ❌ Cannot create new offers
   - ✅ Must use Promotions section

2. **Edit Offers:**
   - ❌ Cannot modify offer details
   - ❌ Cannot change discount amounts
   - ❌ Cannot change expiry dates
   - ✅ Must use Promotions section

3. **Delete Offers:**
   - ❌ Cannot delete offers
   - ✅ Must use Promotions section

4. **Discount Calculations:**
   - ❌ Cannot set discount percentages
   - ❌ Cannot calculate discount amounts
   - ✅ Discounts are set in Promotions section

### What Users CAN Do

1. **Control Display:**
   - ✅ Enable/disable automatic mentioning
   - ✅ Choose when to show offers
   - ✅ Toggle expiring offer highlighting

2. **Control Behavior:**
   - ✅ Control bot's proactive behavior
   - ✅ Control response style

## How Offers Work

### System Behavior

1. **Offer Source:**
   - Offers are created/managed in Promotions section
   - Bot reads active offers from promotions system
   - Only active offers (within date range) are considered

2. **Filtering:**
   - Offers are automatically filtered based on promotion settings
   - Only active, non-expired offers are shown
   - Business-specific promotions only

3. **Display Logic:**
   - If `autoMentionOffers = true` and `showOffersWhen = 'always'`:
     - Bot proactively mentions offers in relevant conversations
   - If `autoMentionOffers = true` and `showOffersWhen = 'on_price_inquiry'`:
     - Bot only mentions offers when customer asks about price/discounts
   - If `autoMentionOffers = false`:
     - Bot doesn't automatically mention offers (only if explicitly asked)

4. **Expiring Offers:**
   - If `highlightExpiringOffers = true`:
     - Bot emphasizes offers expiring soon
     - Adds urgency messaging
   - If `highlightExpiringOffers = false`:
     - All offers shown equally

## Example Behaviors

### Scenario 1: Aggressive Promotion
**Config:**
- Auto-mention: Enabled
- Show when: Always
- Highlight expiring: Enabled

**Bot Behavior:**
- Proactively mentions offers: "We have a special offer: 20% off!"
- Emphasizes expiring: "Hurry! This offer expires tomorrow!"
- Mentions in product discussions and order confirmations

### Scenario 2: Conservative Promotion
**Config:**
- Auto-mention: Enabled
- Show when: Only when customer asks about price
- Highlight expiring: Disabled

**Bot Behavior:**
- Only mentions when asked: Customer: "Any discounts?" Bot: "Yes! We have..."
- Doesn't proactively mention offers
- Doesn't emphasize expiring offers

### Scenario 3: Disabled
**Config:**
- Auto-mention: Disabled

**Bot Behavior:**
- Doesn't automatically mention offers
- Only mentions if explicitly asked (natural conversation)
- Other settings don't apply

## UI Implementation Notes

### Conditional Field Display

```typescript
// Show "Show Offers" dropdown only when autoMentionOffers is enabled
{config.autoMentionOffers && (
  <SelectField
    label="Show Offers"
    value={config.showOffersWhen}
    options={[...]}
  />
)}
```

### Disclaimer Section

**Visual Treatment:**
- Info icon (ℹ️)
- Light background color
- Clear, concise text
- Link to Promotions section (if available)

### Help Text

**Location:**
- Tooltip on field labels
- Helper text below fields
- Info icons with hover tooltips

## Integration Points

### With Promotions System
- **Reads:** Active promotions from promotions system
- **Does NOT Write:** Cannot create/edit/delete promotions
- **Filtering:** Uses promotion filters (active, date range, etc.)

### With Conversation System
- Uses config to determine when to mention offers
- Checks offer visibility settings
- Applies expiring offer highlighting

### With Product System
- Mentions offers when discussing products
- Links offers to relevant products
- Shows offer-affected pricing

## Usage Example

```typescript
import { 
  OffersPromotionsField,
  validateOffersConfig,
  applyOffersGuardrails,
  mapOffersToInternalConfig,
  ExampleOffersConfigs
} from '@/types/offers-promotions-presets';

// 1. Use example config
const config = ExampleOffersConfigs.moderate.config;

// 2. Apply guardrails
const safeConfig = applyOffersGuardrails(config);

// 3. Validate
const validation = validateOffersConfig(safeConfig);
if (!validation.valid) {
  // Handle errors
}

// 4. Map to internal config
const internalConfig = mapOffersToInternalConfig(safeConfig);

// 5. Save
await saveConfig(internalConfig);
```

## Design Principles

### ✅ Rules Followed

1. **No Discount Calculation:**
   - ✅ Users cannot set discount amounts here
   - ✅ Discounts are managed in Promotions section

2. **No Expiry Modification:**
   - ✅ Users cannot change expiry dates here
   - ✅ Expiry dates are managed in Promotions section

3. **Read-Only Offer Data:**
   - ✅ Clear disclaimer that offers are managed elsewhere
   - ✅ No offer creation/edit UI
   - ✅ Only controls display behavior

4. **Toggle-Based Configuration:**
   - ✅ Simple toggles for enable/disable
   - ✅ Dropdown for selection
   - ✅ No complex rules

## Accessibility

- Toggles have clear labels and states
- Dropdown has descriptive options
- Help text is accessible
- Disclaimer is clearly marked
- Keyboard navigation supported
- Screen reader friendly
