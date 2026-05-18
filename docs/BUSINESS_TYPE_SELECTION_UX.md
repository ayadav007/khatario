# Business Type Selection - UX Design & Implementation

## Overview

The Business Type selection is the primary configuration step for the WhatsApp Bot. It automatically configures communication style, payment options, and ordering flow based on the selected business type.

## User Experience Flow

### Step 1: Selection
User sees three options:
- **Retail** - Selling directly to individual customers
- **Wholesale** - Selling to other businesses in bulk
- **Both** - Serving both individual customers and businesses

### Step 2: Auto-Configuration
When user selects a type, the system automatically configures:
- Communication tone
- Payment style
- Ordering flow
- Customer information requirements

### Step 3: Customization (Optional)
User can then customize any of the auto-configured settings in their respective sections.

## UI Component Structure

```
┌─────────────────────────────────────────────────────────┐
│ Business Type                                            │
│                                                          │
│ Select the type of customers you serve. This will       │
│ automatically configure the bot's communication style,   │
│ payment options, and ordering process.                   │
│                                                          │
│ ⚪ Retail                                                │
│    Selling to individual customers                       │
│    • Casual, friendly communication                      │
│    • Quick payment processing                            │
│    • Flexible ordering for any quantity                  │
│                                                          │
│ ⚪ Wholesale                                             │
│    Selling to other businesses in bulk                  │
│    • Professional, formal communication                  │
│    • Credit terms and account-based ordering            │
│    • Minimum order quantities                            │
│                                                          │
│ ⚪ Both                                                  │
│    Serving both individual customers and businesses     │
│    • Adaptive communication style                        │
│    • Flexible payment options                            │
│    • Different ordering flows for each type             │
│                                                          │
│ ℹ️ You can customize these settings later in each        │
│    section.                                              │
└─────────────────────────────────────────────────────────┘
```

## Field Definition

### Field Properties
- **Type:** Radio Group (single selection)
- **Required:** Yes
- **Default:** Retail (if not set)
- **Auto-Config:** Yes (applies preset on selection)

### Options

#### 1. Retail
- **Label:** "Retail"
- **Description:** "Selling directly to individual customers"
- **Auto-Config:**
  - Tone: Friendly & Casual
  - Payment: Immediate payment required
  - Ordering: Any quantity allowed
  - Customer Info: Name, phone, address
  - Upselling: Enabled (moderate)

#### 2. Wholesale
- **Label:** "Wholesale"
- **Description:** "Selling to other businesses in bulk"
- **Auto-Config:**
  - Tone: Professional & Formal
  - Payment: Credit terms available
  - Ordering: Minimum quantity (10 units)
  - Customer Info: Name, phone, email, address
  - Upselling: Disabled

#### 3. Both
- **Label:** "Both"
- **Description:** "Serving both individual customers and businesses"
- **Auto-Config:**
  - Tone: Helpful & Expert
  - Payment: Flexible (immediate + credit)
  - Ordering: Flexible quantities
  - Customer Info: Name, phone, email, address
  - Upselling: Enabled (moderate)

## Default Configuration Mappings

### Retail → Internal Config
```typescript
{
  businessType: { customerType: 'individual' },
  communicationStyle: { tone: 'friendly_casual', responseLength: 'brief' },
  businessType: { requiresCreditTerms: false, minimumOrderAmount: undefined },
  orderingProcess: { 
    collectCustomerInfo: { name: true, phone: true, email: false, address: true },
    minimumQuantity: undefined
  },
  customerExperience: { enableUpselling: true, upsellingStyle: 'moderate' }
}
```

### Wholesale → Internal Config
```typescript
{
  businessType: { customerType: 'business' },
  communicationStyle: { tone: 'professional_formal', responseLength: 'detailed' },
  businessType: { requiresCreditTerms: true, minimumOrderAmount: 5000 },
  orderingProcess: { 
    collectCustomerInfo: { name: true, phone: true, email: true, address: true },
    minimumQuantity: 10
  },
  customerExperience: { enableUpselling: false, upsellingStyle: 'subtle' }
}
```

