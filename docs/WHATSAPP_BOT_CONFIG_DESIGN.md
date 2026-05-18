# WhatsApp Bot Configuration Schema - Design Decisions

## Executive Summary

This document explains the design decisions behind the WhatsApp Bot configuration schema, specifically which fields are hidden from users and why.

## Design Principles

1. **User-Friendly First:** All user-facing fields use human-readable language
2. **Validation-First:** Schema prevents invalid AI behavior through validation
3. **Separation of Concerns:** UI config (what users see) vs Internal config (what system uses)
4. **Backward Compatible:** Existing configurations continue to work
5. **No Prompt Editing:** Users cannot directly modify AI prompts (safety)

## Hidden Fields Explained

### 1. System-Level Constants

**Fields Hidden:**
- `productContext.searchLimit` (default: 5)
- `productContext.topProductsLimit` (default: 10)

**Why Hidden:**
- These are performance/optimization settings
- Changing these could affect API costs and response times
- Not business logic - they're infrastructure concerns
- Users don't need control over token usage optimization

**User Impact:**
- None - these are automatically optimized
- Users get best performance without configuration complexity

---

### 2. Internal Field Name Mappings

**Fields Hidden:**
- Internal database field names (`sellingPrice`, `currentStock`, etc.)
- Day numbers (0-6) vs day names (monday-sunday)

**Why Hidden:**
- Technical implementation details
- Users think in business terms (price, stock), not database terms
- Mapping is automatic and transparent

**Example:**
```typescript
// User sees:
showFields: ['price', 'stock', 'description']

// System uses:
fieldsToInclude: ['sellingPrice', 'currentStock', 'description']
```

---

### 3. Derived/Automatic Fields

**Fields Hidden:**
- `businessModel.isB2B` (derived from `customerType`)
- `businessModel.isB2C` (derived from `customerType`)
- `businessModel.accountBasedOrdering` (derived from `requiresCreditTerms` + `customerType`)

**Why Hidden:**
- Redundant - already captured in user-friendly fields
- Logic: `accountBasedOrdering = (customerType === 'business' || customerType === 'both') && requiresCreditTerms`
- Prevents configuration conflicts (user can't set contradictory values)

**User Impact:**
- Simpler configuration (one field instead of three)
- No confusion about which field to use

---

### 4. AI System Parameters

**Fields Hidden:**
- `systemPrompt.customInstructions` (direct prompt editing)
- Token limits, temperature, model parameters

**Why Hidden:**
- **Safety:** Direct prompt editing could break AI behavior
- **Complexity:** Users don't need to understand AI internals
- **Alternative:** Users can provide guidance via `advanced.customInstructions` which is sanitized and structured

**User Impact:**
- Users can still provide custom guidance (via `advanced.customInstructions`)
- Prevents accidental prompt injection or broken configurations
- System ensures prompts are well-formed

---

### 5. Conversation Management

**Fields Hidden:**
- Conversation history limits
- Message queue management
- Token budgets per conversation

**Why Hidden:**
- Infrastructure concerns, not business logic
- Automatically optimized for performance
- Users don't need to manage system resources

---

## Mapping Function Responsibilities

The `mapUIConfigToBotConfig` function handles:

1. **Type Conversions:**
   - User-friendly names → Internal field names
   - Day names → Day numbers
   - Business type flags → Boolean values

2. **Derived Values:**
   - Calculate `isB2B` / `isB2C` from `customerType`
   - Calculate `accountBasedOrdering` from business type + credit terms

3. **Default Values:**
   - Apply system defaults for hidden fields
   - Ensure all required internal fields are populated

4. **Validation:**
   - Ensure mappings produce valid configurations
   - Prevent invalid combinations

## Safety Guarantees

1. **No Prompt Injection:**
   - Users cannot directly edit system prompts
   - Custom instructions are sanitized and structured

2. **No Invalid States:**
   - Validation prevents conflicting configurations
   - Derived fields prevent logical contradictions

3. **Type Safety:**
   - TypeScript ensures type correctness
   - Mapping function handles type conversions safely

4. **Backward Compatibility:**
   - Missing fields use sensible defaults
   - Existing configurations continue to work

## Example: Restaurant Configuration

### What User Configures:
```typescript
{
  communicationStyle: { tone: 'friendly_casual', responseLength: 'brief' },
  businessType: { customerType: 'individual' },
  productInfo: { showFields: ['price', 'description', 'ingredients'] },
  orderingProcess: { collectCustomerInfo: { address: true } },
  businessHours: { schedule: [{ day: 'monday', openTime: '11:00', closeTime: '23:00' }] }
}
```

### What System Uses (Hidden from User):
```typescript
{
  systemPrompt: { 
    tone: 'friendly_casual', 
    responseLength: 'brief',
    // customInstructions: sanitized from advanced.customInstructions
  },
  businessModel: { 
    isB2B: false,        // Derived from customerType: 'individual'
    isB2C: true,         // Derived from customerType: 'individual'
    accountBasedOrdering: false  // Derived: isB2B && requiresCreditTerms
  },
  productContext: {
    fieldsToInclude: ['sellingPrice', 'description', 'ingredients'],  // Mapped
    searchLimit: 5,      // System default
    topProductsLimit: 10 // System default
  },
  timeAwareness: {
    businessHours: [{ day: 1, openTime: '11:00', closeTime: '23:00' }]  // 'monday' → 1
  }
}
```

## User Benefits

1. **Simplicity:** Fewer fields to configure
2. **Safety:** Cannot break system with invalid configurations
3. **Clarity:** Business-focused language, not technical jargon
4. **Flexibility:** Still customizable where it matters
5. **Performance:** System-optimized defaults

## Developer Benefits

1. **Type Safety:** TypeScript ensures correctness
2. **Validation:** Schema validates user input
3. **Maintainability:** Clear separation of concerns
4. **Extensibility:** Easy to add new fields without breaking existing configs
5. **Testing:** Mapping function is testable in isolation

## Future Considerations

If users need more control in the future, we can:

1. **Expose Advanced Options:** Add "Advanced" toggle to show technical fields
2. **Templates:** Provide industry-specific templates with pre-configured values
3. **Validation Warnings:** Warn users about performance implications
4. **Presets:** Quick setup with "Recommended" configurations

But for now, the current design prioritizes simplicity and safety.
