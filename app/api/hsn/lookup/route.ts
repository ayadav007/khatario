import { NextRequest, NextResponse } from 'next/server';
import { gstRatesForCode } from '@/lib/gst/rate-schedule';
import { searchHsnCatalog } from '@/lib/gst/hsn-catalog';

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

    const results: HSNResult[] = searchHsnCatalog(searchTerm, limit).map((row) => ({
      code: row.code,
      description: row.description,
      gst_rate: null,
      category: row.isService ? 'Services' : '',
      is_service: row.isService,
    }));

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