### Both → Internal Config
```typescript
{
  businessType: { customerType: 'both' },
  communicationStyle: { tone: 'helpful_expert', responseLength: 'moderate' },
  businessType: { requiresCreditTerms: true, minimumOrderAmount: undefined },
  orderingProcess: { 
    collectCustomerInfo: { name: true, phone: true, email: true, address: true },
    minimumQuantity: undefined
  },
  customerExperience: { enableUpselling: true, upsellingStyle: 'moderate' }
}
```

## Mapping Logic

### Selection → Configuration
1. User selects business type (retail/wholesale/both)
2. System applies corresponding preset from `BusinessTypePresets`
3. Existing customizations are preserved (deep merge)
4. Only preset fields are overridden
5. User is notified: "Settings updated. You can customize them below."

### Internal Mapping
```typescript
// User selection → Internal config
'retail' → customerType: 'individual'
'wholesale' → customerType: 'business'
'both' → customerType: 'both'
```

### Reverse Mapping (Loading existing config)
```typescript
// Internal config → User selection
customerType: 'individual' → 'retail'
customerType: 'business' → 'wholesale'
customerType: 'both' → 'both'
```

## UX Copy

### Main Section
- **Title:** "Business Type"
- **Description:** "Select the type of customers you serve. This will automatically configure the bot's communication style, payment options, and ordering process."
- **Helper Text:** "You can customize these settings later in each section."

### Option Labels
- **Retail:** "Retail" (subtitle: "Selling to individual customers")
- **Wholesale:** "Wholesale" (subtitle: "Selling to other businesses")
- **Both:** "Both" (subtitle: "Serving both individuals and businesses")

### Auto-Configuration Notice
When user selects a type, show:
- ✅ "Configuration updated"
- "The following settings have been configured automatically:"
  - [List of auto-configured fields]
- "You can customize these in their respective sections below."

## Implementation Notes

### State Management
```typescript
const [businessType, setBusinessType] = useState<BusinessTypeOption>('retail');
const [config, setConfig] = useState<WhatsAppBotUIConfig>(defaultConfig);

const handleBusinessTypeChange = (newType: BusinessTypeOption) => {
  setBusinessType(newType);
  const updatedConfig = applyBusinessTypePreset(newType, config);
  setConfig(updatedConfig);
  // Show notification: "Settings updated"
};
```

### Validation
- Business type selection is required
- Must be one of: 'retail', 'wholesale', 'both'
- No validation errors possible (enum selection)

### Persistence
- Save business type selection immediately
- Auto-configured fields are saved as part of full config
- User can change business type later (re-applies preset)

### Customization Flow
1. User selects business type → Auto-config applied
2. User sees all sections with auto-configured values
3. User can modify any field in any section
4. Modified fields override preset values
5. System tracks which fields are customized vs using presets

## Edge Cases

### Changing Business Type
- **Question:** What happens if user changes business type after customizing?
- **Answer:** Preset is applied, but user's custom values in other sections are preserved (deep merge)

### Mixed Configuration
- **Question:** User selects "Retail" but enables credit terms manually?
- **Answer:** User's manual setting takes priority. System doesn't force preset values after initial selection.

### Loading Existing Config
- **Question:** How to determine current business type from saved config?
- **Answer:** Use `getBusinessTypeFromConfig()` which reads `customerType` field

## Accessibility

- Radio group with proper ARIA labels
- Each option has descriptive text
- Keyboard navigation supported
- Screen reader announces selection and auto-configuration

## Examples

### Example 1: New User Setup
1. User opens settings
2. Sees "Business Type" section at top
3. Selects "Retail"
4. System auto-configures: Friendly tone, no credit terms, flexible ordering
5. User proceeds to customize other sections (optional)

### Example 2: Changing Business Type
1. User has "Retail" configured with custom settings
2. Changes to "Wholesale"
3. System applies wholesale preset
4. Previous customizations in other sections (if any) are preserved
5. User can customize wholesale settings further

### Example 3: Loading Existing Config
1. User opens settings with existing "Both" configuration
2. System loads config and determines business type: "Both"
3. Radio button "Both" is selected
4. All other fields show current (possibly customized) values
5. User can change business type or customize further
