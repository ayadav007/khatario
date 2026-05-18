/**
 * Backdate Controls
 * Functions to validate and control backdated entries
 */

import { queryOne } from './db';

export interface BackdateValidationResult {
  isBackdated: boolean;
  daysBackdated: number;
  requiresApproval: boolean;
  maxBackdateDays: number;
  error?: string;
}

/**
 * Validate backdated entry
 * @param entryDate - Date of the entry
 * @param maxBackdateDays - Maximum days allowed for backdating (default: 365)
 * @param approvalRequiredDays - Days after which approval is required (default: 30)
 */
export function validateBackdate(
  entryDate: Date | string,
  maxBackdateDays: number = 365,
  approvalRequiredDays: number = 30
): BackdateValidationResult {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const entry = typeof entryDate === 'string' ? new Date(entryDate) : entryDate;
  entry.setHours(0, 0, 0, 0);
  
  const daysDiff = Math.floor((today.getTime() - entry.getTime()) / (1000 * 60 * 60 * 24));
  
  const isBackdated = daysDiff > 0;
  const requiresApproval = isBackdated && daysDiff > approvalRequiredDays;
  
  if (isBackdated && daysDiff > maxBackdateDays) {
    return {
      isBackdated: true,
      daysBackdated: daysDiff,
      requiresApproval: true,
      maxBackdateDays,
      error: `Entry date is ${daysDiff} days in the past. Maximum allowed: ${maxBackdateDays} days.`
    };
  }
  
  return {
    isBackdated,
    daysBackdated: daysDiff,
    requiresApproval,
    maxBackdateDays
  };
}

/**
 * Check if user has permission to approve backdated entries
 */
export async function hasBackdateApprovalPermission(
  userId: string,
  daysBackdated: number
): Promise<boolean> {
  try {
    // Get user permissions
    const user = await queryOne<{ is_primary_admin: boolean; role_id: string | null }>(`
      SELECT is_primary_admin, role_id FROM users WHERE id = $1
    `, [userId]);
    
    if (!user) {
      return false;
    }
    
    // NOTE: Primary admin must have backdate approval permission assigned via role_permissions
    // No hardcoded bypass - check role permissions
    
    // Check role permissions using OLD system (module_key + flags)
    if (user.role_id) {
      // For backdated entries, check if role has modify permission on settings/accounting module
      // This is a simplified check - in future, add specific 'approve_backdated_entries' permission
      const permission = await queryOne<{ can_modify: boolean }>(`
        SELECT can_modify
        FROM role_permissions
        WHERE role_id = $1
          AND module_key IN ('settings', 'accounting', 'reports')
          AND can_modify = true
        LIMIT 1
      `, [user.role_id]);
      
      if (permission?.can_modify) {
        return true;
      }
    }
    
    // For entries > 90 days, require higher level approval (check for modify on settings)
    if (daysBackdated > 90) {
      const highLevelPermission = await queryOne<{ can_modify: boolean }>(`
        SELECT can_modify
        FROM role_permissions
        WHERE role_id = $1
          AND module_key = 'settings'
          AND can_modify = true
      `, [user.role_id || '']);
      
      return highLevelPermission?.can_modify || false;
    }
    
    return false;
  } catch (error) {
    console.error('Error checking backdate approval permission:', error);
    return false;
  }
}
