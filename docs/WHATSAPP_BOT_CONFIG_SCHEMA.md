# WhatsApp Bot Configuration Schema Documentation

## Overview

This document describes the customer-facing configuration schema for the WhatsApp Bot feature. The schema is designed to be user-friendly while mapping safely to internal technical configurations.

## Architecture

```
User Interface (UI)
    ↓
WhatsAppBotUIConfig (User-Friendly)
    ↓ [Mapping Function]
WhatsAppBotConfig (Internal Technical)
    ↓
AI System (System Prompts & Behavior)
```

## Schema Structure

### 1. Communication Style
Controls how the bot communicates with customers.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tone` | select | `friendly_casual` | Communication style: friendly_casual, professional_formal, helpful_expert, efficient_direct |
| `responseLength` | select | `moderate` | Response detail level: brief, moderate, detailed |
| `useCustomerName` | boolean | `true` | Address customers by name when available |

### 2. Business Type
Defines the business model and customer type.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `customerType` | select | `individual` | Primary customers: individual, business, both |
| `requiresCreditTerms` | boolean | `false` | Enable credit/account-based ordering (B2B) |
| `minimumOrderAmount` | number | `undefined` | Minimum order value (optional) |

**Conditional Fields:**
- `requiresCreditTerms` and `minimumOrderAmount` only appear when `customerType` is `business` or `both`

### 3. Product Information
Controls what product details are shown to customers.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `showFields` | multiselect | `['price', 'stock', 'description']` | Product fields to display |
| `showOutOfStock` | boolean | `true` | Show out-of-stock products |
| `highlightBestSellers` | boolean | `false` | Emphasize popular products |

**Available Fields:**
- `price` - Product price
- `stock` - Stock availability
- `description` - Product description
- `specifications` - Technical specifications
- `ingredients` - Ingredients list (food/cosmetics)
- `sizes` - Available sizes (clothing/footwear)
- `colors` - Available colors
- `dimensions` - Dimensions (furniture/electronics)
- `warranty` - Warranty information

### 4. Ordering Process
Configures the order collection workflow.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `collectCustomerInfo.name` | boolean | `true` | Collect customer name |
| `collectCustomerInfo.phone` | boolean | `true` | Collect phone number |
| `collectCustomerInfo.email` | boolean | `false` | Collect email address |
| `collectCustomerInfo.address` | boolean | `true` | Collect delivery address |
| `requireConfirmation` | boolean | `true` | Require order confirmation |
| `allowBulkOrders` | boolean | `true` | Allow multiple items/quantities |
| `minimumQuantity` | number | `undefined` | Minimum quantity per item (optional) |

### 5. Promotions & Offers
Controls how promotions are handled.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `autoMentionActiveOffers` | boolean | `true` | Automatically mention active promotions |
| `highlightDiscounts` | boolean | `true` | Emphasize discounted products |
| `showExpiryDates` | boolean | `false` | Show promotion expiry dates |

### 6. Customer Experience
Advanced customer interaction settings.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enableUpselling` | boolean | `false` | Suggest related/complementary products |
| `upsellingStyle` | select | `subtle` | Recommendation frequency: subtle, moderate, aggressive |
| `personalizeForReturningCustomers` | boolean | `true` | Use purchase history for personalization |
| `enableTimeBasedGreetings` | boolean | `true` | Use time-based greetings (Good morning/evening) |

**Conditional Fields:**
- `upsellingStyle` only appears when `enableUpselling` is `true`

### 7. Business Hours (Optional)
Configures business hours and after-hours behavior.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `timezone` | string | - | Timezone (e.g., 'Asia/Kolkata') |
| `schedule` | array | - | Weekly schedule (7 days) |
| `schedule[].day` | select | - | Day of week: monday-sunday |
| `schedule[].isOpen` | boolean | - | Is business open this day |
| `schedule[].openTime` | string | - | Opening time (HH:mm format) |
| `schedule[].closeTime` | string | - | Closing time (HH:mm format) |
| `afterHoursMessage` | string | - | Message to show after hours |

### 8. Policies (Optional)
Custom policy text.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `returnPolicy` | string | `undefined` | Return policy text |
| `refundPolicy` | string | `undefined` | Refund policy text |
| `shippingPolicy` | string | `undefined` | Shipping policy text |
| `cancellationPolicy` | string | `undefined` | Cancellation policy text |

### 9. Advanced (Optional)
Advanced customization options.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `customInstructions` | string | `undefined` | Custom instructions for AI behavior |
| `industryTemplate` | select | `custom` | Industry preset: restaurant, retail, wholesale, services, manufacturing, custom |

## Hidden Fields (Not Exposed to Users)

The following technical fields are **NOT** exposed in the UI configuration but are derived automatically:

### 1. `systemPrompt.customInstructions`
- **Hidden Reason:** Too technical, could break AI behavior if misconfigured
- **Mapping:** Derived from `advanced.customInstructions` if provided
- **User Alternative:** Users can provide general guidance via `advanced.customInstructions`

