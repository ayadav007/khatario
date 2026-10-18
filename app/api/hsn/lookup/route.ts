import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { gstRatesForCode } from '@/lib/gst/rate-schedule';

export const dynamic = 'force-dynamic';

interface HSNResult {
  code: string;
  description: string;
  gst_rate: number | null;
  category: string;
  is_service: boolean;
  source?: string;
  rate_condition?: string | null;
}

interface HSNLookupRow {
  code: string;
  description: string;
  category: string;
  is_service: boolean;
  source: string;
  gst_rate: number | null;
  rate_condition: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || ''; // Search query (product name/keywords)
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '10', 10) || 10, 1), 20);
    const searchTerm = query.trim().toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

    if (searchTerm.length < 2) {
      return NextResponse.json({ results: [] });
    }

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
        is_service
      FROM hsn_sac_master
      WHERE
        code ILIKE $1
        OR description ILIKE $2
        OR $3 = ANY(keywords)
        OR to_tsvector('english', description) @@ plainto_tsquery('english', $4)
      ORDER BY
        CASE WHEN code = $5 THEN 0 ELSE 1 END,
        CASE WHEN code ILIKE $1 AND $4 ~ '^[0-9]+$' THEN 0 ELSE 1 END,
        ts_rank(to_tsvector('english', description), plainto_tsquery('english', $4)) DESC,
        CASE WHEN description ILIKE $6 THEN 0 ELSE 1 END,
        length(code) ASC
      LIMIT $7
    `;

    const searchPattern = `%${searchTerm}%`;
    const exactMatch = searchTerm;
    const prefixMatch = `${searchTerm}%`;

    const results = await queryRows<HSNResult>(searchQuery, [
      prefixMatch,
      searchPattern,
      searchTerm,
      searchTerm,
      exactMatch,
      prefixMatch,
      limit,
    ]);

    const withRates = results.flatMap((result): HSNLookupRow[] => {
      const rates = result.is_service ? [] : gstRatesForCode(result.code);
      if (rates.length === 0) {
        return [{ ...result, source: 'database', gst_rate: null, rate_condition: null }];
      }
      return rates.map((rate) => ({
        ...result,
        source: 'database',
        gst_rate: rate.gst_rate,
        rate_condition: rate.description,
      }));
    });

    return NextResponse.json({ results: withRates.slice(0, 15) });
  } catch (error: any) {
    console.error('HSN/SAC Lookup Error:', error);
    return NextResponse.json(
      { error: 'Failed to search HSN/SAC codes', details: error.message },
      { status: 500 }
    );
  }
}

