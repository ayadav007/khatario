# Preview UX Fixes - Blinking & Toggle Issues

## Issues Reported

1. ❌ Preview **blinks white** when toggling checkboxes (bad UX)
2. ❌ Changes **don't actually show** in preview (toggle phone number does nothing)

---

## Root Causes Found

### Issue 1: Blinking
**Cause**: iframe reloaded on EVERY settings change (no debounce)
```typescript
// ❌ OLD CODE - Reloads immediately
useEffect(() => {
  setPreviewKey(prev => prev + 1); // Instant reload = white flash
}, [settings]);
```

### Issue 2: Toggles Don't Work
**Cause**: `ifSetting` Handlebars helper was **broken** - always returned true!
```typescript
// ❌ OLD CODE - Always shows content
Handlebars.registerHelper('ifSetting', function(settingName, options) {
  return options.fn(this); // Never checks the actual setting value!
});
```

---

## ✅ Fixes Applied

### Fix 1: Debounced Refresh + Manual Control

**New behavior**:
- ✅ Preview waits **800ms** after last change before refreshing
- ✅ No more constant white flashes!
- ✅ Added **manual "Refresh" button** for user control
- ✅ Added **"Auto-refresh" toggle** in UI

**Code changes**:
```typescript
// ✅ NEW CODE - Debounced refresh
const [autoRefresh, setAutoRefresh] = useState(true);

useEffect(() => {
  if (!autoRefresh) return;
  
  const timer = setTimeout(() => {
    setPreviewKey(prev => prev + 1);
  }, 800); // Wait 800ms after last change

  return () => clearTimeout(timer);
}, [settings, autoRefresh]);
```

**UI additions**:
- Manual "Refresh" button in header
- Auto-refresh checkbox toggle
- Visual feedback when auto-refresh is off

### Fix 2: Working ifSetting Helper

**New helper logic**:
```typescript
// ✅ NEW CODE - Actually checks the setting!
Handlebars.registerHelper('ifSetting', function(settingName, options) {
  const settingValue = this.settings?.[settingName];
  
  // If explicitly false, hide content
  if (settingValue === false) {
    return options.inverse ? options.inverse(this) : '';
  }
  
  // Otherwise show (true or undefined = default to visible)
  return options.fn(this);
});
```

**How it works**:
1. User unchecks "Show Phone": `show_business_phone = false`
2. Settings passed to API in URL
3. Helper checks: `if (settings.show_business_phone === false)` → hide
4. Content doesn't render → phone number disappears! ✅

### Fix 3: Debug Logging

Added console logs to track settings flow:
```typescript
console.log('[Preview] Custom settings applied:', Object.keys(customSettings).length);
console.log('[Preview] show_business_phone:', customSettings.show_business_phone);
console.log('[Preview] show_logo:', customSettings.show_logo);
```

**How to debug**:
1. Open browser DevTools Console
2. Toggle a checkbox
3. Wait 800ms (or click Refresh)
4. See console logs showing setting values
5. Verify setting is false when unchecked

---

## User Experience Improvements

### Before:
- ❌ Toggle checkbox → **instant white flash** (jarring)
- ❌ Content **doesn't change** (broken)
- ❌ No feedback (is it working?)
- ❌ No control over refresh timing

### After:
- ✅ Toggle checkbox → **smooth 800ms delay** → preview updates
- ✅ Content **actually hides/shows** (working!)
- ✅ Clear feedback: "Auto-refresh (800ms delay)"
- ✅ Manual "Refresh" button for instant control
- ✅ Can **disable auto-refresh** if preferred

---

## Testing Instructions

### Test 1: No More Blinking ✨
1. Go to `/settings/templates/customize`
2. Toggle ANY checkbox rapidly 5 times
3. **Expected**: Preview doesn't flash white repeatedly
4. **Expected**: Preview updates once after you stop clicking (800ms)

### Test 2: Phone Number Toggle 📱
1. In **Fields** tab, find "Show Phone" checkbox
2. **Verify**: Phone number visible in preview by default
3. **Uncheck** "Show Phone"
4. Wait 800ms or click "Refresh"
5. **Expected**: Phone number **disappears** from preview ✅
6. **Check** again
7. **Expected**: Phone number **reappears** ✅

