# Customer Handling Section - Design Documentation

## Overview

The Customer Handling section allows businesses to configure how the WhatsApp bot interacts with different customer groups. Each group (First-time, Regular, VIP) can have customized greeting styles, offer visibility, and priority handling.

## UI Layout Structure

### Section Layout

```
┌─────────────────────────────────────────────────────────┐
│ Customer Handling                                        │
│                                                          │
│ Configure how the bot handles different customer groups.│
│ Set greeting styles, offer visibility, and priority     │
│ handling for each group.                                │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ First-time Customers                                 │ │
│ │ Customers who haven't placed an order yet            │ │
│ │                                                       │ │
│ │ Greeting Style: [Dropdown ▼]                        │ │
│ │   • Standard Greeting                                │ │
│ │   • Warm Welcome                                     │ │
│ │   • Personalized                                     │ │
│ │   • Quick Greeting                                   │ │
│ │                                                       │ │
│ │ Show Offers: [Dropdown ▼]                           │ │
│ │   • Show All Offers                                 │ │
│ │   • Show Promotions Only                            │ │
│ │   • Don't Show Offers                               │ │
│ │                                                       │ │
│ │ ⚪ Priority Handling                                │ │
│ │   Give first-time customers priority in responses    │ │
│ │   (not recommended)                                  │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Regular Customers                                    │ │
│ │ Customers with previous orders                       │ │
│ │                                                       │ │
│ │ [Same fields as above]                               │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Important Customers (VIP)                           │ │
│ │ VIP customers (marked with VIP tag)                  │ │
│ │                                                       │ │
│ │ [Same fields as above]                               │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Field Structure

Each customer group has 3 fields:

1. **Greeting Style** (Select/Dropdown)
   - Options: Standard, Warm Welcome, Personalized, Quick
   - Shows example when hovered/selected

2. **Show Offers** (Select/Dropdown)
   - Options: Show All Offers, Show Promotions Only, Don't Show Offers
   - Controls when promotions are mentioned

3. **Priority Handling** (Toggle/Switch)
   - Enabled/Disabled
   - Controls response priority (system-level, not pricing)

## Configuration Options

### Greeting Styles

| Style | Description | Example |
|-------|-------------|---------|
| **Standard** | Use default communication style greeting | "Hi! How can I help you?" |
| **Warm Welcome** | Extra friendly greeting | "Hello! Welcome! We're so happy to have you here. How can I assist you today?" |
| **Personalized** | Use customer name and reference history | "Hi John! Welcome back. How can I help you today?" |
| **Quick** | Brief, efficient greeting | "Hi! How can I help?" |

### Offer Visibility

| Option | Description | Behavior |
|--------|-------------|----------|
| **Show All Offers** | Show all available promotions and discounts | Bot mentions all active offers automatically |
| **Show Promotions Only** | Show only active promotions | Bot mentions promotions but not regular discounts |
| **Don't Show Offers** | Don't automatically show offers | Bot doesn't mention offers unless asked |

### Priority Handling

- **Enabled:** Customer gets priority in response queue
- **Disabled:** Normal response queue position
- **Note:** This is system-level priority, not pricing/discount logic

## Default Configurations

### First-time Customers
```typescript
{
  greetingStyle: 'warm_welcome',
  offerVisibility: 'always',
  priorityHandling: false
}
```

**Rationale:**
- Warm welcome makes good first impression
- Show all offers to attract new customers
- No priority (they haven't proven value yet)

### Regular Customers
```typescript
{
  greetingStyle: 'personalized',
  offerVisibility: 'only_promotions',
  priorityHandling: false
}
```

**Rationale:**
- Personalized greeting builds loyalty
- Show promotions but not all discounts (they already know about regular pricing)
- No priority (normal handling is sufficient)

### VIP Customers
```typescript
{
  greetingStyle: 'warm_welcome',
  offerVisibility: 'always',
  priorityHandling: true
}
```

**Rationale:**
- Warm welcome shows appreciation
- Show all offers (they're valuable customers)
- Priority handling ensures quick responses

## Validation Rules

### Required Fields
- All three groups must have configuration
- All fields (greetingStyle, offerVisibility, priorityHandling) are required per group

### Field Validation

1. **Greeting Style**
   - Must be one of: standard, warm_welcome, personalized, quick
   - Error if invalid value

2. **Offer Visibility**
   - Must be one of: always, only_promotions, never
   - Error if invalid value

3. **Priority Handling**
   - Must be boolean (true/false)
   - Error if not boolean

### Warnings (Non-blocking)

1. **First-time + Priority Handling**
   - Warning: "First-time customers typically don't need priority handling"
   - Still allows the configuration

2. **VIP + No Priority Handling**
   - Warning: "VIP customers usually benefit from priority handling"
   - Suggests enabling priority

## Internal Config Mapping

### Customer Group Identification

The system identifies customer groups based on:

1. **First-time:** No previous orders
2. **Regular:** Has previous orders, no VIP tag
3. **VIP:** Has VIP tag in customer record

### Runtime Behavior

```typescript
// Pseudo-code for runtime behavior
function getCustomerGroup(customer): CustomerGroup {
  if (customer.hasVIPTag) return 'vip';
  if (customer.hasOrders) return 'regular';
  return 'first_time';
}

