# Communication Style Selection - Documentation

## Overview

The "How should your assistant talk?" section allows users to choose a preset communication style for their WhatsApp bot. This automatically configures tone, response length, and greeting style.

## User Experience

### Selection Options

Users choose from four preset styles:

1. **Friendly & Casual**
   - Warm, conversational, and approachable
   - Best for: Retail, restaurants, customer-facing services

2. **Professional & Formal**
   - Polite, respectful, and business-appropriate
   - Best for: B2B, wholesale, corporate clients

3. **Short & To-the-Point**
   - Brief, clear, and efficient
   - Best for: Busy customers who want quick answers

4. **Detailed & Explanatory**
   - Comprehensive, informative, and thorough
   - Best for: Complex products, technical services

## Configuration Mapping

Each style automatically configures:

### Friendly & Casual
```typescript
{
  tone: 'friendly_casual',
  responseLength: 'brief',
  useCustomerName: true,
  enableTimeBasedGreetings: true
}
```

**Effects:**
- Uses casual language and friendly tone
- Brief responses (2-3 sentences)
- Uses customer names
- Time-based greetings ("Good morning!")

### Professional & Formal
```typescript
{
  tone: 'professional_formal',
  responseLength: 'moderate',
  useCustomerName: true,
  enableTimeBasedGreetings: true
}
```

**Effects:**
- Uses formal, respectful language
- Moderate responses (3-4 sentences)
- Uses customer names with proper titles
- Time-based greetings ("Good day")

### Short & To-the-Point
```typescript
{
  tone: 'efficient_direct',
  responseLength: 'brief',
  useCustomerName: false,
  enableTimeBasedGreetings: false
}
```

**Effects:**
- Gets straight to the point
- Very brief responses (1-2 sentences)
- Omits customer names for brevity
- Simple greetings ("Hi!" not "Good morning!")

### Detailed & Explanatory
```typescript
{
  tone: 'helpful_expert',
  responseLength: 'detailed',
  useCustomerName: true,
  enableTimeBasedGreetings: true
}
```

**Effects:**
- Provides comprehensive information
- Detailed responses (4+ sentences)
- Uses customer names
- Time-based greetings with context

## UI Schema

### Field Definition
```typescript
{
  key: 'communicationStyle',
  type: 'radio-group',
  label: 'How should your assistant talk?',
  description: 'Choose the communication style...',
  required: true,
  options: [
    {
      value: 'friendly_casual',
      label: 'Friendly & Casual',
      shortDescription: 'Warm, conversational, and approachable',
      tooltip: 'Perfect for retail businesses...',
      examples: {
        greeting: 'Hi! 👋 Welcome!...',
        productInquiry: 'Great choice!...',
        orderConfirmation: 'Perfect!...'
      }
    },
    // ... other options
  ]
}
```

### Tooltips

Each option includes a tooltip explaining:
- When to use this style
- What industries it's best for
- Key characteristics

### Examples

Each option shows three examples:
1. **Greeting** - How the bot greets customers
2. **Product Inquiry** - How the bot responds to product questions
3. **Order Confirmation** - How the bot confirms orders

## Guardrails & Safety

### Validation Rules

1. **Tone-Response Length Consistency**
   - Ensures tone and response length combinations are valid
   - Prevents mismatched configurations

2. **Business Type Compatibility**
   - Warns if style doesn't match business type
   - Professional & Formal + Individual customers = Warning
   - Short & Direct + Business customers = Warning

3. **Greeting Style Consistency**
   - Short & Direct should not use time-based greetings
   - Warns if inconsistent

4. **Name Usage Consistency**
   - Short & Direct should not use customer names
   - Warns if inconsistent

### Error Handling

- **Errors:** Invalid combinations are corrected automatically
- **Warnings:** Suggest improvements but don't block
- **Auto-Correction:** Conflicting values are overridden with preset defaults

## Mapping Logic

### User Selection → Internal Config

```typescript
'friendly_casual' → {
  tone: 'friendly_casual',
  responseLength: 'brief',
  useCustomerName: true,
  enableTimeBasedGreetings: true
}
```

### Internal Config → User Selection

```typescript
// Reverse mapping
{ tone: 'friendly_casual', responseLength: 'brief' } → 'friendly_casual'
{ tone: 'efficient_direct', responseLength: 'brief' } → 'short_direct'
{ tone: 'professional_formal', responseLength: 'moderate' } → 'professional_formal'
{ tone: 'helpful_expert', responseLength: 'detailed' } → 'detailed_explanatory'
```

## Usage Example

```typescript
import { 
  CommunicationStyleField,
  applyCommunicationStylePreset,
  validateCommunicationStyleConfig,
  applyCommunicationStyleGuardrails
} from '@/types/communication-style-presets';

// 1. User selects communication style
const selectedStyle = 'friendly_casual';

// 2. Validate before applying
const validation = validateCommunicationStyleConfig(selectedStyle, existingConfig);
if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
}

// 3. Apply guardrails (auto-corrects if needed)
const safeConfig = applyCommunicationStyleGuardrails(selectedStyle, existingConfig);

// 4. Save configuration
await saveConfig(safeConfig);
```

## Examples for Each Style

### Friendly & Casual

**Greeting:**
> Hi! 👋 Welcome! How can I help you today?

**Product Inquiry:**
> Great choice! That's one of our bestsellers. It's ₹500 and we have it in stock. Want me to add it to your order?

**Order Confirmation:**
> Perfect! Your order for ₹1,200 is confirmed. We'll prepare it right away! 😊

### Professional & Formal

**Greeting:**
> Good day. Thank you for contacting us. How may I assist you?

**Product Inquiry:**
> Thank you for your inquiry. The product is priced at ₹500 per unit. We currently have stock available. Would you like to proceed with an order?

**Order Confirmation:**
> Your order has been confirmed. Order total: ₹1,200. We will process this order and send you the invoice shortly.

### Short & To-the-Point

**Greeting:**
> Hi! How can I help?

**Product Inquiry:**
> ₹500. In stock. Add to order?

**Order Confirmation:**
> Order confirmed. ₹1,200. Processing now.

### Detailed & Explanatory

**Greeting:**
> Hello! Thank you for reaching out. I'm here to help you with any questions about our products and services. What would you like to know?

**Product Inquiry:**
> That product is ₹500 per unit. It includes [features], suitable for [use cases], and comes with [warranty/guarantee]. We have [X] units in stock. Would you like me to explain any specific features or place an order?

**Order Confirmation:**
> Your order has been successfully confirmed. Total amount: ₹1,200. This includes [items]. Expected delivery: [timeframe]. We will send you the order confirmation and invoice via email. Thank you for your business!

## Integration with Other Settings

The communication style integrates with:

1. **Business Type**
   - Retail businesses typically use Friendly & Casual
   - Wholesale businesses typically use Professional & Formal
   - System warns if there's a mismatch

2. **Customer Experience Settings**
   - Automatically configures greeting style
   - Automatically configures name usage
   - Can be overridden in Customer Experience section

3. **Ordering Process**
   - Tone affects how orders are confirmed
   - Response length affects order summaries

## Best Practices

1. **Match Business Type:** Choose a style that matches your customer base
2. **Consistency:** Don't mix styles - choose one and stick with it
3. **Test Examples:** Review the examples before selecting
4. **Consider Context:** Think about when customers contact you (busy times = short & direct)

## Future Enhancements

Potential additions:
- Preview mode (see actual responses)
- A/B testing different styles
- Custom style creation (advanced users)
- Style templates for specific industries