### 2. `productContext.searchLimit` and `topProductsLimit`
- **Hidden Reason:** System-level optimization, users don't need to control
- **Default Values:** searchLimit: 5, topProductsLimit: 10
- **Rationale:** Fixed values optimize performance and token usage

### 3. `businessModel.accountBasedOrdering`
- **Hidden Reason:** Automatically derived from `businessType.requiresCreditTerms` and `businessType.customerType`
- **Logic:** `accountBasedOrdering = isB2B && requiresCreditTerms`

### 4. `timeAwareness.businessHours` (day numbers)
- **Hidden Reason:** Users select day names (monday, tuesday), system uses numbers (1-7)
- **Mapping:** Automatically converted in mapping function

### 5. `productContext.fieldsToInclude` (internal field names)
- **Hidden Reason:** Users select human-readable fields (price, stock), system uses internal names (sellingPrice, currentStock)
- **Mapping:** Automatically mapped in mapping function

### 6. System-level constants
- AI model parameters (temperature, maxTokens)
- Conversation history limits
- Token budgets
- **Hidden Reason:** These are infrastructure-level settings, not business logic

## Validation Rules

### Required Fields
- `communicationStyle.tone`
- `communicationStyle.responseLength`
- `businessType.customerType`
- `productInfo.showFields` (at least one field)

### Validation Rules

1. **Numeric Fields:**
   - `minimumOrderAmount` >= 0
   - `minimumQuantity` >= 1

2. **Time Format:**
   - `openTime` and `closeTime` must be in HH:mm format (24-hour)
   - Valid range: 00:00 - 23:59

3. **Business Hours:**
   - If `isOpen` is true, both `openTime` and `closeTime` must be provided
   - `closeTime` must be after `openTime`

4. **Conditional Fields:**
   - `upsellingStyle` is required if `enableUpselling` is true
   - `requiresCreditTerms` and `minimumOrderAmount` only valid for B2B businesses

5. **Product Fields:**
   - `showFields` must contain at least one valid field
   - Field names must be from the allowed list

## Example Configurations

See `types/whatsapp-bot-config-examples.ts` for complete examples:
- **Restaurant** (B2C, casual, delivery-focused)
- **Wholesale Business** (B2B, formal, credit terms)
- **Retail Clothing** (B2C, expert, size/color focus)

## Mapping Function

The mapping function (`mapUIConfigToBotConfig`) performs the following transformations:

1. **Business Type Mapping:**
   ```typescript
   isB2B = customerType === 'business' || customerType === 'both'
   isB2C = customerType === 'individual' || customerType === 'both'
   accountBasedOrdering = isB2B && requiresCreditTerms
   ```

2. **Product Fields Mapping:**
   ```typescript
   'price' → 'sellingPrice'
   'stock' → 'currentStock'
   'sizes' → 'sizes'
   // etc.
   ```

3. **Day Names → Numbers:**
   ```typescript
   'monday' → 1
   'tuesday' → 2
   // etc.
   ```

4. **System Defaults:**
   - `searchLimit`: 5 (fixed)
   - `topProductsLimit`: 10 (fixed)

## Backward Compatibility

- All fields in `WhatsAppBotUIConfig` are optional except those marked `required: true`
- Missing fields use defaults from `DefaultUIConfig`
- The mapping function handles missing/undefined fields gracefully
- Existing configurations can be loaded using `mapBotConfigToUIConfig` (reverse mapping)

## Usage in Code

```typescript
import { 
  WhatsAppBotUIConfig, 
  WhatsAppBotConfig,
  mapUIConfigToBotConfig,
  validateUIConfig,
  DefaultUIConfig
} from '@/types/whatsapp-bot-config';

// 1. Load user configuration
const userConfig: WhatsAppBotUIConfig = await loadFromDatabase();

// 2. Validate
const errors = validateUIConfig(userConfig);
if (errors.length > 0) {
  throw new Error(`Validation failed: ${errors.map(e => e.message).join(', ')}`);
}

// 3. Merge with defaults
const config = { ...DefaultUIConfig, ...userConfig };

// 4. Map to internal config
const internalConfig: WhatsAppBotConfig = mapUIConfigToBotConfig(config);

// 5. Use in AI system
await updateAISystemPrompt(internalConfig);
```

## Security & Safety

1. **No Prompt Injection:** Users cannot directly edit system prompts
2. **Validation-First:** All configurations are validated before mapping
3. **Type Safety:** TypeScript ensures type correctness
4. **Safe Defaults:** Default values prevent invalid states
5. **Field Sanitization:** All user inputs are validated and sanitized

## Future Enhancements

Potential additions (not in current schema):
- Multi-language support
- Regional customization (currency, date formats)
- A/B testing configurations
- Customer segment-specific configurations
- Time-based configuration overrides
