import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { normalizeBusinessName, normalizePhone } from '@/lib/supplier-matching';

/**
 * Check for duplicate suppliers before creation
 * GET /api/suppliers/check-duplicate?business_id=xxx&name=xxx&phone=xxx&gstin=xxx
 * Returns warnings (not errors) - customer can override
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const name = searchParams.get('name');
    const phone = searchParams.get('phone');
    const gstin = searchParams.get('gstin');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!name && !phone && !gstin) {
      return NextResponse.json({
        success: true,
        duplicates: [],
        warnings: []
      });
    }

    const duplicates: any[] = [];
    const warnings: string[] = [];

    // Normalize inputs first
    const normalizedGstin = gstin ? gstin.trim().toUpperCase() : null;
    const normalizedPhone = phone ? normalizePhone(phone) : null;
    const normalizedName = name ? normalizeBusinessName(name) : null;

    // Build query to find similar suppliers
    let whereConditions: string[] = ['s.business_id = $1', 's.deleted_at IS NULL', 's.is_active = true'];
    const params: any[] = [businessId];
    let paramIndex = 2;

    // Check GSTIN match (highest priority)
    if (normalizedGstin) {
      whereConditions.push(`s.gstin IS NOT NULL AND UPPER(TRIM(s.gstin)) = $${paramIndex}`);
      params.push(normalizedGstin);
      paramIndex++;
    }

    // Check phone match
    if (normalizedPhone && normalizedPhone.length >= 6) {
      whereConditions.push(`REGEXP_REPLACE(s.phone, '[^0-9]', '', 'g') = $${paramIndex}`);
      params.push(normalizedPhone);
      paramIndex++;
    }

    // Check name similarity (using trigram)
    if (normalizedName && normalizedName.length >= 3) {
      whereConditions.push(`SIMILARITY(LOWER(s.name), $${paramIndex}) > 0.6`);
      params.push(normalizedName);
      paramIndex++;
    }

    // If no conditions, return empty
    if (whereConditions.length === 2) {
      return NextResponse.json({
        success: true,
        duplicates: [],
        warnings: []
      });
    }

    // Add normalized name for similarity calculation
    const nameSimilarityParam = paramIndex;
    if (normalizedName) {
      params.push(normalizedName.toLowerCase());
    } else {
      params.push('');
    }
    paramIndex++;

    const query = `
      SELECT 
        s.id,
        s.name,
        s.phone,
        s.gstin,
        s.linked_business_id,
        s.approval_status,
        s.allow_low_stock_access,
        -- Name similarity score (using pg_trgm)
        CASE 
          WHEN $${nameSimilarityParam}::text != '' 
            THEN SIMILARITY(LOWER(s.name), $${nameSimilarityParam}::text)
          ELSE 0
        END as name_similarity
      FROM suppliers s
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY name_similarity DESC
      LIMIT 10
    `;

    const results = await queryRows(query, params);

    // Calculate match confidence in JavaScript
    const resultsWithConfidence = results.map((result: any) => {
      let matchConfidence = 40; // Default
      const nameSim = result.name_similarity || 0;

      // 100%: GSTIN exact match
      if (normalizedGstin && result.gstin) {
        const supplierGstin = result.gstin.trim().toUpperCase();
        if (supplierGstin === normalizedGstin) {
          matchConfidence = 100;
        }
      }

      // 90%: Phone normalized match (only if GSTIN didn't match)
      if (matchConfidence < 100 && normalizedPhone && result.phone) {
        const supplierPhone = normalizePhone(result.phone);
        if (supplierPhone === normalizedPhone) {
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
        ...result,
        match_confidence: matchConfidence
      };
    });

    // Sort by confidence
    resultsWithConfidence.sort((a: any, b: any) => b.match_confidence - a.match_confidence);

    // Format results with warnings
    for (const result of resultsWithConfidence) {
      const matchedFields: string[] = [];
      if (normalizedGstin && result.gstin && 
          normalizedGstin === result.gstin.trim().toUpperCase()) {
        matchedFields.push('GSTIN');
      }
      if (normalizedPhone && result.phone && 
          normalizedPhone === normalizePhone(result.phone)) {
        matchedFields.push('Phone');
      }
      if (result.name_similarity > 0.6) {
        matchedFields.push('Name');
      }

      duplicates.push({
        id: result.id,
        name: result.name,
        phone: result.phone,
        gstin: result.gstin,
        match_confidence: result.match_confidence,
        matched_fields: matchedFields,
        name_similarity: Math.round(result.name_similarity * 100),
        linked_business_id: result.linked_business_id,
        approval_status: result.approval_status,
        allow_low_stock_access: result.allow_low_stock_access
      });

      // Generate warning message
      if (result.match_confidence >= 80) {
        warnings.push(
          `Found similar supplier "${result.name}" with ${result.match_confidence}% match ` +
          `(matched: ${matchedFields.join(', ')})`
        );
      }
    }

    return NextResponse.json({
      success: true,
      duplicates,
      warnings,
      has_duplicates: duplicates.length > 0
    });

  } catch (error: any) {
    console.error('Error checking duplicates:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to check duplicates' },
      { status: 500 }
    );
  }
}
