/**
 * Tools Policies
 * 
 * PBAC policies for tools and utility operations (imports, exports, utilities).
 */

import { Policy } from '../types';
import {
  resourceBelongsToBusiness,
  businessHasZeroRoles,
} from '../conditions';

/**
 * Get all Tools policies
 */
export function getToolsPolicies(): Policy[] {
  return [
    // TOOLS general policies
    {
      resource: 'tools',
      action: 'read',
      requiresPermission: 'settings.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'tools',
      action: 'create',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'tools',
      action: 'update',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'tools',
      action: 'export',
      requiresPermission: 'settings.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'tools',
      action: 'import',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },

    // SETTINGS policies (often grouped with tools)
    {
      resource: 'settings',
      action: 'read',
      requiresPermission: 'settings.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    // Settings.create with bootstrap mode: Allow if business has zero roles
    // Bootstrap policy (priority 20) - only applies when business has zero roles
    {
      resource: 'settings',
      action: 'create',
      requiresPermission: 'settings.create', // Permission name (will be bypassed in bootstrap mode)
      priority: 20,
      conditions: [
        resourceBelongsToBusiness(),
        businessHasZeroRoles(), // Bootstrap: only allow if business has zero roles
      ],
    },
    // Normal settings.create policy (priority 10) - requires permission after bootstrap
    {
      resource: 'settings',
      action: 'create',
      requiresPermission: 'settings.create',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
        // No bootstrap condition - normal permission check applies
      ],
    },
    {
      resource: 'settings',
      action: 'update',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'settings',
      action: 'export',
      requiresPermission: 'settings.export',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
  ];
}
