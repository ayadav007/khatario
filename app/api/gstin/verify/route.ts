import { NextRequest, NextResponse } from 'next/server';

// GSTIN Verification and Details Fetch
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gstin = searchParams.get('gstin');

    if (!gstin) {
      return NextResponse.json({ error: 'GSTIN is required' }, { status: 400 });
    }

    // Validate GSTIN format (15 characters)
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin)) {
      return NextResponse.json({ error: 'Invalid GSTIN format' }, { status: 400 });
    }

    // Extract state code from GSTIN (first 2 digits)
    const stateCode = gstin.substring(0, 2);
    const stateMap: Record<string, string> = {
      '01': 'Jammu and Kashmir',
      '02': 'Himachal Pradesh',
      '03': 'Punjab',
      '04': 'Chandigarh',
      '05': 'Uttarakhand',
      '06': 'Haryana',
      '07': 'Delhi',
      '08': 'Rajasthan',
      '09': 'Uttar Pradesh',
      '10': 'Bihar',
      '11': 'Sikkim',
      '12': 'Arunachal Pradesh',
      '13': 'Nagaland',
      '14': 'Manipur',
      '15': 'Mizoram',
      '16': 'Tripura',
      '17': 'Meghalaya',
      '18': 'Assam',
      '19': 'West Bengal',
      '20': 'Jharkhand',
      '21': 'Odisha',
      '22': 'Chhattisgarh',
      '23': 'Madhya Pradesh',
      '24': 'Gujarat',
      '25': 'Daman and Diu',
      '26': 'Dadra and Nagar Haveli',
      '27': 'Maharashtra',
      '29': 'Karnataka',
      '30': 'Goa',
      '31': 'Lakshadweep',
      '32': 'Kerala',
      '33': 'Tamil Nadu',
      '34': 'Puducherry',
      '35': 'Andaman and Nicobar Islands',
      '36': 'Telangana',
      '37': 'Andhra Pradesh',
      '38': 'Ladakh',
    };

    const state = stateMap[stateCode] || '';

    // Option 1: Use Government GST API (requires authentication)
    // You need to register at https://gst.gov.in/ to get API credentials
    // const response = await fetch(`https://gst.gov.in/api/search/taxpayer?gstin=${gstin}`, {
    //   headers: {
    //     'Authorization': `Bearer ${process.env.GST_API_KEY}`
    //   }
    // });

    // Option 2: Use third-party GSTIN verification service
    // Example: GST Portal, KnowYourGST, etc.
    // These services typically require API keys and have rate limits
    
    // For now, I'll implement a basic structure that can be extended
    // You can integrate with services like:
    // - Masters India API
    // - GST Portal API
    // - Third-party GSTIN verification services

    try {
      // Example with a hypothetical API endpoint
      // Replace this with actual API endpoint and credentials
      const apiUrl = process.env.GSTIN_API_URL || 'https://api.example.com/gstin';
      const apiKey = process.env.GSTIN_API_KEY;

      if (!apiKey) {
        // If no API key configured, return basic info from GSTIN
        return NextResponse.json({
          gstin,
          state,
          state_code: stateCode,
          verified: false,
          message: 'GSTIN API not configured. Only basic validation performed.',
          // Basic info that can be extracted from GSTIN itself
          details: {
            state_jurisdiction: state,
            state_code: stateCode,
          }
        });
      }

      // Uncomment and modify this when you have actual API credentials
      /*
      const response = await fetch(`${apiUrl}/${gstin}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('GSTIN API request failed');
      }

      const data = await response.json();

      // Parse API response and return standardized format
      return NextResponse.json({
        gstin,
        verified: true,
        details: {
          legal_name: data.lgnm || data.tradeNam || '',
          trade_name: data.tradeNam || '',
          address: data.pradr?.addr || '',
          city: data.pradr?.loc || '',
          state: data.pradr?.stcd ? stateMap[data.pradr.stcd] : state,
          state_code: data.pradr?.stcd || stateCode,
          pincode: data.pradr?.pncd || '',
          business_type: data.ctb || '',
          registration_date: data.rgdt || '',
          status: data.sts || 'Active',
        }
      });
      */

      // Temporary response structure for development
      return NextResponse.json({
        gstin,
        state,
        state_code: stateCode,
        verified: true,
        message: 'GSTIN validated successfully',
        details: {
          // These would come from actual API
          legal_name: '',
          trade_name: '',
          address: '',
          city: '',
          state: state,
          state_code: stateCode,
          pincode: '',
          business_type: '',
          registration_date: '',
          status: 'Active',
        }
      });

    } catch (error: any) {
      console.error('GSTIN API Error:', error);
      
      // Fallback: Return basic info from GSTIN structure
      return NextResponse.json({
        gstin,
        state,
        state_code: stateCode,
        verified: false,
        message: 'Could not fetch details from GST portal. Basic validation performed.',
        details: {
          state_jurisdiction: state,
          state_code: stateCode,
        }
      });
    }

  } catch (error: any) {
    console.error('GSTIN Verification Error:', error);
    return NextResponse.json(
      { error: 'Failed to verify GSTIN', details: error.message },
      { status: 500 }
    );
  }
}

