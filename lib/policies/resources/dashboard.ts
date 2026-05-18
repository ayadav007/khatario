/**
 * Dashboard Policies
 * 
 * PBAC policies for dashboard access.
 * Dashboard is a read-only resource that displays aggregated business data.
 */

import { Policy } from '../types';
import {
  resourceBelongsToBusiness,
} from '../conditions';

/**
 * Get all Dashboard policies
 */
export function getDashboardPolicies(): Policy[] {
  return [
    // Dashboard read policy - allows viewing dashboard if user has dashboard.read permission
    {
      resource: 'dashboard',
      action: 'read',
      requiresPermission: 'dashboard.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
  ];
}
