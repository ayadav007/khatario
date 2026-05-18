import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { GroqHSNValidator } from '@/lib/services/groq-hsn-validator';

interface ValidateRequest {
  productName: string;
  category?: string;
  existingHSN?: string;
  existingRate?: number;
  businessId?: string;
}

// Helper functions

function normalizeProductKey(productName: string, category?: string): string {
  const normalized = productName.trim().toLowerCase().replace(/\s+/g, '_');
  return category ? `${normalized}_${category.toLowerCase()}` : normalized;
}

async function getFromCache(pool: any, productKey: string) {
  const result = await pool.query(
    `SELECT * FROM hsn_ai_suggestions 
     WHERE product_key = $1 
     ORDER BY usage_count DESC, last_used_at DESC 
     LIMIT 1`,
    [productKey]
  );
  return result.rows[0] || null;
}

function shouldUseCache(cached: any): boolean {
  if (!cached) return false;
  // Use cache if it exists and is recent (within 30 days)
  const daysSinceUpdate = (Date.now() - new Date(cached.last_used_at || cached.created_at).getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceUpdate < 30;
}

async function updateCacheUsage(pool: any, id: string) {
  await pool.query(
    `UPDATE hsn_ai_suggestions 
     SET usage_count = usage_count + 1, 
         last_used_at = CURRENT_TIMESTAMP 
     WHERE id = $1`,
    [id]
  );
}

async function searchLocalDatabase(pool: any, productName: string, category?: string) {
  const searchTerm = `%${productName.toLowerCase()}%`;
  
  let query = `
    SELECT code, description, gst_rate, category, is_service,
           ts_rank(to_tsvector('english', description), plainto_tsquery('english', $1)) as rank
    FROM hsn_sac_master
    WHERE description ILIKE $1
       OR $2 = ANY(keywords)
       OR to_tsvector('english', description) @@ plainto_tsquery('english', $3)
  `;
  
  const params: any[] = [searchTerm, productName.toLowerCase(), productName.toLowerCase()];
  
  if (category) {
    query += ` OR category ILIKE $${params.length + 1}`;
    params.push(`%${category}%`);
  }
  
  query += ` ORDER BY rank DESC LIMIT 1`;
  
  const result = await pool.query(query, params);
  return result.rows[0] || null;
}

async function saveToCache(pool: any, data: any) {
  const {
    productKey,
    suggestedHSN,
    suggestedDescription,
    suggestedRate,
    confidence,
    reasoning,
    category,
    isService
  } = data;

  // Use product_key as unique key (handled by unique index)
  await pool.query(
    `INSERT INTO hsn_ai_suggestions 
     (product_key, hsn_code, description, gst_rate, confidence, reasoning, category, is_service, usage_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
     ON CONFLICT (product_key) 
     DO UPDATE SET 
       hsn_code = EXCLUDED.hsn_code,
       description = EXCLUDED.description,
       gst_rate = EXCLUDED.gst_rate,
       confidence = EXCLUDED.confidence,
       reasoning = EXCLUDED.reasoning,
       category = EXCLUDED.category,
       is_service = EXCLUDED.is_service,
       usage_count = hsn_ai_suggestions.usage_count + 1,
       last_used_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`,
    [productKey, suggestedHSN, suggestedDescription, suggestedRate, confidence, reasoning, category || null, isService]
  );
}

async function trackUsage(pool: any, businessId: string, hsnCode: string, rate: number, productName: string) {
  await pool.query(
    `INSERT INTO hsn_usage_stats (business_id, hsn_sac_code, gst_rate, product_name, usage_count)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (business_id, hsn_sac_code, gst_rate, product_name)
     DO UPDATE SET 
       usage_count = hsn_usage_stats.usage_count + 1,
       last_used_at = CURRENT_TIMESTAMP`,
    [businessId, hsnCode, rate, productName]
  );
}

export async function POST(request: NextRequest) {
  try {
    const body: ValidateRequest = await request.json();
    const { productName, category, existingHSN, existingRate, businessId } = body;

    if (!productName || productName.trim().length < 2) {
      return NextResponse.json(
        { error: 'Product name is required (minimum 2 characters)' },
        { status: 400 }
      );
    }

    const pool = getPool();
    const validator = new GroqHSNValidator();

    // 1. Check cache first (normalized product key)
    const productKey = normalizeProductKey(productName, category);
    const cached = await getFromCache(pool, productKey);
    
    if (cached && shouldUseCache(cached)) {
      // Update usage count
      await updateCacheUsage(pool, cached.id);
      return NextResponse.json({ 
        suggestions: [{
          code: cached.hsn_code,
          description: cached.description,
          rate: cached.gst_rate,
          confidence: cached.confidence,
          reasoning: cached.reasoning || 'Cached result',
          warnings: [],
          isService: cached.is_service,
          useCase: ''
        }],
        source: 'cache',
        cached: true 
      });
    }

    // 2. Check local database
    const localMatch = await searchLocalDatabase(pool, productName, category);
    if (localMatch && localMatch.rank > 0.1) {
      return NextResponse.json({
        suggestions: [{
          code: localMatch.code,
          description: localMatch.description,
          rate: localMatch.gst_rate,
          confidence: 'high',
          reasoning: 'Found in local database',
          warnings: [],
          isService: localMatch.is_service,
          useCase: localMatch.category || ''
        }],
        source: 'local_database'
      });
    }

    // 3. Use Groq AI
    const aiResponse = await validator.validateHSN({
      productName,
      category,
      existingHSN,
      existingRate
    });

    if (!aiResponse || !aiResponse.suggestions || aiResponse.suggestions.length === 0) {
      return NextResponse.json(
        { error: 'AI validation unavailable. Please check GROQ_API_KEY configuration.' },
        { status: 503 }
      );
    }

    // 4. Save first suggestion to cache (for backward compatibility)
    const firstSuggestion = aiResponse.suggestions[0];
    await saveToCache(pool, {
      productKey,
      suggestedHSN: firstSuggestion.code,
      suggestedDescription: firstSuggestion.description,
      suggestedRate: firstSuggestion.rate,
      confidence: firstSuggestion.confidence,
      reasoning: firstSuggestion.reasoning,
      category: category || null,
      isService: firstSuggestion.isService
    });

    // 5. Track usage if businessId provided (track first suggestion)
    if (businessId && firstSuggestion.code) {
      await trackUsage(pool, businessId, firstSuggestion.code, firstSuggestion.rate, productName);
    }

    // Return all suggestions
    return NextResponse.json({
      suggestions: aiResponse.suggestions.map(s => ({
        code: s.code,
        description: s.description,
        rate: s.rate,
        confidence: s.confidence,
        reasoning: s.reasoning,
        warnings: s.warnings,
        isService: s.isService,
        useCase: s.useCase,
        isValidFormat: true
      })),
      source: 'groq_ai',
      cached: false
    });

  } catch (error: any) {
    console.error('HSN Validation Error:', error);
    return NextResponse.json(
      { error: 'Failed to validate HSN', details: error.message },
      { status: 500 }
    );
  }
}

