/**
 * NOTE:
 * This module is intentionally isolated.
 * Do NOT import CRM, WhatsApp, or campaign logic here.
 * 
 * OpenStreetMap Nominatim API - FREE alternative to Google Places API
 * Limitations: Limited business data (no phone, ratings, reviews in most cases)
 */

interface OSMGeocodeResult {
  lat: number;
  lng: number;
  display_name: string;
}

interface OSMPlaceResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  type: string;
  address?: {
    house_number?: string;
    road?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
  extratags?: {
    phone?: string;
    website?: string;
    email?: string;
  };
}

export interface OSMNormalizedLead {
  business_name: string;
  phone: string | null;
  website: string | null;
  address: string;
  rating: number | null;
  reviews: number | null;
  maps_url: string;
  place_id: string;
  source: 'osm';
}

/**
 * Geocode location using Nominatim (free, no API key required)
 * Rate limit: 1 request per second (please respect this!)
 */
export async function geocodeLocationOSM(location: string): Promise<OSMGeocodeResult> {
  const encodedLocation = encodeURIComponent(location);
  const url = `https://nominatim.openstreetmap.org/search?q=${encodedLocation}&format=json&limit=1`;
  
  try {
    // Respect rate limit: 1 request per second
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Khatario Lead Extractor (Contact: support@example.com)', // Required by Nominatim
      },
    });
    
    if (!response.ok) {
      throw new Error(`Geocoding error: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data || data.length === 0) {
      throw new Error(`No results found for location: ${location}`);
    }
    
    const result = data[0];
    return {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      display_name: result.display_name,
    };
  } catch (error: any) {
    throw new Error(`Failed to geocode location: ${error.message}`);
  }
}

/**
 * Search for places using Nominatim (free)
 * Note: This searches by name/keyword, not "nearby search" like Google
 * Rate limit: 1 request per second
 */
export async function searchPlacesOSM(
  keyword: string,
  location: { lat: number; lng: number },
  radius: number,
  maxResults: number = 20
): Promise<OSMPlaceResult[]> {
  // Nominatim doesn't have a true "nearby search" like Google
  // We'll search by keyword in the general area
  const encodedKeyword = encodeURIComponent(keyword);
  const url = `https://nominatim.openstreetmap.org/search?` +
    `q=${encodedKeyword}` +
    `&format=json` +
    `&limit=${Math.min(maxResults, 50)}` +
    `&bounded=1` +
    `&viewbox=${location.lng - 0.1},${location.lat + 0.1},${location.lng + 0.1},${location.lat - 0.1}` +
    `&addressdetails=1` +
    `&extratags=1`;
  
  try {
    // Respect rate limit: 1 request per second
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Khatario Lead Extractor (Contact: support@example.com)', // Required by Nominatim
      },
    });
    
    if (!response.ok) {
      throw new Error(`Places search error: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data || data.length === 0) {
      return [];
    }
    
    return data.slice(0, maxResults);
  } catch (error: any) {
    throw new Error(`Failed to search places: ${error.message}`);
  }
}

/**
 * Normalize OSM place result to our lead format
 */
export function normalizeOSMLead(place: OSMPlaceResult): OSMNormalizedLead {
  // Build address from address components
  const addressParts: string[] = [];
  if (place.address) {
    if (place.address.house_number) addressParts.push(place.address.house_number);
    if (place.address.road) addressParts.push(place.address.road);
    if (place.address.city) addressParts.push(place.address.city);
    if (place.address.state) addressParts.push(place.address.state);
    if (place.address.postcode) addressParts.push(place.address.postcode);
  }
  const address = addressParts.length > 0 ? addressParts.join(', ') : place.display_name;
  
  // Extract phone/website from extratags
  const phone = place.extratags?.phone || null;
  const website = place.extratags?.website || null;
  
  // Build Google Maps URL (OSM doesn't provide this directly)
  const mapsUrl = `https://www.google.com/maps?q=${place.lat},${place.lon}`;
  
  // Extract business name (use display_name, fallback to first part)
  const businessName = place.display_name.split(',')[0] || 'Unknown Business';
  
  return {
    business_name: businessName,
    phone,
    website: website ? extractDomain(website) : null,
    address,
    rating: null, // OSM doesn't have ratings
    reviews: null, // OSM doesn't have reviews
    maps_url: mapsUrl,
    place_id: place.place_id.toString(),
    source: 'osm',
  };
}

/**
 * Extract domain from website URL
 */
function extractDomain(website: string): string | null {
  if (!website) return null;
  
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`);
    return url.hostname.replace('www.', '');
  } catch {
    const cleaned = website.replace(/^https?:\/\//, '').replace(/^www\./, '');
    return cleaned.split('/')[0] || null;
  }
}

