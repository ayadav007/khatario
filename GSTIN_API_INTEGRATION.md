# GSTIN Auto-Fetch Integration Guide

This document explains how to integrate GSTIN verification and auto-fetch functionality in Khatario.

## Current Implementation

The basic structure for GSTIN verification is implemented in:
- **API Route**: `app/api/gstin/verify/route.ts`
- **Customer Form**: `app/customers/new/page.tsx`
- **Supplier Form**: `app/suppliers/new/page.tsx`

## Basic Validation (Currently Active)

The system currently performs:
1. **Format Validation**: Validates 15-character GSTIN format
2. **State Extraction**: Extracts state code from first 2 digits of GSTIN
3. **Checksum Validation**: Validates GSTIN structure

## Integration Options

### Option 1: Government GST Portal API (Recommended)

**Steps to integrate:**

1. Register at [GST Portal](https://gst.gov.in/)
2. Apply for API access credentials
3. Add credentials to `.env.local`:
   ```env
   GSTIN_API_URL=https://gst.gov.in/api/search/taxpayer
   GSTIN_API_KEY=your_api_key_here
   GST_API_USERNAME=your_username
   GST_API_PASSWORD=your_password
   ```

4. Update `app/api/gstin/verify/route.ts` to use government API:

```typescript
// Uncomment the government API section
const response = await fetch(`https://gst.gov.in/api/search/taxpayer?gstin=${gstin}`, {
  headers: {
    'Authorization': `Bearer ${process.env.GSTIN_API_KEY}`,
    'username': process.env.GST_API_USERNAME,
    'password': process.env.GST_API_PASSWORD
  }
});

const data = await response.json();

// Map response to standardized format
return NextResponse.json({
  gstin,
  verified: true,
  details: {
    legal_name: data.lgnm || '',
    trade_name: data.tradeNam || '',
    address: `${data.pradr?.addr?.bno || ''} ${data.pradr?.addr?.st || ''} ${data.pradr?.addr?.loc || ''}`,
    city: data.pradr?.addr?.dst || '',
    state: stateMap[data.pradr?.stcd] || '',
    state_code: data.pradr?.stcd || '',
    pincode: data.pradr?.addr?.pncd || '',
    business_type: data.ctb || '',
    registration_date: data.rgdt || '',
    status: data.sts || 'Active',
  }
});
```

### Option 2: Third-Party APIs

Several third-party services provide GSTIN verification:

#### A. Masters India API
- **Website**: https://www.mastersindia.co/
- **Pricing**: Pay-per-use
- **Features**: GSTIN verification, return filing status, business details

```env
GSTIN_API_URL=https://api.mastersindia.co/gstinVerification
GSTIN_API_KEY=your_masters_api_key
```

#### B. KnowYourGST
- **Website**: https://knowyourgst.com/
- **Pricing**: Subscription-based
- **Features**: Real-time GSTIN verification, detailed business info

```env
GSTIN_API_URL=https://api.knowyourgst.com/verify
GSTIN_API_KEY=your_knowyourgst_api_key
```

#### C. Vakilsearch API
- **Website**: https://vakilsearch.com/
- **Features**: GSTIN verification, compliance tracking

```env
GSTIN_API_URL=https://api.vakilsearch.com/gstin/verify
GSTIN_API_KEY=your_vakilsearch_api_key
```

### Option 3: Scraping (Not Recommended)

Some developers use web scraping from the public GST portal search. **This is NOT recommended** because:
- Violates terms of service
- Unreliable and slow
- Can get IP blocked
- May break with website updates

## Data Mapping

Standard response format from `app/api/gstin/verify/route.ts`:

```typescript
{
  gstin: string;              // 15-character GSTIN
  verified: boolean;          // true if API verification succeeded
  state: string;              // State name (always available)
  state_code: string;         // 2-digit state code (always available)
  message?: string;           // Info message if API not available
  details: {
    legal_name?: string;      // Legal business name
    trade_name?: string;      // Trade/brand name
    address?: string;         // Registered address
    city?: string;           // City
    state: string;           // State name
    state_code: string;      // State code
    pincode?: string;        // PIN code
    business_type?: string;  // Business constitution
    registration_date?: string;  // GST registration date
    status?: string;         // Active/Cancelled/Suspended
  }
}
```

## Testing

### Test GSTINs

Use these for testing (public test GSTINs):

```
29ABCDE1234F1Z5  // Karnataka
27AABCT1234L1ZZ  // Maharashtra
07AAFCD5862R1ZR  // Delhi
```

### Manual Testing Steps

1. Go to "Add New Customer" page
2. Enter a 15-character GSTIN
3. Click "Fetch Details" button
4. Verify form auto-populates with:
   - Business name
   - Address
   - City
   - State (dropdown auto-selected)
   - PIN code

## Rate Limits

Most GST APIs have rate limits:
- **Government API**: ~100 requests/day (free tier)
- **Third-party APIs**: Varies by plan (usually 1000-10000/month)

Consider implementing:
1. **Caching**: Store verified GSTINs in database
2. **Rate limiting**: Prevent abuse
3. **Debouncing**: Delay verification on user input

## Error Handling

The current implementation handles:
- ✅ Invalid GSTIN format
- ✅ API unavailable (fallback to basic validation)
- ✅ Network errors
- ✅ Invalid API responses

## Future Enhancements

1. **GSTIN Cache**: Store verified GSTINs to avoid repeated API calls
2. **Bulk Verification**: Upload CSV for bulk GSTIN verification
3. **Real-time Validation**: Verify on blur instead of button click
4. **Status Monitoring**: Show if GSTIN is Active/Cancelled
5. **Return Filing Status**: Display GSTR filing status

## Security Considerations

1. **Never expose API keys** in frontend code
2. Use environment variables for credentials
3. Implement rate limiting on API route
4. Add CORS protection
5. Log all verification attempts for audit

## Support

For API access or integration issues:
- Government GST Portal: https://gst.gov.in/
- Masters India: support@mastersindia.co
- Technical issues: Contact your development team

---

**Last Updated**: December 2025  
**Version**: 1.0

