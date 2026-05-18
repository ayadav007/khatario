import { NextRequest, NextResponse } from 'next/server';
import { testEmailConfig } from '@/lib/email';

/**
 * GET /api/email/test
 * Test email configuration
 */
export async function GET(request: NextRequest) {
  try {
    const result = await testEmailConfig();
    
    return NextResponse.json(result, {
      status: result.success ? 200 : 500,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}

