import { NextRequest, NextResponse } from 'next/server';
import { checkGstin } from '@/lib/tax/gstin';
import { fetchGstinRegistry } from '@/lib/gstin-registry';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gstin = searchParams.get('gstin');

    if (!gstin || gstin.length !== 15) {
      return NextResponse.json({ error: 'Invalid GSTIN format. Must be 15 characters.' }, { status: 400 });
    }

    const check = checkGstin(gstin);
    if (!check.valid) {
      return NextResponse.json({ error: check.error, code: check.code }, { status: 400 });
    }

    const found = await fetchGstinRegistry(check.gstin);
    const gstData: any = found?.record ?? null;
    const apiSource = found?.source ?? '';

    // If all APIs fail, return basic info
    if (!gstData) {
      const stateCode = gstin.substring(0, 2);
      return NextResponse.json({
        gstin,
        state_code: stateCode,
        message: 'GSTIN APIs unavailable. Only state code extracted from GSTIN structure.',
        api_configured: false
      });
    }

    // Extract relevant information from API response
    console.log('Using API:', apiSource);
    console.log('GST Data:', JSON.stringify(gstData, null, 2));
    
    // Parse address if available
    let address = '';
    let city = '';
    let state = '';
    let pincode = '';
    
    if (gstData.pradr && gstData.pradr.addr) {
      const addr = gstData.pradr.addr;
      address = [addr.bno, addr.bnm, addr.flno, addr.st, addr.loc]
        .filter(Boolean)
        .join(', ');
      city = addr.dst || '';
      pincode = addr.pncd || '';
    }

    // Get state from state code
    const stateCode = gstin.substring(0, 2);
    const states: Record<string, string> = {
      '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh',
      '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
      '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
      '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
      '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
      '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
      '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
      '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
      '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu',
      '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
      '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
      '35': 'Andaman and Nicobar Islands', '36': 'Telangana',
      '37': 'Andhra Pradesh', '38': 'Ladakh'
    };

    state = gstData.pradr?.addr?.stcd || states[stateCode] || '';

    const result = {
      gstin: gstData.gstin || gstin,
      legal_name: gstData.lgnm || gstData.tradeNam || gstData.legal_name || '',
      trade_name: gstData.tradeNam || gstData.trade_name || '',
      address,
      city,
      state,
      state_code: stateCode,
      pincode,
      status: gstData.sts || gstData.status || 'Active',
      registration_date: gstData.rgdt || gstData.registration_date || '',
      taxpayer_type: gstData.dty || gstData.taxpayer_type || '',
      api_configured: true,
      api_source: apiSource
    };

    console.log('Final Result:', JSON.stringify(result, null, 2));
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('GSTIN Lookup Error:', error);
    
    // Fallback: Extract state code from GSTIN
    const gstin = new URL(request.url).searchParams.get('gstin');
    if (gstin && gstin.length === 15) {
      const stateCode = gstin.substring(0, 2);
      return NextResponse.json({
        gstin,
        state_code: stateCode,
        message: 'GSTIN API error. Only state code extracted.',
        api_configured: false,
        error: error.message
      });
    }

    return NextResponse.json(
      { error: 'Failed to fetch GSTIN details', details: error.message },
      { status: 500 }
    );
  }
}

