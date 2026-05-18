# WhatsApp Interactive Buttons - Working Configuration

## ✅ Status: WORKING (Dec 18, 2025)

All button types now working correctly:
- ✅ Quick Reply buttons appear and work
- ✅ Call buttons have phone numbers attached and work
- ✅ URL buttons open correct URLs
- ✅ Mixed buttons all work together

## Critical Working Configuration

### File: `lib/baileys-hybrid.ts`

**Key Points:**
1. **Use `proto.create()` methods** for all buttons
2. **Call buttons**: Use `phone_number` field (not `id`) with `+` prefix
3. **URL buttons**: Only use `url` field (no `merchant_url`)
4. **Quick reply**: Use `quick_reply` name (not `cta_reply`)
5. **Header**: No header for text-only messages, only for media

**Working Button Format:**

```typescript
// Call Button (WORKING)
proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
  name: 'cta_call',
  buttonParamsJson: JSON.stringify({
    display_text: "Call Us",
    phone_number: "+917769870606"  // Must have + prefix
  })
})

// URL Button (WORKING)
proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
  name: 'cta_url',
  buttonParamsJson: JSON.stringify({
    display_text: "Visit Us",
    url: "https://digitable.in"  // No merchant_url
  })
})

// Quick Reply Button (WORKING)
proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
  name: 'quick_reply',  // Not 'cta_reply'
  buttonParamsJson: JSON.stringify({
    display_text: "Reply",
    id: "quick_reply_id"
  })
})
```

**Working Message Structure:**

```typescript
const interactiveMessage = proto.Message.InteractiveMessage.create({
  body: proto.Message.InteractiveMessage.Body.create({ text: text }),
  footer: footer ? proto.Message.InteractiveMessage.Footer.create({ text: footer }) : undefined,
  header: media ? proto.Message.InteractiveMessage.Header.create({
    hasMediaAttachment: true
  }) : undefined,  // NO header for text-only messages
  nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
    buttons: nativeFlowButtons
  })
});

return {
  viewOnceMessage: {
    message: {
      messageContextInfo: {
        deviceListMetadata: {},
        deviceListMetadataVersion: 2
      },
      interactiveMessage: interactiveMessage
    }
  }
};
```

### File: `lib/whatsapp.ts`

**Key Point:** 
- **No button filtering** - send all button types together
- All buttons are passed to `sendButtonMessage` without prioritization

```typescript
// Send ALL button types together (no filtering)
const finalButtons = validButtons;
```

## What Was Fixed

### Issue 1: Call Button Had No Phone Number
**Problem:** Used `id` field without `+` prefix
**Solution:** Changed to `phone_number` field with `+` prefix

### Issue 2: URL Button Opened Dialer
**Problem:** Extra `merchant_url` field caused confusion
**Solution:** Removed `merchant_url`, only use `url`

### Issue 3: Quick Reply Buttons Didn't Appear
**Problem:** Used `cta_reply` name
**Solution:** Changed to `quick_reply` name

### Issue 4: Buttons Were Being Filtered
**Problem:** `lib/whatsapp.ts` was filtering out quick replies when CTA buttons present
**Solution:** Removed filtering logic, send all buttons together

## Dependencies

```json
{
  "baileys-pro": "latest",
  "@whiskeysockets/baileys": "latest"
}
```

## Testing Checklist

- [x] Quick reply button alone
- [x] Call button alone (with phone number)
- [x] URL button alone (opens URL)
- [x] All three together (all work)
- [x] No 405 errors
- [x] Messages delivered successfully

## Important Notes

1. **DO NOT** use plain objects for buttons - always use `proto.create()`
2. **DO NOT** add `merchant_url` to URL buttons
3. **DO NOT** use `id` for call buttons - use `phone_number`
4. **DO NOT** filter button types - send all together
5. **DO NOT** add header for text-only messages
6. **DO NOT** use `cta_reply` - use `quick_reply`

## Rollback Instructions

If something breaks, revert these files to this state:
- `lib/baileys-hybrid.ts` (lines 95-154 are critical)
- `lib/whatsapp.ts` (lines 2195-2204 are critical)

## Last Updated
December 18, 2025 - All buttons working correctly

## Contact
If buttons stop working, check:
1. Baileys/baileys-pro package versions haven't changed
2. WhatsApp session is still valid
3. No code changes to button formatting logic
4. No filtering logic re-introduced

