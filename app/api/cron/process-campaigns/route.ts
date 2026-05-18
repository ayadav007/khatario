import { NextRequest, NextResponse } from 'next/server';
import { processAllCampaigns } from '@/lib/campaign-processor';

/**
 * GET/POST /api/cron/process-campaigns
 * Background job endpoint to process all running WhatsApp campaigns
 * Can be called via external cron service (e.g., cron-job.org) or internal scheduler
 * 
 * Recommended: Call every 10-30 seconds when campaigns are running
 */
export async function GET(request: NextRequest) {
  return await processCampaigns();
}

export async function POST(request: NextRequest) {
  return await processCampaigns();
}

async function processCampaigns() {
  try {
    // Optional: Add authentication header check for security
    // const authHeader = request.headers.get('authorization');
    // if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // }

    const result = await processAllCampaigns();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result
    });

  } catch (error: any) {
    console.error('Error processing campaigns:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

