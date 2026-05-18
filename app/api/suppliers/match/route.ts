import { NextRequest, NextResponse } from 'next/server';
import { queryRows, query } from '@/lib/db';

/**
 * POST /api/suppliers/match
 * Find matching suppliers using fuzzy matching and aliases
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, name, gstin } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!name && !gstin) {
      return NextResponse.json(
        { error: 'Either name or gstin is required' },
        { status: 400 }
      );
    }

    // Try exact GSTIN match first
    if (gstin) {
      const gstinMatch = await queryRows(
        `SELECT id, name, gstin, email, phone, state, state_code
         FROM suppliers
         WHERE business_id = $1 AND deleted_at IS NULL AND UPPER(gstin) = UPPER($2)
         LIMIT 1`,
        [business_id, gstin]
      );

      if (gstinMatch.length > 0) {
        return NextResponse.json({
          match: {
            supplier_id: gstinMatch[0].id,
            supplier_name: gstinMatch[0].name,
            gstin: gstinMatch[0].gstin,
            match_type: 'exact_gstin',
            confidence: 100
          }
        });
      }
    }

    // Try exact name match
    if (name) {
      const nameMatch = await queryRows(
        `SELECT id, name, gstin, email, phone, state, state_code
         FROM suppliers
         WHERE business_id = $1 AND deleted_at IS NULL AND LOWER(name) = LOWER($2)
         LIMIT 1`,
        [business_id, name]
      );

      if (nameMatch.length > 0) {
        return NextResponse.json({
          match: {
            supplier_id: nameMatch[0].id,
            supplier_name: nameMatch[0].name,
            gstin: nameMatch[0].gstin,
            match_type: 'exact_name',
            confidence: 100
          }
        });
      }

      // Try alias match
      const aliasMatch = await queryRows(
        `SELECT s.id, s.name, s.gstin, sna.alias_name
         FROM supplier_name_aliases sna
         JOIN suppliers s ON s.id = sna.supplier_id
         WHERE s.business_id = $1 AND s.deleted_at IS NULL AND LOWER(sna.alias_name) = LOWER($2)
         LIMIT 1`,
        [business_id, name]
      );

      if (aliasMatch.length > 0) {
        // Update usage count
        await query(
          `UPDATE supplier_name_aliases 
           SET usage_count = usage_count + 1, 
               last_used_at = CURRENT_TIMESTAMP
           WHERE supplier_id = $1 AND LOWER(alias_name) = LOWER($2)`,
          [aliasMatch[0].id, name]
        );

        return NextResponse.json({
          match: {
            supplier_id: aliasMatch[0].id,
            supplier_name: aliasMatch[0].name,
            gstin: aliasMatch[0].gstin,
            match_type: 'alias',
            matched_alias: aliasMatch[0].alias_name,
            confidence: 95
          }
        });
      }

      // Try fuzzy match using PostgreSQL's levenshtein
      // Note: Requires pg_trgm extension for similarity search
      try {
        const fuzzyMatches = await queryRows(
          `SELECT id, name, gstin, 
                  similarity(LOWER(name), LOWER($2)) as score
           FROM suppliers
           WHERE business_id = $1 AND deleted_at IS NULL
           AND similarity(LOWER(name), LOWER($2)) > 0.3
           ORDER BY score DESC
           LIMIT 3`,
          [business_id, name]
        );

        if (fuzzyMatches.length > 0) {
          return NextResponse.json({
            matches: fuzzyMatches.map((m: any) => ({
              supplier_id: m.id,
              supplier_name: m.name,
              gstin: m.gstin,
              match_type: 'fuzzy',
              confidence: Math.round(m.score * 100)
            }))
          });
        }
      } catch (fuzzyError) {
        console.log('Fuzzy matching not available (pg_trgm extension might not be installed)');
      }
    }

    // No match found
    return NextResponse.json({
      match: null,
      message: 'No matching supplier found'
    });

  } catch (error: any) {
    console.error('Error in supplier matching:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
