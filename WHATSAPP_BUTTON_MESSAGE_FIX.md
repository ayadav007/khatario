# WhatsApp Button Message Fix - 405 Error Resolution

## Problem Summary

Button messages were not being delivered to users, with WhatsApp rejecting them with **error 405**.

## Root Cause

The code was treating **all button types the same way**, using the `viewOnceMessage` + `nativeFlowMessage` + `<biz>` node format for both:
- Quick reply buttons
- CTA buttons (call/url)

However, WhatsApp's protocol differentiates these:
- ❌ **Quick reply buttons**: Should NOT use `viewOnceMessage` wrapper or `<biz>` node
- ✅ **CTA buttons (call/url)**: Require `viewOnceMessage` + `nativeFlowMessage` + `<biz>` node

## The Fix

Modified `lib/baileys-hybrid.ts` to differentiate button types:

### 1. `formatButtonMessage` Function

Now checks for CTA buttons and uses different formats:

```typescript
// Check if we have any CTA buttons (call/url)
const hasCTAButtons = buttons.some(b => b.type === 'call' || b.type === 'url');

if (!hasCTAButtons) {
  // All quick reply buttons - use standard Baileys format (no <biz> node)
  return {
    buttonsMessage: {
      contentText: text,
      footerText: footer || '',
      buttons: buttons.map((btn, index) => ({
        buttonId: btn.id || `btn_${index}`,
        buttonText: { displayText: btn.title.substring(0, 20) },
        type: 1 // RESPONSE type
      }))
    }
  };
}

// Has CTA buttons - use baileys-pro native flow format with <biz> node
// ... (viewOnceMessage + interactiveMessage + nativeFlowMessage)
```

### 2. `sendButtonMessage` Function

Now checks button types and uses different sending methods:

```typescript
const hasCTAButtons = buttons.some(b => b.type === 'call' || b.type === 'url');

if (!hasCTAButtons) {
  // For quick reply buttons, use standard sendMessage (no <biz> node needed)
  const msgId = await socket.sendMessage(jid, buttonMessageProto);
  // ...
} else {
  // For CTA buttons, use baileys-pro approach with <biz> node
  const fullMsg = generateWAMessageFromContent(jid, buttonMessageProto, {
    userJid,
    messageId: generateMessageID(),
    timestamp: new Date()
  });
  
  const msgId = await socket.relayMessage(jid, fullMsg.message, {
    messageId: fullMsg.key.id,
    addBizInteractive: true // Triggers <biz> node injection
  });
}
```

## Button Type Matrix

| Button Type | Format | `<biz>` Node | Works? |
|-------------|--------|--------------|--------|
| Quick Reply | `buttonsMessage` | ❌ No | ✅ Yes |
| Call (CTA) | `viewOnceMessage` + `nativeFlowMessage` | ✅ Yes | ✅ Yes |
| URL (CTA) | `viewOnceMessage` + `nativeFlowMessage` | ✅ Yes | ✅ Yes |

## Expected Behavior After Fix

### Quick Reply Buttons
- Use standard Baileys `buttonsMessage` format
- No `<biz>` node added
- No 405 error
- Buttons appear and work correctly

### CTA Buttons (Call/URL)
- Use baileys-pro `viewOnceMessage` + `nativeFlowMessage` format
- `<biz><interactive type="native_flow" v="1">` node added
- No 405 error
- Buttons appear as WhatsApp native call/URL buttons

## Testing

1. **Test quick reply buttons**: Create a campaign with only quick reply buttons
   - Expected: Message delivered with clickable quick reply buttons
   
2. **Test CTA buttons**: Create a campaign with call and/or URL buttons
   - Expected: Message delivered with native WhatsApp CTA buttons
   
3. **Test mixed buttons** (if needed): The code already handles this by prioritizing CTA buttons

## Files Modified

- `lib/baileys-hybrid.ts`
  - `formatButtonMessage()` function
  - `sendButtonMessage()` function
  - Updated comments in `sendMessage` override

## References

- [Baileys Pro Documentation](https://www.npmjs.com/package/baileys-pro)
- [WhatsApp Interactive Messages](https://developers.facebook.com/docs/whatsapp/on-premises/reference/messages#interactive-object)
- GitHub Issue: WhatsApp 405 errors for button messages