### Test 3: Logo Toggle 🖼️
1. In **Fields** tab, find "Show Logo" checkbox
2. **Uncheck** "Show Logo"
3. Wait 800ms or click "Refresh"
4. **Expected**: Logo section disappears
5. **Check** again
6. **Expected**: Logo section reappears

### Test 4: GSTIN Toggle 🏢
1. In **Fields** tab, find "Show GSTIN" checkbox
2. **Uncheck** "Show GSTIN"
3. Wait 800ms or click "Refresh"
4. **Expected**: GSTIN line disappears from business info
5. **Check** again
6. **Expected**: GSTIN line reappears

### Test 5: Manual Refresh Button 🔄
1. **Uncheck** "Auto-refresh" toggle
2. Change multiple settings (color, font, toggles)
3. **Expected**: Preview **doesn't update** automatically
4. Click **"Refresh"** button
5. **Expected**: All changes appear at once

### Test 6: Color Changes 🎨
1. Click primary color picker
2. Change to green (#00ff00)
3. Wait 800ms
4. **Expected**: Headers turn green instantly (no white flash)

---

## Technical Details

### Debounce Implementation

**Why 800ms?**
- 500ms = too fast (triggers during multi-toggle)
- 1000ms = too slow (feels laggy)
- 800ms = sweet spot (feels responsive, avoids flashing)

**How it works**:
```typescript
useEffect(() => {
  const timer = setTimeout(() => {
    // This only runs if no changes for 800ms
    setPreviewKey(prev => prev + 1);
  }, 800);

  // If settings change again, cancel previous timer
  return () => clearTimeout(timer);
}, [settings]);
```

### ifSetting Helper Logic

**Default behavior** (undefined = true):
```handlebars
{{#ifSetting 'show_phone'}}
  Phone: {{business.phone}}
{{/ifSetting}}
```
- If `settings.show_phone` is undefined → **show** (default)
- If `settings.show_phone` is true → **show**
- If `settings.show_phone` is false → **hide**

**Explicit false check**:
```typescript
if (settingValue === false) {
  return ''; // Don't render
}
return options.fn(this); // Render content
```

---

## Files Modified

### Core Fixes:
- ✅ `app/settings/templates/customize/page.tsx`
  - Added debounced refresh
  - Added manual refresh button
  - Added auto-refresh toggle
  - Added UI feedback

- ✅ `app/api/template-preview/route.ts`
  - Fixed `ifSetting` helper
  - Added debug logging
  - Better error handling

### Documentation:
- ✅ `docs/PREVIEW_UX_FIXES.md` (this file)

---

## Console Logs to Watch

When testing, you should see:
```
[Preview] Received custom settings: Yes
[Preview] Custom settings applied: 25 settings
[Preview] show_business_phone: false
[Preview] show_logo: true
```

If you see errors:
```
[Preview] Failed to parse settings JSON: ...
```
→ Check URL encoding or JSON structure

---

## Known Limitations

1. **First load delay**: Initial preview takes 1-2 seconds (normal)
2. **Complex templates**: Some templates may take longer to render
3. **Multiple toggles**: Rapidly clicking 20 checkboxes → may see brief flash
   - **Solution**: Disable auto-refresh, make all changes, then click Refresh

---

## Future Enhancements

1. **Optimistic UI**: Show changes immediately in preview without reload
2. **WebSocket updates**: Push changes without iframe reload
3. **Preview caching**: Cache rendered templates for faster updates
4. **Batch updates**: Group multiple setting changes into one refresh
5. **Progress indicator**: Show "Refreshing..." overlay during reload

---

## Summary

✅ **No more white flashes** - Debounced refresh (800ms)  
✅ **Toggles actually work** - Fixed ifSetting helper  
✅ **User control** - Manual refresh + auto-refresh toggle  
✅ **Better UX** - Clear feedback and smooth updates  

**Status**: ✅ FIXED  
**Testing**: Ready for user validation  
**Performance**: Smooth, no jank

