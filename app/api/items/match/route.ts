import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';

/**
 * POST /api/items/match
 * Find matching items using HSN/SAC code and fuzzy name matching
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, name, hsn_sac, description } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!name && !hsn_sac) {
      return NextResponse.json(
        { error: 'Either name or hsn_sac is required' },
        { status: 400 }
      );
    }

    const matches: any[] = [];

    // Try exact HSN/SAC match first
    if (hsn_sac) {
      const hsnMatches = await queryRows(
        `SELECT id, name, description, hsn_sac, 
                selling_price, purchase_price, tax_rate, unit
         FROM items
         WHERE business_id = $1 
         AND deleted_at IS NULL
         AND UPPER(hsn_sac) = UPPER($2)
         LIMIT 3`,
        [business_id, hsn_sac]
      );

      for (const item of hsnMatches) {
        matches.push({
          item_id: item.id,
          item_name: item.name,
          description: item.description,
          hsn_sac: item.hsn_sac,
          selling_price: item.selling_price,
          purchase_price: item.purchase_price,
          tax_rate: item.tax_rate,
          unit: item.unit,
          match_type: 'exact_hsn',
          confidence: 100
        });
      }

      // Try hierarchical HSN match (e.g., 8517 matches 85171000)
      if (hsn_sac.length < 8) {
        const hierarchicalMatches = await queryRows(
          `SELECT id, name, description, hsn_sac, 
                  selling_price, purchase_price, tax_rate, unit
           FROM items
           WHERE business_id = $1 
           AND deleted_at IS NULL
           AND hsn_sac LIKE $2 || '%'
           AND UPPER(hsn_sac) != UPPER($2)
           LIMIT 3`,
          [business_id, hsn_sac]
        );

        for (const item of hierarchicalMatches) {
          if (!matches.some(m => m.item_id === item.id)) {
            matches.push({
              item_id: item.id,
              item_name: item.name,
              description: item.description,
              hsn_sac: item.hsn_sac,
              selling_price: item.selling_price,
              purchase_price: item.purchase_price,
              tax_rate: item.tax_rate,
              unit: item.unit,
              match_type: 'hsn_related',
              confidence: 90
            });
          }
        }
      }
    }

    // Try exact name match
    if (name) {
      const nameMatches = await queryRows(
        `SELECT id, name, description, hsn_sac, 
                selling_price, purchase_price, tax_rate, unit
         FROM items
         WHERE business_id = $1 
         AND deleted_at IS NULL
         AND LOWER(name) = LOWER($2)
         LIMIT 1`,
        [business_id, name]
      );

      for (const item of nameMatches) {
        if (!matches.some(m => m.item_id === item.id)) {
          matches.push({
            item_id: item.id,
            item_name: item.name,
            description: item.description,
            hsn_sac: item.hsn_sac,
            selling_price: item.selling_price,
            purchase_price: item.purchase_price,
            tax_rate: item.tax_rate,
            unit: item.unit,
            match_type: 'exact_name',
            confidence: 100
          });
        }
      }

      // Try fuzzy name matching using similarity
      try {
        const fuzzyMatches = await queryRows(
          `SELECT id, name, description, hsn_sac, 
                  selling_price, purchase_price, tax_rate, unit,
                  similarity(LOWER(name), LOWER($2)) as name_score
           FROM items
           WHERE business_id = $1 
           AND deleted_at IS NULL
           AND similarity(LOWER(name), LOWER($2)) > 0.3
           ORDER BY name_score DESC
           LIMIT 5`,
          [business_id, name]
        );

        for (const item of fuzzyMatches) {
          if (!matches.some(m => m.item_id === item.id)) {
            matches.push({
              item_id: item.id,
              item_name: item.name,
              description: item.description,
              hsn_sac: item.hsn_sac,
              selling_price: item.selling_price,
              purchase_price: item.purchase_price,
              tax_rate: item.tax_rate,
              unit: item.unit,
              match_type: 'fuzzy_name',
              confidence: Math.round(item.name_score * 100)
            });
          }
        }
      } catch (fuzzyError) {
        console.log('Fuzzy matching not available (pg_trgm extension might not be installed)');
        
        // Fallback: simple ILIKE matching
        const likeMatches = await queryRows(
          `SELECT id, name, description, hsn_sac, 
                  selling_price, purchase_price, tax_rate, unit
           FROM items
           WHERE business_id = $1 
           AND deleted_at IS NULL
           AND (LOWER(name) LIKE '%' || LOWER($2) || '%'
                OR LOWER($2) LIKE '%' || LOWER(name) || '%')
           LIMIT 5`,
          [business_id, name]
        );

        for (const item of likeMatches) {
          if (!matches.some(m => m.item_id === item.id)) {
            matches.push({
              item_id: item.id,
              item_name: item.name,
              description: item.description,
              hsn_sac: item.hsn_sac,
              selling_price: item.selling_price,
              purchase_price: item.purchase_price,
              tax_rate: item.tax_rate,
              unit: item.unit,
              match_type: 'partial_name',
              confidence: 70
            });
          }
        }
      }
    }

    // Return matches sorted by confidence
    matches.sort((a, b) => b.confidence - a.confidence);

    return NextResponse.json({
      matches: matches.slice(0, 5) // Top 5 matches
    });

  } catch (error: any) {
    console.error('Error in item matching:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
