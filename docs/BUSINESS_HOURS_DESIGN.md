# Business Hours & Availability Section - Design Documentation

## Overview

The Business Hours & Availability section allows businesses to configure their operating hours, timezone, and after-hours automatic responses.

## UI Layout Structure

### Section Layout

```
┌─────────────────────────────────────────────────────────┐
│ Business Hours & Availability                           │
│                                                          │
│ Set your business hours and configure automatic          │
│ after-hours responses.                                  │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ Timezone: [Dropdown ▼]                                 │
│   Indian Standard Time (IST)                            │
│                                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Weekly Schedule                                      │ │
│ │                                                       │ │
│ │ Day      Open    Closing Time                        │ │
│ │ ─────────────────────────────────────────────────── │ │
│ │ ☑ Monday    [09:00]  to  [18:00]                    │ │
│ │ ☑ Tuesday   [09:00]  to  [18:00]                    │ │
│ │ ☑ Wednesday [09:00]  to  [18:00]                    │ │
│ │ ☑ Thursday  [09:00]  to  [18:00]                    │ │
│ │ ☑ Friday    [09:00]  to  [18:00]                    │ │
│ │ ☐ Saturday  [--:--]  to  [--:--]  (Closed)          │ │
│ │ ☐ Sunday    [--:--]  to  [--:--]  (Closed)          │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ ☑ Enable After-Hours Auto-Reply                         │
│   Automatically send a message when customers contact    │
│   you outside business hours                            │
│                                                          │
│ After-Hours Message: [Textarea]                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ We're currently closed. Our business hours are       │ │
│ │ Monday-Friday, 9 AM - 6 PM. We'll respond to your   │ │
│ │ message during business hours. Thank you!            │ │
│ └─────────────────────────────────────────────────────┘ │
│ [Example Messages ▼]                                    │
│ Characters: 120 / 300                                    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Field Definitions

### 1. Timezone Selector

**Type:** Dropdown/Select
**Required:** Yes
**Default:** Asia/Kolkata (IST)

**Options:**
- Indian Standard Time (IST) - +05:30
- Gulf Standard Time (GST) - +04:00
- Singapore Time (SGT) - +08:00
- Eastern Time (ET) - -05:00
- Pacific Time (PT) - -08:00
- Greenwich Mean Time (GMT) - +00:00
- (Additional timezones as needed)

### 2. Weekly Schedule Table

**Type:** Table/Grid with toggles and time inputs
**Required:** Yes (at least one day must be configured)

**Structure:**
- 7 rows (one per day)
- Each row has:
  - Checkbox/Toggle: Is business open this day?
  - Open Time input: HH:mm format (24-hour)
  - Close Time input: HH:mm format (24-hour)
  - Disabled state when closed

**Validation:**
- Opening time must be before closing time
- Times must be in HH:mm format
- Both times required when day is open

### 3. After-Hours Auto-Reply Toggle

**Type:** Toggle/Switch
**Required:** No
**Default:** Enabled (true)

**Behavior:**
- When enabled: After-hours message field becomes required
- When disabled: After-hours message field is hidden/disabled

### 4. After-Hours Message

**Type:** Textarea
**Required:** Yes (when after-hours auto-reply is enabled)
**Default:** Safe default message provided
**Max Length:** 300 characters
**Min Length:** 20 characters (warning only)

**Validation:**
- Cannot exceed 300 characters
- Cannot contain forbidden phrases (promises/delivery commitments)
- Should not be empty if auto-reply is enabled

## Validation Rules

### Required Fields

1. **Timezone:** Must be selected
2. **Schedule:** All 7 days must be configured (can be closed)
3. **After-Hours Message:** Required if after-hours auto-reply is enabled

### Field Validation

#### Timezone
- Must be a valid IANA timezone identifier
- Must be from the provided options list

#### Schedule
- All 7 days must be present
- If `isOpen = true`:
  - `openTime` is required
  - `closeTime` is required
  - Times must be in HH:mm format (24-hour)
  - Closing time must be after opening time

#### After-Hours Message
- **Length:** 20-300 characters
  - Error if > 300 characters
  - Warning if < 20 characters
- **Content:**
  - Cannot contain forbidden phrases (promises/delivery)
  - Error if forbidden phrases found
- **Required:** Yes if after-hours auto-reply is enabled

### Forbidden Phrases

The following phrases are not allowed in after-hours messages (they imply promises or delivery commitments):

- "will deliver"
- "guaranteed delivery"
- "promise to"
- "assured"
- "guarantee"
- "will arrive"
- "definitely"
- "certainly will"
- "will be ready"
- "will ship"
- "will process"

**Rationale:** Prevents businesses from making commitments they may not be able to keep, protects customer expectations.

## Safe Default Messages

### Generic Business
```
We're currently closed. Our business hours are Monday-Friday, 9 AM - 6 PM. 
We'll respond to your message during business hours. Thank you!
```

### Restaurant/Food Delivery
```
We're currently closed. Our next delivery slot is tomorrow at 11:00 AM. 
You can place your order now and we'll prepare it when we open. Thank you!
```

### Retail Store
```
We're currently closed. Our store hours are Monday-Saturday, 10 AM - 9 PM. 
We'll respond to your inquiry when we open. Thank you!
```

### Wholesale/B2B
```
Our business hours are Monday-Friday, 9 AM - 6 PM. 
We'll respond to your inquiry during business hours. Thank you for your patience.
```

### Service Business
```
We're currently closed. Our office hours are Monday-Friday, 9 AM - 6 PM. 
We'll get back to you during business hours. Thank you!
```

## Example After-Hours Responses

### ✅ Safe Examples (Allowed)

1. **Informative:**
   ```
   We're currently closed. Our business hours are Monday-Friday, 9 AM - 6 PM. 
   We'll respond to your message during business hours. Thank you!
   ```

2. **Helpful:**
   ```
   Thank you for contacting us. We're currently closed and will respond 
   to your message during our business hours. Have a great day!
   ```

3. **Next Steps:**
   ```
   We're currently closed. Our next delivery slot is tomorrow at 11:00 AM. 
   You can place your order now and we'll prepare it when we open. Thank you!
   ```

### ❌ Unsafe Examples (Not Allowed)

1. **Promise of Delivery:**
   ```
   We're currently closed. Your order will be delivered tomorrow by 2 PM.
   ```
   ❌ Contains "will be delivered"

2. **Guarantee:**
   ```
   We guarantee we'll process your order first thing in the morning.
   ```
   ❌ Contains "guarantee" and "will process"

3. **Definite Commitment:**
   ```
   We're closed now, but we'll definitely have your order ready by 10 AM.
   ```
   ❌ Contains "definitely" and "will"

## Internal Config Mapping

### Business Hours Config → Internal Config

```typescript
// User Config
{
  timezone: 'Asia/Kolkata',
  schedule: [
    { day: 'monday', isOpen: true, openTime: '09:00', closeTime: '18:00' },
    { day: 'sunday', isOpen: false }
  ],
  afterHoursEnabled: true,
  afterHoursMessage: 'We\'re currently closed...'
}

