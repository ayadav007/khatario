/**
 * NOTE:
 * This module is intentionally isolated.
 * Do NOT import CRM, WhatsApp, or campaign logic here.
 */

/**
 * Deduplication Utility
 * Removes duplicate leads based on place_id, phone number, or website domain
 */

import { NormalizedLead } from './normalizer';

/**
 * Deduplicate leads by place_id (primary deduplication)
 */
function dedupeByPlaceId(leads: NormalizedLead[]): NormalizedLead[] {
  const seen = new Set<string>();
  const unique: NormalizedLead[] = [];
  
  for (const lead of leads) {
    if (!seen.has(lead.place_id)) {
      seen.add(lead.place_id);
      unique.push(lead);
    }
  }
  
  return unique;
}

/**
 * Deduplicate leads by phone number (secondary deduplication)
 */
function dedupeByPhone(leads: NormalizedLead[]): NormalizedLead[] {
  const seen = new Set<string>();
  const unique: NormalizedLead[] = [];
  
  for (const lead of leads) {
    if (!lead.phone) {
      // If no phone, keep the lead
      unique.push(lead);
      continue;
    }
    
    // Normalize phone for comparison (remove all non-digits except +)
    const normalizedPhone = lead.phone.replace(/[^\d+]/g, '');
    
    if (!seen.has(normalizedPhone)) {
      seen.add(normalizedPhone);
      unique.push(lead);
    }
  }
  
  return unique;
}

/**
 * Deduplicate leads by website domain (tertiary deduplication)
 */
function dedupeByWebsite(leads: NormalizedLead[]): NormalizedLead[] {
  const seen = new Set<string>();
  const unique: NormalizedLead[] = [];
  
  for (const lead of leads) {
    if (!lead.website) {
      // If no website, keep the lead
      unique.push(lead);
      continue;
    }
    
    // Normalize domain for comparison (lowercase, remove www)
    const normalizedDomain = lead.website.toLowerCase().replace(/^www\./, '');
    
    if (!seen.has(normalizedDomain)) {
      seen.add(normalizedDomain);
      unique.push(lead);
    }
  }
  
  return unique;
}

/**
 * Deduplicate leads using all methods in sequence
 * Priority: place_id > phone > website
 */
export function deduplicateLeads(leads: NormalizedLead[]): NormalizedLead[] {
  // First dedupe by place_id (most reliable)
  let unique = dedupeByPlaceId(leads);
  
  // Then dedupe by phone (keep first occurrence)
  unique = dedupeByPhone(unique);
  
  // Finally dedupe by website (keep first occurrence)
  unique = dedupeByWebsite(unique);
  
  return unique;
}

