# Groq AI HSN/SAC Validation Guide

## Overview

This feature uses Groq API (free tier) to provide AI-powered HSN/SAC code validation and suggestions for products. The system learns from usage patterns and caches results to minimize API calls.

## Setup

### 1. Get Groq API Key

1. Sign up at https://console.groq.com
2. Navigate to API Keys section
3. Create a new API key
4. Copy the key

### 2. Add to Environment Variables

Add to your `.env.local` file:

```env
GROQ_API_KEY=your_groq_api_key_here
```

### 3. Run Database Migration

Run the migration to create cache tables:

```bash
psql -U your_user -d your_database -f database/migrations/081_hsn_ai_cache.sql
```

## How It Works

### Validation Flow

```
User enters product name
    ↓
[Check Cache] → Found & Recent? → Return cached result
    ↓ Not found/old
[Check Local DB] → Good match? → Return from database
    ↓ No match
[Call Groq AI] → Get AI suggestion
    ↓
[Save to Cache] → For future use
    ↓
[Track Usage] → For learning patterns
    ↓
Return suggestion to user (with warnings)
```

### Features

1. **Smart Caching**: Results cached for 30 days to minimize API calls
2. **Local Database First**: Checks existing HSN master table before AI
3. **Usage Tracking**: Learns from actual usage patterns
4. **Warnings System**: Flags potential issues (low confidence, rate mismatches, etc.)
5. **Fallback Gracefully**: Works even if API key is missing (uses local DB only)

## API Endpoints

### 1. Validate HSN (New Endpoint)

**POST** `/api/hsn/validate`

**Request Body:**
```json
{
  "productName": "mobile phone",
  "category": "Electronics", // optional
  "existingHSN": "85171200", // optional - for validation
  "existingRate": 18, // optional - for validation
  "businessId": "uuid-here" // optional - for usage tracking
}
```

**Response:**
```json
{
  "suggestedHSN": "85171200",
  "suggestedDescription": "Telephones for cellular networks",
  "suggestedRate": 18,
  "confidence": "high",
  "reasoning": "Mobile phones typically use HSN 8517 series at 18% GST",
  "warnings": [
    "ℹ️ AI suggestions are not official - always verify with GST consultant before filing"
  ],
  "isValidFormat": true,
  "isService": false,
  "source": "groq_ai",
  "cached": false
}
```

### 2. Enhanced HSN Lookup (Existing Endpoint)

**GET** `/api/hsn/lookup?q=mobile&use_ai=true`

The existing lookup endpoint now supports optional AI fallback:
- Add `use_ai=true` parameter
- If no local results found, will try AI suggestion
- Returns AI result as first option if found

## Database Tables

### hsn_ai_suggestions

Caches AI-generated suggestions:
- `product_key`: Normalized product name + category
- `hsn_code`: Suggested HSN/SAC code
- `gst_rate`: Suggested GST rate
- `confidence`: high/medium/low
- `usage_count`: How many times this suggestion was used
- `last_used_at`: Last time it was retrieved

### hsn_usage_stats

Tracks actual usage patterns per business:
- `business_id`: Which business used it
- `hsn_sac_code`: Code that was actually used
- `gst_rate`: Rate that was used
- `product_name`: Product it was used for
- `usage_count`: How many times

## Cost Management

**Groq Free Tier:**
- 14,400 requests/day
- Completely free
- Fast responses

**With Caching:**
- First search for "mobile phone" → AI call
- Subsequent searches → Cached (no API call)
- Only ~10-20% of searches need AI calls
- Can handle 100+ users easily with free tier

## Important Notes

### ⚠️ AI Limitations

1. **Not Authoritative**: AI suggestions are NOT official GST validation
2. **Always Verify**: Users must verify with GST consultant or official sources
3. **Rates Change**: GST rates change over time - AI may have outdated info
4. **Business-Specific**: Some businesses may have special rates/exemptions

### ✅ Best Practices

1. Use AI as a **starting point**, not final answer
2. Show all warnings to users
3. Allow users to override AI suggestions
4. Track user corrections to improve system over time
5. Cache aggressively to reduce API costs

## Usage Example

```typescript
// In your item creation form
const validateHSN = async (productName: string) => {
  const response = await fetch('/api/hsn/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productName: 'mobile phone',
      category: 'Electronics',
      businessId: business?.id
    })
  });
  
  const result = await response.json();
  
  if (result.suggestedHSN) {
    // Auto-fill HSN code
    setHSNCode(result.suggestedHSN);
    
    // Auto-fill GST rate
    setTaxRate(result.suggestedRate);
    
    // Show warnings
    if (result.warnings.length > 0) {
      result.warnings.forEach(warning => {
        showToast(warning, 'warning');
      });
    }
    
    // Show confidence indicator
    if (result.confidence === 'low') {
      showAlert('Low confidence - please verify with your CA');
    }
  }
};
```

## Troubleshooting

### "AI validation unavailable"

- Check `GROQ_API_KEY` is set in `.env.local`
- Verify API key is valid at https://console.groq.com
- Check API key hasn't exceeded rate limits
- System will fall back to local database search

### Low accuracy

- AI suggestions improve with better product descriptions
- More specific categories help
- System learns over time from usage patterns
- Cache builds up with more usage

### API Rate Limits

- Free tier: 14,400 requests/day
- With caching, should never hit this limit
- If you do, requests will fail gracefully
- Consider upgrading if needed (but caching should be enough)