// Internal Config
{
  businessHours: {
    timezone: 'Asia/Kolkata',
    schedule: [
      { day: 1, isOpen: true, openTime: '09:00', closeTime: '18:00' }, // Monday = 1
      { day: 0, isOpen: false } // Sunday = 0
    ],
    afterHoursMessage: 'We\'re currently closed...'
  }
}
```

### Day Name → Day Number Mapping

- Sunday: 0
- Monday: 1
- Tuesday: 2
- Wednesday: 3
- Thursday: 4
- Friday: 5
- Saturday: 6

## Runtime Behavior

### Determining Business Hours Status

```typescript
function isBusinessOpen(currentTime: Date, config: BusinessHoursConfig): boolean {
  // Convert current time to business timezone
  const businessTime = convertToTimezone(currentTime, config.timezone);
  
  // Get day of week (0 = Sunday, 1 = Monday, etc.)
  const dayOfWeek = businessTime.getDay();
  
  // Find schedule for this day
  const daySchedule = config.schedule.find(s => dayMap[s.day] === dayOfWeek);
  
  if (!daySchedule || !daySchedule.isOpen) {
    return false;
  }
  
  // Get current time in HH:mm format
  const currentTimeStr = formatTime(businessTime);
  
  // Check if current time is between open and close
  return currentTimeStr >= daySchedule.openTime && 
         currentTimeStr <= daySchedule.closeTime;
}
```

### After-Hours Auto-Reply

```typescript
function handleAfterHoursMessage(config: BusinessHoursConfig): string | null {
  if (!config.afterHoursEnabled) {
    return null; // Don't send auto-reply
  }
  
  if (isBusinessOpen(new Date(), config)) {
    return null; // Business is open, don't send
  }
  
  // Return after-hours message
  return config.afterHoursMessage || DefaultBusinessHoursConfig.afterHoursMessage;
}
```

## UI Implementation Notes

### Schedule Table UI

**Recommended Layout:**
- Use a table/grid layout
- Each row represents one day
- Toggle/checkbox for "Open/Closed"
- Time inputs (HH:mm) disabled when closed
- Visual feedback when times are invalid
- Show "Closed" label when day is not open

**Time Input:**
- Use time picker or formatted text input
- Format: HH:mm (24-hour)
- Validation: Real-time validation of format and logic
- Placeholder: "--:--" when closed

### After-Hours Message Editor

**Features:**
- Character counter (X / 300)
- Real-time validation
- Forbidden phrase detection
- Example messages dropdown
- Helper text explaining restrictions

**Validation Feedback:**
- Error: Red border + error message (forbidden phrases, too long)
- Warning: Yellow border + warning message (too short)
- Success: Green border (valid)

## Integration Points

### With Conversation System
- Checks business hours when message received
- Sends after-hours message if outside hours
- Uses timezone for accurate time calculation

### With Customer Experience
- Time-based greetings use business hours
- Greeting style may vary based on time of day

### With Notification System
- Can trigger notifications when business opens
- Can schedule follow-up messages for business hours

## Usage Example

```typescript
import { 
  BusinessHoursField,
  validateBusinessHoursConfig,
  DefaultBusinessHoursConfig,
  sanitizeAfterHoursMessage
} from '@/types/business-hours-presets';

// 1. Load configuration
const config = DefaultBusinessHoursConfig;

// 2. Validate
const validation = validateBusinessHoursConfig(config);
if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
}

// 3. Sanitize after-hours message
const { sanitized, warnings } = sanitizeAfterHoursMessage(config.afterHoursMessage || '');
if (warnings.length > 0) {
  console.warn('Sanitization warnings:', warnings);
}

// 4. Save configuration
await saveBusinessHoursConfig({ ...config, afterHoursMessage: sanitized });
```

## Accessibility

- Timezone dropdown has clear labels
- Schedule table is keyboard navigable
- Time inputs have proper labels and formatting hints
- After-hours message textarea has character count announcement
- Error messages are clearly associated with fields
- All fields have descriptive help text
