import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';

/**
 * Search for business accounts by name and phone number
 * Used when adding a supplier to find if they have an account
 * GET /api/suppliers/search-business?name=xxx&phone=xxx&exclude_business_id=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');
    const phone = searchParams.get('phone');
    const gstin = searchParams.get('gstin');
    const excludeBusinessId = searchParams.get('exclude_business_id');

    if (!name && !phone && !gstin) {
      return NextResponse.json(
        { error: 'At least one of name, phone, or gstin is required' },
        { status: 400 }
      );
    }

    // Build dynamic search query
    let whereConditions: string[] = [];
    let params: any[] = [];
    let paramIndex = 1;

    // Exclude the requesting business from results (can't add yourself as supplier)
    if (excludeBusinessId) {
      whereConditions.push(`b.id != $${paramIndex}`);
      params.push(excludeBusinessId);
      paramIndex++;
    }

    // Search by name (case-insensitive, partial match)
    if (name && name.trim().length > 0) {
      whereConditions.push(`LOWER(b.name) LIKE LOWER($${paramIndex})`);
      params.push(`%${name.trim()}%`);
      paramIndex++;
    }

    // Search by phone (exact or partial match, removing common formatting)
    if (phone && phone.trim().length > 0) {
      const cleanPhone = phone.replace(/\D/g, ''); // Remove non-digits
      whereConditions.push(`REGEXP_REPLACE(b.phone, '[^0-9]', '', 'g') LIKE $${paramIndex}`);
      params.push(`%${cleanPhone}%`);
      paramIndex++;
    }

    // Search by GSTIN (exact match, case-insensitive)
    if (gstin && gstin.trim().length > 0) {
      whereConditions.push(`UPPER(TRIM(b.gstin)) = UPPER(TRIM($${paramIndex}))`);
      params.push(gstin.trim());
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}` 
      : '';

    // Add requester business_id for already_linked check
    const requesterBusinessIdParam = paramIndex;
    if (excludeBusinessId) {
      params.push(excludeBusinessId);
    } else {
      params.push(null);
    }
    paramIndex++;

    // Prepare normalized values for confidence calculation in JavaScript
    const normalizedGstin = gstin ? gstin.trim().toUpperCase() : '';
    const normalizedPhone = phone ? phone.replace(/\D/g, '') : '';
    const normalizedName = name ? name.trim().toLowerCase() : '';

    // Simple query without complex CASE statements for confidence
    const query = `
      SELECT 
        b.id,
        b.name,
        b.phone,
        b.email,
        COALESCE(b.address_line1 || 
          CASE WHEN b.address_line2 IS NOT NULL AND b.address_line2 != '' THEN '\n' || b.address_line2 ELSE '' END, 
          '') as address,
        b.city,
        b.state,
        b.pincode,
        b.gstin,
        b.pan,
        b.created_at,
        -- Check if already linked as supplier
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM suppliers s 
            WHERE s.linked_business_id = b.id 
            AND s.business_id = $${requesterBusinessIdParam}
            AND s.deleted_at IS NULL
          )
          THEN true
          ELSE false
        END as already_linked,
        -- Name similarity score (using pg_trgm)
        CASE 
          WHEN $${paramIndex}::text != '' 
            THEN SIMILARITY(LOWER(b.name), $${paramIndex}::text)
          ELSE 0
        END as name_similarity
      FROM businesses b
      ${whereClause}
      ORDER BY 
        name_similarity DESC,
        b.name
      LIMIT 20
    `;

    // Add normalized name for similarity calculation
    params.push(normalizedName);
    paramIndex++;

    const businesses = await queryRows(query, params);

    // Calculate match confidence in JavaScript
    const businessesWithConfidence = businesses.map((b: any) => {
      let matchConfidence = 40; // Default
      let nameSim = b.name_similarity || 0;

      // 100%: GSTIN exact match
      if (normalizedGstin && b.gstin) {
        const businessGstin = b.gstin.trim().toUpperCase();
        if (businessGstin === normalizedGstin) {
          matchConfidence = 100;
        }
      }

      // 90%: Phone normalized match (only if GSTIN didn't match)
      if (matchConfidence < 100 && normalizedPhone && b.phone) {
        const businessPhone = b.phone.replace(/\D/g, '');
        if (businessPhone === normalizedPhone) {
          matchConfidence = 90;
        }
      }

      // 80%: High name similarity (>0.8)
      if (matchConfidence < 90 && normalizedName && nameSim > 0.8) {
        matchConfidence = 80;
      }
      // 60%: Medium name similarity (>0.6)
      else if (matchConfidence < 80 && normalizedName && nameSim > 0.6) {
        matchConfidence = 60;
      }

      return {
        ...b,
        match_confidence: matchConfidence,
        name_similarity: nameSim
      };
    });

    // Sort by confidence and name
    businessesWithConfidence.sort((a: any, b: any) => {
      if (b.match_confidence !== a.match_confidence) {
        return b.match_confidence - a.match_confidence;
      }
      if (normalizedName) {
        const aExact = a.name.toLowerCase() === normalizedName;
        const bExact = b.name.toLowerCase() === normalizedName;
        if (aExact !== bExact) return aExact ? -1 : 1;
        const aPrefix = a.name.toLowerCase().startsWith(normalizedName);
        const bPrefix = b.name.toLowerCase().startsWith(normalizedName);
        if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      success: true,
      results: businessesWithConfidence,
      count: businessesWithConfidence.length
    });

  } catch (error: any) {
    console.error('Error searching businesses:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to search businesses' },
      { status: 500 }
    );
  }
}

