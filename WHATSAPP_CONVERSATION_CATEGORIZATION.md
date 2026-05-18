# WhatsApp Conversation Categorization Guide

## Overview

The WhatsApp CRM system uses **two separate categorization systems** to track conversations:

1. **Conversation Status** (`conversation_status`) - Workflow status
2. **Lead Status** (`lead_status`) - Lead tracking status

---

## 1. Conversation Status (`conversation_status`)

**Purpose**: Track the workflow state of a conversation

**Values**:
- `open` - Conversation is active and open (default for new conversations)
- `pending` - Conversation is waiting for follow-up or response
- `closed` - Conversation is resolved/completed

**How it's set**:
- **Default**: New conversations are automatically set to `open`
- **Manual**: Can be changed via the Contact Panel or three-dot menu in chat header
- **API**: `PATCH /api/whatsapp/conversations/[id]` with `conversation_status` field

**Summary Bar Counts**:
- **Open**: `conversation_status = 'open' AND status = 'active'`
- **Pending**: `conversation_status = 'pending' AND status = 'active'`
- **Closed**: `conversation_status = 'closed' AND status = 'active'`

---

## 2. Lead Status (`lead_status`)

**Purpose**: Track where a lead is in the sales/engagement funnel

**Values**:
- `new` - New lead (default)
- `interested` - Lead has shown interest
- `follow_up` - Needs follow-up
- `converted` - Lead converted to customer
- `lost` - Lead is no longer interested

**How it's set**:
- **Default**: New conversations are automatically set to `new`
- **Manual**: Can be changed via the Contact Panel
- **API**: `PATCH /api/whatsapp/conversations/[id]` with `lead_status` field

**Summary Bar**:
- "New Lead" filter shows conversations where `lead_status = 'new'`

---

## 3. Special Categories (Auto-calculated)

### "Unread" 
**Definition**: Conversations with unread messages
- **Query**: `unread_count > 0 AND status = 'active'`
- **Auto-updated**: When new messages arrive, `unread_count` increments
- **Auto-cleared**: When conversation is opened/selected, `unread_count` resets to 0

### "New"
**Definition**: Conversations where customer sent first message but you haven't replied yet
- **Query**: 
  ```sql
  last_message_direction = 'incoming' 
  AND status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM whatsapp_conversation_messages m 
    WHERE m.conversation_id = c.id AND m.direction = 'outgoing'
  )
  ```
- **Auto-calculated**: Based on message history
- **Changes**: Once you send a reply, it's no longer "New"

---

## Database Schema

### `whatsapp_conversations` table fields:

```sql
-- Workflow status (manual)
conversation_status VARCHAR(20) DEFAULT 'open'
  CHECK (conversation_status IN ('open', 'pending', 'closed'))

-- Lead tracking (manual)
lead_status VARCHAR(20) DEFAULT 'new'
  CHECK (lead_status IN ('new', 'interested', 'follow_up', 'converted', 'lost'))

-- Auto-calculated
unread_count INTEGER DEFAULT 0
last_message_direction VARCHAR(20) -- 'incoming' or 'outgoing'

-- Technical status (system)
status VARCHAR(20) DEFAULT 'active' -- 'active', 'archived', 'blocked'
```

---

## How to Change Categories

### Via UI:
1. **Conversation Status**: 
   - Open chat → Click three dots (⋮) → "Conversation Status" → Select: Open/Pending/Closed
   - Or use Contact Panel → Conversation Status dropdown

2. **Lead Status**:
   - Open Contact Panel → Lead Management → Lead Status dropdown

### Via API:
```typescript
// Change conversation status
PATCH /api/whatsapp/conversations/[id]?business_id=...
{
  "conversation_status": "pending" // or "open" or "closed"
}

// Change lead status
PATCH /api/whatsapp/conversations/[id]?business_id=...
{
  "lead_status": "interested" // or "new", "follow_up", "converted", "lost"
}
```

---

## Summary Bar Logic

The Summary Bar shows counts for:

1. **Unread**: Auto-calculated from `unread_count`
2. **New**: Auto-calculated from message history (no outgoing messages)
3. **Open**: Manual `conversation_status = 'open'`
4. **Pending**: Manual `conversation_status = 'pending'`
5. **Closed**: Manual `conversation_status = 'closed'`

**Note**: "New Lead" is a separate filter based on `lead_status = 'new'` (shown in Summary Bar customization).

---

## Example Scenarios

### Scenario 1: New Customer Message
- Customer sends first message
- **Result**: 
  - `unread_count` = 1
  - `conversation_status` = 'open' (default)
  - `lead_status` = 'new' (default)
  - Shows in: **Unread** + **New** + **Open**

### Scenario 2: You Reply
- You send a reply
- **Result**:
  - `unread_count` = 0 (if conversation is open)
  - `conversation_status` = 'open'
  - `lead_status` = 'new'
  - Shows in: **Open** only (no longer "New" or "Unread")

### Scenario 3: Mark as Pending
- You manually set status to "Pending"
- **Result**:
  - `conversation_status` = 'pending'
  - Shows in: **Pending**

### Scenario 4: Lead Shows Interest
- You manually set lead status to "Interested"
- **Result**:
  - `lead_status` = 'interested'
  - Shows in: Summary Bar (if "Interested" is added to visible items)

---

## Key Points

✅ **Conversation Status** and **Lead Status** are **independent** - you can have:
- `conversation_status = 'open'` + `lead_status = 'converted'`
- `conversation_status = 'closed'` + `lead_status = 'new'`

✅ **"New"** is **auto-calculated** - you can't manually set it, it's based on message history

✅ **"Unread"** is **auto-calculated** - increments on new messages, clears when conversation is opened

✅ **"Open/Pending/Closed"** are **manual** - you set them via UI or API

✅ **"New Lead"** is based on `lead_status = 'new'` (separate from "New" conversations)

