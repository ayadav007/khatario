/**
 * NOTE:
 * This module is intentionally isolated.
 * Do NOT import CRM, WhatsApp, or campaign logic here.
 */

/**
 * Google Places API Client
 * Handles all interactions with Google Places API
 */

interface GeocodeResult {
  lat: number;
  lng: number;
  formatted_address: string;
}

interface PlaceResult {
  place_id: string;
  name: string;
  formatted_address: string;
  geometry: {
    location: {
      lat: number;
      lng: number;
    };
  };
  rating?: number;
  user_ratings_total?: number;
  formatted_phone_number?: string;
  website?: string;
  international_phone_number?: string;
}

export interface PlaceDetailsResult {
  place_id: string;
  name: string;
  formatted_address: string;
  formatted_phone_number?: string;
  international_phone_number?: string;
  website?: string;
  rating?: number;
  user_ratings_total?: number;
  url: string; // Google Maps URL
}

/**
 * Get Google Places API key from environment
 */
function getApiKey(): string {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not configured. Please add it to your .env.local file.');
  }
  return apiKey;
}

/**
 * Geocode location string to coordinates
 */
export async function geocodeLocation(location: string): Promise<GeocodeResult> {
  const apiKey = getApiKey();
  const encodedLocation = encodeURIComponent(location);
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedLocation}&key=${apiKey}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Geocoding API error: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.status === 'ZERO_RESULTS') {
      throw new Error(`No results found for location: ${location}`);
    }
    
    if (data.status !== 'OK') {
      throw new Error(`Geocoding API error: ${data.status} - ${data.error_message || 'Unknown error'}`);
    }
    
    if (!data.results || data.results.length === 0) {
      throw new Error(`No results found for location: ${location}`);
    }
    
    const result = data.results[0];
    return {
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formatted_address: result.formatted_address,
    };
  } catch (error: any) {
    if (error.message.includes('GOOGLE_PLACES_API_KEY')) {
      throw error;
    }
    throw new Error(`Failed to geocode location: ${error.message}`);
  }
}

/**
 * Search for nearby places using Google Places Nearby Search API
 */
export async function searchNearbyPlaces(
  keyword: string,
  location: { lat: number; lng: number },
  radius: number,
  maxResults: number = 20
): Promise<PlaceResult[]> {
  const apiKey = getApiKey();
  const results: PlaceResult[] = [];
  let nextPageToken: string | undefined;
  
  try {
    do {
      let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?` +
        `location=${location.lat},${location.lng}` +
        `&radius=${radius}` +
        `&keyword=${encodeURIComponent(keyword)}` +
        `&key=${apiKey}`;
      
      if (nextPageToken) {
        url += `&pagetoken=${nextPageToken}`;
        // Wait for token to become valid (Google requirement)
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Places API error: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.status === 'ZERO_RESULTS') {
        break;
      }
      
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        if (data.status === 'OVER_QUERY_LIMIT') {
          throw new Error('Google Places API quota exceeded. Please try again later.');
        }
        throw new Error(`Places API error: ${data.status} - ${data.error_message || 'Unknown error'}`);
      }
      
      if (data.results && Array.isArray(data.results)) {
        results.push(...data.results);
      }
      
      nextPageToken = data.next_page_token;
      
      // Limit total results
      if (results.length >= maxResults) {
        break;
      }
      
    } while (nextPageToken && results.length < maxResults);
    
    return results.slice(0, maxResults);
  } catch (error: any) {
    if (error.message.includes('GOOGLE_PLACES_API_KEY')) {
      throw error;
    }
    throw new Error(`Failed to search nearby places: ${error.message}`);
  }
}

/**
 * Get detailed information for a place using Place Details API
 */
export async function getPlaceDetails(placeId: string): Promise<PlaceDetailsResult> {
  const apiKey = getApiKey();
  const url = `https://maps.googleapis.com/maps/api/place/details/json?` +
    `place_id=${placeId}` +
    `&fields=place_id,name,formatted_address,formatted_phone_number,international_phone_number,website,rating,user_ratings_total,url` +
    `&key=${apiKey}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Place Details API error: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.status !== 'OK') {
      if (data.status === 'OVER_QUERY_LIMIT') {
        throw new Error('Google Places API quota exceeded. Please try again later.');
      }
      throw new Error(`Place Details API error: ${data.status} - ${data.error_message || 'Unknown error'}`);
    }
    
    if (!data.result) {
      throw new Error('No result found for place ID');
    }
    
    return {
      place_id: data.result.place_id,
      name: data.result.name,
      formatted_address: data.result.formatted_address || '',
      formatted_phone_number: data.result.formatted_phone_number,
      international_phone_number: data.result.international_phone_number,
      website: data.result.website,
      rating: data.result.rating,
      user_ratings_total: data.result.user_ratings_total,
      url: data.result.url || `https://www.google.com/maps/place/?q=place_id:${placeId}`,
    };
  } catch (error: any) {
    if (error.message.includes('GOOGLE_PLACES_API_KEY')) {
      throw error;
    }
    throw new Error(`Failed to get place details: ${error.message}`);
  }
}

/**
 * Get place details for multiple places (with rate limiting)
 */
export async function getPlaceDetailsBatch(
  placeIds: string[],
  delayBetweenRequests: number = 100
): Promise<PlaceDetailsResult[]> {
  const results: PlaceDetailsResult[] = [];
  
  for (let i = 0; i < placeIds.length; i++) {
    try {
      const details = await getPlaceDetails(placeIds[i]);
      results.push(details);
      
      // Rate limit: wait between requests
      if (i < placeIds.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
      }
    } catch (error: any) {
      console.error(`Error fetching details for place ${placeIds[i]}:`, error.message);
      // Continue with other places even if one fails
    }
  }
  
  return results;
}

