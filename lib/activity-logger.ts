/**
 * Activity Logger
 * Centralized logging for all user actions
 */

import { query } from '@/lib/db';

export interface ActivityLogData {
  business_id: string;
  employee_id?: string;
  user_id?: string;
  action_type: string;
  module: string;
  entity_id?: string;
  entity_type?: string;
  description: string;
  ip_address?: string;
  user_agent?: string;
  metadata?: Record<string, any>;
}

/**
 * Log an activity
 */
export async function logActivity(data: ActivityLogData): Promise<void> {
  try {
    await query(
      `INSERT INTO activity_logs (
        business_id, employee_id, user_id, action_type, module,
        entity_id, entity_type, description, ip_address, user_agent, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        data.business_id,
        data.employee_id || null,
        data.user_id || null,
        data.action_type,
        data.module,
        data.entity_id || null,
        data.entity_type || null,
        data.description,
        data.ip_address || null,
        data.user_agent || null,
        JSON.stringify(data.metadata || {}),
      ]
    );
  } catch (error) {
    // Don't throw - logging should never break the main flow
    console.error('Error logging activity:', error);
  }
}

/**
 * Get client IP from request
 */
export function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  return forwarded?.split(',')[0] || realIP || 'unknown';
}

/**
 * Get user agent from request
 */
export function getUserAgent(request: Request): string {
  return request.headers.get('user-agent') || 'unknown';
}

