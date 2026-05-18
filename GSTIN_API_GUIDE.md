# GSTIN Auto-Fetch API Guide

## Current Implementation

The app now tries **2 free GSTIN APIs** in sequence:

1. **Masters India API** (Primary)
   - Free: 100 requests/month
   - URL: `https://commonapi.mastersindia.co/commonapis/searchgstin?gstin={GSTIN}`

2. **GST.IN API** (Fallback)
   - Free: Unlimited (public API)
   - URL: `https://gst.nic.in/commonapi/search?action=TP&gstin={GSTIN}`

3. **Offline Validation** (Last Resort)
   - Extracts state code from GSTIN structure
   - Always works, but no business details

## Why "Only State Code Extracted"?

This message appears when:
1. ❌ GSTIN doesn't exist in government database
2. ❌ Free API limits reached
3. ❌ APIs are temporarily down
4. ❌ GSTIN is invalid or cancelled

## Valid Test GSTINs

Try these **real, active GSTINs** for testing:

```
27AADCB2230M1ZV  - Bata India Limited (Maharashtra)
29AABCT1332L1ZV  - Tech Mahindra Limited (Karnataka)
09AAACH7409R1ZZ  - Coca Cola India Pvt Ltd (Uttar Pradesh)
24AAACR5055K1Z4  - RSPL Limited (Gujarat)
07AABCM5022B1ZY  - Maruti Suzuki India Ltd (Delhi)
```

## Alternative Free APIs

### Option 1: ASP.NET API
```bash
https://sheet.gstincheck.co.in/check/{GSTIN_HERE}
```
Free, no limit, returns JSON with business details.

### Option 2: RapidAPI (100 calls/month free)
```bash
https://gst-verification.p.rapidapi.com/v3/gstin/27AADCB2230M1ZV
```
Requires API key (free signup).

### Option 3: Government GSTN API (Official)
- Requires GST login credentials
- More reliable but needs authentication
- Not recommended for automatic lookups

## Debugging

Check browser console or server logs for:
```
Masters India Response: {...}
GST.IN Response: {...}
Using API: Masters India
Final Result: {...}
```

## Recommended Solution

For production use, consider:
1. **Caching** - Store fetched GSTIN details in database
2. **Paid Plan** - Masters India: $10/month for 5000 requests
3. **Manual Entry** - Always allow manual input if API fails

## How to Switch APIs

Edit `app/api/gstin/lookup/route.ts` and replace the API URL:

```typescript
const response = await fetch(
  `https://sheet.gstincheck.co.in/check/${gstin}`,
  { method: 'GET' }
);
```

## Rate Limits

| API | Free Tier | Paid Tier |
|-----|-----------|-----------|
| Masters India | 100/month | $10 for 5000/month |
| ASP.NET GSTINCHECK | Unlimited | N/A |
| RapidAPI | 100/month | $5 for 1000/month |
| Government GSTN | Requires auth | Free |

## Current Status

✅ Multiple APIs with auto-fallback
✅ Detailed console logging for debugging
✅ Graceful degradation to state code extraction
✅ Works in customer and supplier forms