function getGreeting(customer, config): string {
  const group = getCustomerGroup(customer);
  const greetingStyle = config.customerHandling[group].greetingStyle;
  
  switch (greetingStyle) {
    case 'warm_welcome':
      return generateWarmWelcome(customer);
    case 'personalized':
      return generatePersonalizedGreeting(customer);
    case 'quick':
      return generateQuickGreeting();
    default:
      return generateStandardGreeting();
  }
}

function shouldShowOffers(customer, config): boolean {
  const group = getCustomerGroup(customer);
  const visibility = config.customerHandling[group].offerVisibility;
  
  switch (visibility) {
    case 'always':
      return true;
    case 'only_promotions':
      return hasActivePromotions();
    case 'never':
      return false;
  }
}

function getResponsePriority(customer, config): number {
  const group = getCustomerGroup(customer);
  const priorityHandling = config.customerHandling[group].priorityHandling;
  
  return priorityHandling ? 1 : 0; // 1 = high priority, 0 = normal
}
```

## Food Business Example

### Restaurant Configuration

```typescript
{
  first_time: {
    greetingStyle: 'warm_welcome',
    offerVisibility: 'always',
    priorityHandling: false
  },
  regular: {
    greetingStyle: 'personalized',
    offerVisibility: 'only_promotions',
    priorityHandling: false
  },
  vip: {
    greetingStyle: 'warm_welcome',
    offerVisibility: 'always',
    priorityHandling: true
  }
}
```

### Behavior Examples

#### First-time Customer
- **Greeting:** "Hello! Welcome to Rayal Foods! We're so happy to have you here. How can I assist you today?"
- **Offers:** Bot mentions: "We have a special offer: 20% off on your first order!"
- **Priority:** Normal response time

#### Regular Customer (John, has ordered before)
- **Greeting:** "Hi John! Welcome back. How can I help you today?"
- **Offers:** Bot mentions promotions: "We have a weekend special: Buy 2 Get 1 free on biryani!"
- **Priority:** Normal response time

#### VIP Customer
- **Greeting:** "Hello! Welcome back! We're delighted to serve you again. How may I assist you today?"
- **Offers:** Bot mentions all offers: "As a valued customer, you have access to: 20% off, weekend special, and free delivery!"
- **Priority:** High priority - responds faster than other customers

## Design Principles

### ✅ What's Included

1. **Toggle-based Configuration**
   - All settings are toggles or dropdowns
   - No free text input
   - No complex logic exposed to users

2. **Customer Groups**
   - Clear, user-friendly labels
   - Automatically detected by system
   - No manual customer tagging in this section

3. **Greeting Styles**
   - Preset options only
   - Examples shown for clarity
   - No custom greeting text editing

4. **Offer Visibility**
   - Simple dropdown selection
   - Clear descriptions
   - Controls when offers are shown

5. **Priority Handling**
   - Simple toggle
   - System-level priority only
   - No pricing implications

### ❌ What's NOT Included

1. **No Pricing Logic**
   - No discounts or pricing rules
   - No special pricing for VIP
   - Pricing handled separately

2. **No AI Decision-making**
   - No "let AI decide" options
   - All settings are explicit
   - User controls all behavior

3. **No Complex Rules**
   - No conditional logic
   - No "if-then" rules
   - Simple per-group configuration

4. **No Customer Tagging**
   - VIP detection is automatic (based on customer tags)
   - First-time/Regular detection is automatic (based on order history)
   - User doesn't manually assign groups

## Integration Points

### With Customer System
- Reads customer tags for VIP identification
- Reads order history for first-time vs regular
- No writes to customer records from this section

### With Conversation System
- Uses greeting style when starting conversations
- Uses offer visibility when responding to inquiries
- Uses priority handling in message queue

### With Promotion System
- Reads active promotions for "only_promotions" visibility
- No direct integration with discount/pricing logic

## Usage Example

```typescript
import { 
  CustomerHandlingField,
  validateCustomerHandlingConfig,
  DefaultCustomerHandlingConfig,
  FoodBusinessCustomerHandlingExample
} from '@/types/customer-handling-presets';

// 1. Load configuration
const config = FoodBusinessCustomerHandlingExample;

// 2. Validate
const validation = validateCustomerHandlingConfig(config);
if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
}

// 3. Save configuration
await saveCustomerHandlingConfig(config);

// 4. Runtime usage
const customerGroup = determineCustomerGroup(customer);
const greetingStyle = config[customerGroup].greetingStyle;
const offerVisibility = config[customerGroup].offerVisibility;
const priorityHandling = config[customerGroup].priorityHandling;
```

## Accessibility

- Each group section is clearly labeled
- Fields have descriptive labels and help text
- Dropdowns have clear option labels
- Toggles have clear on/off states
- Keyboard navigation supported
- Screen reader friendly
