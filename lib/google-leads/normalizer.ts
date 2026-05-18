/**
 * NOTE:
 * This module is intentionally isolated.
 * Do NOT import CRM, WhatsApp, or campaign logic here.
 */

/**
 * Data Normalizer
 * Normalizes Google Places API responses to our lead format
 */

import { PlaceDetailsResult } from './placesClient';

export interface NormalizedLead {
  business_name: string;
  phone: string | null;
  website: string | null;
  address: string;
  rating: number | null;
  reviews: number | null;
  maps_url: string;
  place_id: string;
}

/**
 * Normalize phone number to consistent format
 */
function normalizePhone(phone: string | undefined): string | null {
  if (!phone) return null;
  
  // Remove all non-digit characters except +
  let cleaned = phone.replace(/[^\d+]/g, '');
  
  // If it starts with +, keep it; otherwise assume it's a local number
  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  
  // If it's 10 digits, assume Indian number and add +91
  if (cleaned.length === 10) {
    return `+91${cleaned}`;
  }
  
  // Otherwise return as-is
  return cleaned || null;
}

/**
 * Extract domain from website URL
 */
function extractDomain(website: string | undefined): string | null {
  if (!website) return null;
  
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`);
    return url.hostname.replace('www.', '');
  } catch {
    // If URL parsing fails, try to extract domain manually
    const cleaned = website.replace(/^https?:\/\//, '').replace(/^www\./, '');
    return cleaned.split('/')[0] || null;
  }
}

/**
 * Normalize a place details result to our lead format
 */
export function normalizeLead(placeDetails: PlaceDetailsResult): NormalizedLead {
  // Use international_phone_number if available, otherwise formatted_phone_number
  const phone = normalizePhone(
    placeDetails.international_phone_number || placeDetails.formatted_phone_number
  );
  
  // Extract website domain for deduplication
  const website = placeDetails.website ? extractDomain(placeDetails.website) : null;
  
  return {
    business_name: placeDetails.name || 'Unknown Business',
    phone,
    website,
    address: placeDetails.formatted_address || '',
    rating: placeDetails.rating ?? null,
    reviews: placeDetails.user_ratings_total ?? null,
    maps_url: placeDetails.url,
    place_id: placeDetails.place_id,
  };
}

/**
 * Normalize multiple place details to leads
 */
export function normalizeLeads(placeDetailsArray: PlaceDetailsResult[]): NormalizedLead[] {
  return placeDetailsArray.map(normalizeLead);
}

