/**
 * WhatsApp Policies
 * 
 * PBAC policies for WhatsApp integration operations.
 */

import { Policy } from '../types';
import {
  resourceBelongsToBusiness,
} from '../conditions';

/**
 * Get all WhatsApp policies
 */
export function getWhatsAppPolicies(): Policy[] {
  return [
    // WHATSAPP general policies
    {
      resource: 'whatsapp',
      action: 'read',
      requiresPermission: 'settings.read', // Using settings.read as WhatsApp is typically a settings feature
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'whatsapp',
      action: 'create',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'whatsapp',
      action: 'update',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },

    // WHATSAPP MESSAGE policies
    {
      resource: 'whatsapp_message',
      action: 'read',
      requiresPermission: 'settings.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'whatsapp_message',
      action: 'create',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'whatsapp_message',
      action: 'send',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'whatsapp_messages',
      action: 'read',
      requiresPermission: 'settings.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'whatsapp_messages',
      action: 'create',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },

    // WHATSAPP CONVERSATION policies
    {
      resource: 'whatsapp_conversation',
      action: 'read',
      requiresPermission: 'settings.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'whatsapp_conversations',
      action: 'read',
      requiresPermission: 'settings.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },

    // WHATSAPP CAMPAIGN policies
    {
      resource: 'whatsapp_campaign',
      action: 'read',
      requiresPermission: 'settings.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'whatsapp_campaign',
      action: 'create',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'whatsapp_campaign',
      action: 'update',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'whatsapp_campaigns',
      action: 'read',
      requiresPermission: 'settings.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'whatsapp_campaigns',
      action: 'create',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },

    // WHATSAPP BOT policies
    {
      resource: 'whatsapp_bot',
      action: 'read',
      requiresPermission: 'settings.read',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'whatsapp_bot',
      action: 'create',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
    {
      resource: 'whatsapp_bot',
      action: 'update',
      requiresPermission: 'settings.update',
      priority: 10,
      conditions: [
        resourceBelongsToBusiness(),
      ],
    },
  ];
}
