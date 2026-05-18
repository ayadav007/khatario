/**
 * NOTE:
 * This module is intentionally isolated.
 * Do NOT import CRM, WhatsApp, or campaign logic here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { geocodeLocation, searchNearbyPlaces, getPlaceDetailsBatch } from '@/lib/google-leads/placesClient';
import { normalizeLeads, NormalizedLead } from '@/lib/google-leads/normalizer';
import { deduplicateLeads } from '@/lib/google-leads/dedupe';
import { geocodeLocationOSM, searchPlacesOSM, normalizeOSMLead, OSMNormalizedLead } from '@/lib/google-leads/osmClient';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { keyword, location, radius = 5000, maxResults = 50, useFreeAPI = false } = body;

    // Validate input
    if (!keyword || typeof keyword !== 'string' || keyword.trim().length === 0) {
      return NextResponse.json(
        { error: 'Business keyword is required' },
        { status: 400 }
      );
    }

    if (!location || typeof location !== 'string' || location.trim().length === 0) {
      return NextResponse.json(
        { error: 'Location is required' },
        { status: 400 }
      );
    }

    // Validate radius (1km to 50km)
    const radiusInMeters = typeof radius === 'number' ? Math.max(1000, Math.min(50000, radius)) : 5000;

    // Validate maxResults (1 to 100)
    const maxResultsLimit = typeof maxResults === 'number' ? Math.max(1, Math.min(100, maxResults)) : 50;

    console.log(`[Google Leads] Starting search: keyword="${keyword}", location="${location}", radius=${radiusInMeters}m, maxResults=${maxResultsLimit}, useFreeAPI=${useFreeAPI}`);

    let uniqueLeads: (NormalizedLead | OSMNormalizedLead)[] = [];
    let source = 'google';

    if (useFreeAPI) {
      // Use OpenStreetMap (FREE, no API key required)
      console.log('[Google Leads] Using OpenStreetMap (FREE) API');
      
      try {
        // Step 1: Geocode location
        const coordinates = await geocodeLocationOSM(location);
        console.log(`[Google Leads] Geocoded location: ${coordinates.lat}, ${coordinates.lng}`);
        
        // Step 2: Search places
        const places = await searchPlacesOSM(
          keyword.trim(),
          { lat: coordinates.lat, lng: coordinates.lng },
          radiusInMeters,
          maxResultsLimit
        );
        console.log(`[Google Leads] Found ${places.length} places`);
        
        if (places.length === 0) {
          return NextResponse.json({
            leads: [],
            message: 'No businesses found matching your search criteria.',
            source: 'osm',
          });
        }
        
        // Step 3: Normalize leads
        const normalizedLeads = places.map(normalizeOSMLead);
        
        // Step 4: Deduplicate (using place_id)
        const seen = new Set<string>();
        uniqueLeads = normalizedLeads.filter(lead => {
          if (seen.has(lead.place_id)) return false;
          seen.add(lead.place_id);
          return true;
        });
        
        source = 'osm';
      } catch (error: any) {
        console.error('[Google Leads] OSM API error:', error);
        return NextResponse.json(
          { error: `Failed to search places: ${error.message}` },
          { status: 500 }
        );
      }
    } else {
      // Use Google Places API (requires API key, has free tier)
      console.log('[Google Leads] Using Google Places API');
      
      // Step 1: Geocode location
      let coordinates;
      try {
        coordinates = await geocodeLocation(location);
        console.log(`[Google Leads] Geocoded location: ${coordinates.lat}, ${coordinates.lng}`);
      } catch (error: any) {
        console.error('[Google Leads] Geocoding error:', error);
        return NextResponse.json(
          { error: `Failed to find location: ${error.message}` },
          { status: 400 }
        );
      }

      // Step 2: Search nearby places
      let places;
      try {
        places = await searchNearbyPlaces(
          keyword.trim(),
          { lat: coordinates.lat, lng: coordinates.lng },
          radiusInMeters,
          maxResultsLimit
        );
        console.log(`[Google Leads] Found ${places.length} places`);
      } catch (error: any) {
        console.error('[Google Leads] Places search error:', error);
        return NextResponse.json(
          { error: `Failed to search places: ${error.message}` },
          { status: 500 }
        );
      }

      if (places.length === 0) {
        return NextResponse.json({
          leads: [],
          message: 'No businesses found matching your search criteria.',
          source: 'google',
        });
      }

      // Step 3: Get place details for each place
      const placeIds = places.map(p => p.place_id);
      let placeDetails;
      try {
        console.log(`[Google Leads] Fetching details for ${placeIds.length} places...`);
        // Rate limit: 200ms delay between requests to stay within free tier limits
        // Note: Google Places API charges per request. With $200 free credit:
        // - Place Details: ~11,764 requests/month free
        // - Nearby Search: ~6,250 requests/month free
        placeDetails = await getPlaceDetailsBatch(placeIds, 200); // 200ms delay to be conservative
        console.log(`[Google Leads] Successfully fetched ${placeDetails.length} place details`);
      } catch (error: any) {
        console.error('[Google Leads] Place details error:', error);
        // Return partial results if we got some place details
        if (placeDetails && placeDetails.length > 0) {
          console.log(`[Google Leads] Returning ${placeDetails.length} partial results`);
        } else {
          return NextResponse.json(
            { error: `Failed to fetch place details: ${error.message}` },
            { status: 500 }
          );
        }
      }

      // Step 4: Normalize leads
      const normalizedLeads = normalizeLeads(placeDetails);

      // Step 5: Deduplicate leads
      uniqueLeads = deduplicateLeads(normalizedLeads);
      source = 'google';
    }

    console.log(`[Google Leads] Final results: ${uniqueLeads.length} unique leads after deduplication`);

    return NextResponse.json({
      leads: uniqueLeads,
      totalFound: uniqueLeads.length,
      totalUnique: uniqueLeads.length,
      source,
    });

  } catch (error: any) {
    console.error('[Google Leads] Unexpected error:', error);
    
    // Handle API key errors
    if (error.message && error.message.includes('GOOGLE_PLACES_API_KEY')) {
      return NextResponse.json(
        { error: 'Google Places API key is not configured. Please contact support.' },
        { status: 500 }
      );
    }
    
    return NextResponse.json(
      { error: error.message || 'An unexpected error occurred while searching for leads.' },
      { status: 500 }
    );
  }
}

