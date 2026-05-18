# Business Hours & Availability Section - Implementation Summary

## ✅ Deliverables Complete

### 1. UI Schema
**File:** `types/business-hours-presets.ts` - `BusinessHoursField`

- Complete field definition for business hours section
- Timezone selector
- Weekly schedule table (7 days)
- After-hours toggle
- After-hours message textarea
- All fields properly typed and validated

### 2. Validation Rules
**File:** `types/business-hours-presets.ts` - `validateBusinessHoursConfig()`

**Required Fields:**
- Timezone (must be valid IANA timezone)
- Schedule (all 7 days must be configured)
- After-hours message (if auto-reply enabled)

**Field Validation:**
- Time format: HH:mm (24-hour)
- Closing time must be after opening time
- Message length: 20-300 characters
- Forbidden phrases detection (no promises/delivery commitments)

**Warnings:**
- No days open (business appears closed all week)
- Message too short (less than 20 characters)

### 3. Example After-Hours Responses
**File:** `types/business-hours-presets.ts` - `ExampleAfterHoursResponses` & `SafeAfterHoursMessages`

Five safe examples provided:
- Generic Business
- Restaurant/Food Delivery
- Retail Store
- Wholesale/B2B
- Service Business

All examples follow safety rules (no promises, no delivery commitments).

### 4. Mapping to Internal Time Config
**File:** `types/business-hours-presets.ts` - `mapBusinessHoursToInternalConfig()`

- Maps day names (monday-sunday) to day numbers (0-6)
- Maps to `WhatsAppBotUIConfig.businessHours` structure
- Includes reverse mapping for loading existing configs

## Configuration Structure

### Business Hours Config

```typescript
{
  timezone: 'Asia/Kolkata',
  schedule: [
    { day: 'monday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
    { day: 'tuesday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
    // ... all 7 days
  ],
  afterHoursEnabled: true,
  afterHoursMessage: 'We\'re currently closed...'
}
```

### Internal Mapping

```typescript
{
  businessHours: {
    timezone: 'Asia/Kolkata',
    schedule: [
      { day: 1, isOpen: true, openTime: '09:00', closeTime: '18:00' }, // Monday
      // ... all 7 days (0-6)
    ],
    afterHoursMessage: 'We\'re currently closed...'
  }
}
```

## Safety Features

### 1. Message Length Limit
- **Maximum:** 300 characters (enforced)
- **Minimum:** 20 characters (warning only)
- Character counter shown in UI

### 2. No Promises/Delivery Commitments
- **Forbidden Phrases:**
  - "will deliver", "guaranteed delivery"
  - "promise to", "assured", "guarantee"
  - "will arrive", "definitely", "certainly will"
  - "will be ready", "will ship", "will process"
- **Validation:** Real-time detection with error messages

### 3. Safe Default Messages
- Provided for 5 business types
- All defaults follow safety rules
- Users can customize while maintaining safety

## Default Configuration

```typescript
{
  timezone: 'Asia/Kolkata',
  schedule: [
    // Monday-Friday: 9 AM - 6 PM
    // Saturday-Sunday: Closed
  ],
  afterHoursEnabled: true,
  afterHoursMessage: 'We\'re currently closed. Our business hours are Monday-Friday, 9 AM - 6 PM. We\'ll respond to your message during business hours. Thank you!'
}
```

## Validation Summary

### Errors (Blocking)
- Missing timezone
- Invalid timezone
- Missing schedule (all 7 days required)
- Missing open/close time when day is open
- Invalid time format
- Closing time before opening time
- Message too long (> 300 chars)
- Forbidden phrases in message
- Message required but missing (when auto-reply enabled)

### Warnings (Non-blocking)
- No days open (business closed all week)
- Message too short (< 20 chars)

## Example After-Hours Messages

### ✅ Safe Examples

1. **Generic:**
   ```
   We're currently closed. Our business hours are Monday-Friday, 9 AM - 6 PM. 
   We'll respond to your message during business hours. Thank you!
   ```

2. **Restaurant:**
   ```
   We're currently closed. Our next delivery slot is tomorrow at 11:00 AM. 
   You can place your order now and we'll prepare it when we open. Thank you!
   ```

3. **Retail:**
   ```
   We're currently closed. Our store hours are Monday-Saturday, 10 AM - 9 PM. 
   We'll respond to your inquiry when we open. Thank you!
   ```

### ❌ Unsafe Examples (Blocked)

1. ❌ "Your order will be delivered tomorrow by 2 PM"
   - Contains "will be delivered"

2. ❌ "We guarantee we'll process your order"
   - Contains "guarantee" and "will process"

## Files Created

1. `types/business-hours-presets.ts` - Core implementation (520+ lines)
2. `docs/BUSINESS_HOURS_DESIGN.md` - Detailed documentation
3. `docs/BUSINESS_HOURS_SUMMARY.md` - This file

## Key Features

✅ **Weekly Schedule UI:** Full 7-day schedule with open/close times
✅ **Timezone Selector:** Multiple timezone options with UTC offsets
✅ **After-Hours Toggle:** Enable/disable auto-reply
✅ **Message Validation:** Length limits and forbidden phrase detection
✅ **Safe Defaults:** Pre-configured safe messages for common business types
✅ **Time Validation:** Ensures closing time is after opening time
✅ **Day Mapping:** Converts day names to numbers for internal use

## Usage Example

```typescript
import { 
  BusinessHoursField,
  validateBusinessHoursConfig,
  sanitizeAfterHoursMessage,
  DefaultBusinessHoursConfig
} from '@/types/business-hours-presets';

// 1. Use default config
const config = DefaultBusinessHoursConfig;

// 2. Validate
const validation = validateBusinessHoursConfig(config);
if (!validation.valid) {
  // Handle errors
}

// 3. Sanitize message
const { sanitized } = sanitizeAfterHoursMessage(config.afterHoursMessage || '');

// 4. Save
await saveConfig({ ...config, afterHoursMessage: sanitized });
```
