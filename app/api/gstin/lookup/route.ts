import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gstin = searchParams.get('gstin');

    if (!gstin || gstin.length !== 15) {
      return NextResponse.json({ error: 'Invalid GSTIN format. Must be 15 characters.' }, { status: 400 });
    }

    // Validate GSTIN format
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    if (!gstinRegex.test(gstin)) {
      return NextResponse.json({ error: 'Invalid GSTIN format' }, { status: 400 });
    }

    // Try multiple APIs in sequence
    let gstData = null;
    let apiSource = '';

    // API 1: GSTINCHECK.CO.IN (Free, unlimited, most reliable)
    try {
      const response1 = await fetch(
        `https://sheet.gstincheck.co.in/check/${gstin}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (response1.ok) {
        const data1 = await response1.json();
        console.log('GSTINCHECK Response:', JSON.stringify(data1, null, 2));
        
        if (data1.flag && data1.data) {
          // Transform to our format
          gstData = {
            gstin: data1.data.gstin,
            lgnm: data1.data.lgnm || data1.data.tradeNam,
            tradeNam: data1.data.tradeNam,
            sts: data1.data.sts,
            rgdt: data1.data.rgdt,
            dty: data1.data.dty,
            pradr: {
              addr: {
                bno: data1.data.pradr?.addr?.bno,
                bnm: data1.data.pradr?.addr?.bnm,
                flno: data1.data.pradr?.addr?.flno,
                st: data1.data.pradr?.addr?.st,
                loc: data1.data.pradr?.addr?.loc,
                dst: data1.data.pradr?.addr?.dst,
                pncd: data1.data.pradr?.addr?.pncd,
                stcd: data1.data.pradr?.addr?.stcd
              }
            }
          };
          apiSource = 'GSTINCHECK';
        }
      }
    } catch (e) {
      console.log('GSTINCHECK API failed:', e);
    }

    // API 2: Masters India (if GSTINCHECK fails)
    if (!gstData) {
      try {
        const response2 = await fetch(
          `https://commonapi.mastersindia.co/commonapis/searchgstin?gstin=${gstin}`,
          {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          }
        );

        if (response2.ok) {
          const data2 = await response2.json();
          console.log('Masters India Response:', JSON.stringify(data2, null, 2));
          
          if (data2.data && !data2.error) {
            gstData = data2.data;
            apiSource = 'Masters India';
          }
        }
      } catch (e) {
        console.log('Masters India API failed:', e);
      }
    }

    // API 3: GST.in (last resort)
    if (!gstData) {
      try {
        const response3 = await fetch(
          `https://gst.nic.in/commonapi/search?action=TP&gstin=${gstin}`,
          {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          }
        );

        if (response3.ok) {
          const data3 = await response3.json();
          console.log('GST.IN Response:', JSON.stringify(data3, null, 2));
          
          if (data3 && !data3.error) {
            gstData = data3;
            apiSource = 'GST.IN';
          }
        }
      } catch (e) {
        console.log('GST.IN API failed:', e);
      }
    }

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

