import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { GroqHSNValidator } from '@/lib/services/groq-hsn-validator';

interface HSNResult {
  code: string;
  description: string;
  gst_rate: number | null;
  category: string;
  is_service: boolean;
  source?: string;
  confidence?: string;
  warnings?: string[];
  rate_source?: string; // 'database', 'ai', 'no_rate'
  reasoning?: string;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || ''; // Search query (product name/keywords)
    const limit = parseInt(searchParams.get('limit') || '10');

    if (!query || query.trim().length < 2) {
      return NextResponse.json({ results: [] });
    }

    const searchTerm = query.trim().toLowerCase();

    // Search in multiple ways:
    // 1. Exact code match
    // 2. Description contains search term
    // 3. Keywords array contains search term
    // 4. Full-text search on description

    const searchQuery = `
      SELECT 
        code,
        description,
        gst_rate,
        category,
        is_service,
        CASE 
          WHEN gst_rate IS NOT NULL THEN 'database'
          ELSE 'no_rate'
        END as rate_source
      FROM hsn_sac_master
      WHERE 
        code ILIKE $1
        OR description ILIKE $2
        OR $3 = ANY(keywords)
        OR to_tsvector('english', description) @@ plainto_tsquery('english', $4)
      ORDER BY 
        CASE WHEN code = $5 THEN 1 ELSE 2 END,
        CASE WHEN description ILIKE $6 THEN 1 ELSE 2 END,
        CASE WHEN $7 = ANY(keywords) THEN 1 ELSE 2 END,
        CASE WHEN gst_rate IS NOT NULL THEN 1 ELSE 2 END, -- Prioritize codes with rates
        ts_rank(to_tsvector('english', description), plainto_tsquery('english', $8)) DESC
      LIMIT $9
    `;

    const searchPattern = `%${searchTerm}%`;
    const exactMatch = searchTerm;
    const prefixMatch = `${searchTerm}%`;

    const results = await queryRows<HSNResult>(searchQuery, [
      prefixMatch,              // $1: code ILIKE
      searchPattern,            // $2: description ILIKE
      searchTerm,               // $3: keywords array contains
      searchTerm,               // $4: full-text search
      exactMatch,               // $5: exact code match for ordering
      prefixMatch,              // $6: description prefix for ordering
      searchTerm,               // $7: keywords for ordering
      searchTerm,               // $8: full-text ranking
      limit                     // $9: limit
    ]);

    // Strategy: Use database codes (official), AI only for rates
    if (results.length > 0) {
      // We have database results - use official codes, get rates from AI if missing
      const resultsWithoutRates = results.filter(r => !r.gst_rate);
      
      if (resultsWithoutRates.length > 0 && process.env.GROQ_API_KEY) {
        try {
          const validator = new GroqHSNValidator();
          const codesNeedingRates = resultsWithoutRates.map(r => r.code);
          
          // Get rates from AI for these specific codes
          const aiRates = await validator.getRatesForCodes(codesNeedingRates, query);
          
          // Enhance results with AI rates
          const enhancedResults = results.map(result => {
            if (!result.gst_rate && aiRates.has(result.code)) {
              const aiRate = aiRates.get(result.code)!;
              return {
                ...result,
                gst_rate: aiRate.rate,
                rate_source: 'ai',
                confidence: aiRate.confidence,
                warnings: aiRate.warnings,
                reasoning: aiRate.reasoning,
                source: 'database' // Code is from database (official)
              };
            }
            return {
              ...result,
              rate_source: result.gst_rate ? 'database' : 'no_rate',
              source: 'database' // All codes from database are official
            };
          });
          
          return NextResponse.json({ results: enhancedResults });
        } catch (aiError) {
          console.error('AI rate lookup error:', aiError);
          // Return database results even if AI fails
        }
      }
      
      // Return database results (with or without rates)
      return NextResponse.json({ 
        results: results.map(r => ({
          ...r,
          source: 'database', // Official codes from GST portal
          rate_source: r.gst_rate ? 'database' : 'no_rate'
        }))
      });
    }
    
    // No database results - use AI to suggest codes (fallback)
    if (process.env.GROQ_API_KEY) {
      try {
        const validator = new GroqHSNValidator();
        const aiResponse = await validator.validateHSN({ productName: query });
        
        if (aiResponse && aiResponse.suggestions && aiResponse.suggestions.length > 0) {
          const aiResults = aiResponse.suggestions.map((suggestion) => ({
            code: suggestion.code,
            description: suggestion.description,
            gst_rate: suggestion.rate,
            category: suggestion.useCase || '',
            is_service: suggestion.isService,
            source: 'ai', // AI suggested code (not in official database)
            confidence: suggestion.confidence,
            warnings: suggestion.warnings,
            reasoning: suggestion.reasoning,
            rate_source: 'ai'
          }));
          
          return NextResponse.json({ results: aiResults });
        }
      } catch (aiError) {
        console.error('AI lookup error:', aiError);
      }
    }

    return NextResponse.json({ results });
  } catch (error: any) {
    console.error('HSN/SAC Lookup Error:', error);
    return NextResponse.json(
      { error: 'Failed to search HSN/SAC codes', details: error.message },
      { status: 500 }
    );
  }
}

