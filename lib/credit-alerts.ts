/**
 * Credit Alerts System (Phase 5.4 & 5.5)
 * 
 * Sends WhatsApp alerts for critical credit events with duplicate prevention.
 * Feature-gated: Only sends if {@link FeatureKeys.WHATSAPP_CREDIT_ALERTS} is enabled.
 */

import * as db from '@/lib/db';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { hasFeature } from '@/lib/subscription';
import { calculateCreditMetrics, calculateProjectedCreditMetrics, CreditMetrics } from '@/lib/credit-utils';
import { FeatureKeys } from '@/lib/featureKeys';

/**
 * Check if alert should be sent for a threshold crossing
 * Returns true if alert should be sent (not sent recently for this threshold)
 */
async function shouldSendAlert(
  businessId: string,
  entityType: 'customer' | 'supplier',
  entityId: string,
  threshold: 70 | 90 | 100
): Promise<boolean> {
  try {
    // Check if alert was sent recently (within last 24 hours) for this threshold
    const recentAlert = await db.queryOne(
      `SELECT id FROM credit_alerts_log
       WHERE business_id = $1 
         AND entity_type = $2 
         AND entity_id = $3 
         AND threshold = $4
         AND last_alert_sent_at > NOW() - INTERVAL '24 hours'`,
      [businessId, entityType, entityId, threshold]
    );

    return !recentAlert; // Send if no recent alert
  } catch (error) {
    console.error('Error checking alert log:', error);
    return false; // Don't send on error
  }
}

/**
 * Log that an alert was sent
 */
async function logAlertSent(
  businessId: string,
  entityType: 'customer' | 'supplier',
  entityId: string,
  threshold: 70 | 90 | 100
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO credit_alerts_log (
        business_id, entity_type, entity_id, threshold, last_alert_sent_at
      ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (business_id, entity_type, entity_id, threshold)
      DO UPDATE SET last_alert_sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
      [businessId, entityType, entityId, threshold]
    );
  } catch (error) {
    console.error('Error logging alert:', error);
    // Don't throw - logging failure shouldn't break the flow
  }
}

/**
 * Get business admin and finance users for credit alerts
 */
async function getCreditAlertRecipients(businessId: string): Promise<Array<{ phone: string; name: string }>> {
  try {
    // Get users with admin/finance permissions (invoices or purchases finalize permission)
    const users = await db.queryRows(`
      SELECT DISTINCT u.id, u.name, u.phone
      FROM users u
      LEFT JOIN user_roles ur ON u.role_id = ur.id
      LEFT JOIN role_permissions rp ON ur.id = rp.role_id
      WHERE u.business_id = $1
        AND u.is_active = true
        AND (
          u.is_primary_admin = true
          OR rp.module_key IN ('invoices', 'purchases')
          OR ur.role_key IN ('primary_admin', 'admin', 'accountant', 'finance')
        )
        AND u.phone IS NOT NULL
        AND u.phone != ''
    `, [businessId]);

    return users.map((u: any) => ({
      phone: u.phone,
      name: u.name || 'User'
    }));
  } catch (error) {
    console.error('Error fetching credit alert recipients:', error);
    return [];
  }
}

/**
 * Send WhatsApp credit alert
 */
async function sendCreditAlert(
  businessId: string,
  entityType: 'customer' | 'supplier',
  entityId: string,
  entityName: string,
  metrics: CreditMetrics,
  threshold: 70 | 90 | 100,
  referenceType?: 'invoice' | 'purchase',
  referenceId?: string
): Promise<void> {
  try {
    // PHASE 5.5: Feature gating
    const hasFeatureAccess = await hasFeature(businessId, FeatureKeys.WHATSAPP_CREDIT_ALERTS);
    if (!hasFeatureAccess) {
      console.log(`[Credit Alerts] WhatsApp credit alerts disabled for business ${businessId}`);
      return; // Skip silently if feature not enabled
    }

    // Get recipients
    const recipients = await getCreditAlertRecipients(businessId);
    if (recipients.length === 0) {
      console.log(`[Credit Alerts] No recipients found for business ${businessId}`);
      return;
    }

    // Build alert message
    const partyLabel = entityType === 'customer' ? 'Customer' : 'Supplier';
    const balanceLabel = entityType === 'customer' ? 'Receivable' : 'Payable';
    const utilization = metrics.credit_utilization_percent?.toFixed(1) || 'N/A';
    
    let message = `🚨 *Credit Alert: ${partyLabel} ${entityName}*\n\n`;
    message += `Credit utilization: *${utilization}%*\n`;
    message += `Credit limit: ₹${metrics.credit_limit.toLocaleString('en-IN')}\n`;
    message += `Current ${balanceLabel.toLowerCase()}: ₹${metrics.current_balance.toLocaleString('en-IN')}\n`;
    
    if (threshold === 90) {
      message += `\n⚠️ *CRITICAL*: Credit utilization has crossed 90% threshold.`;
    } else if (threshold === 100) {
      message += `\n🔴 *OVER LIMIT*: Credit limit has been exceeded.`;
    }
    
    if (referenceType && referenceId) {
      message += `\n\nReference: ${referenceType === 'invoice' ? 'Invoice' : 'Purchase'} ${referenceId}`;
    }
    
    message += `\n\nPlease review and take necessary action.`;

    // Send to all recipients
    for (const recipient of recipients) {
      try {
        await sendWhatsAppMessage(
          businessId,
          recipient.phone,
          message
        );

        // Log to whatsapp_messages table
        await db.query(
          `INSERT INTO whatsapp_messages (
            business_id, to_number, message_type, reference_type, reference_id,
            message_text, status
          ) VALUES ($1, $2, $3, $4, $5, $6, 'sent')`,
          [
            businessId,
            recipient.phone,
            'credit_alert',
            referenceType || entityType,
            referenceId || entityId,
            message
          ]
        );
      } catch (error: any) {
        console.error(`[Credit Alerts] Failed to send to ${recipient.phone}:`, error);
        
        // Log failure
        await db.query(
          `INSERT INTO whatsapp_messages (
            business_id, to_number, message_type, reference_type, reference_id,
            message_text, status, error_message
          ) VALUES ($1, $2, $3, $4, $5, $6, 'failed', $7)`,
          [
            businessId,
            recipient.phone,
            'credit_alert',
            referenceType || entityType,
            referenceId || entityId,
            message,
            error.message || 'Unknown error'
          ]
        );
      }
    }

    // Log alert sent
    await logAlertSent(businessId, entityType, entityId, threshold);
  } catch (error) {
    console.error('[Credit Alerts] Error sending credit alert:', error);
    // Don't throw - alert failure shouldn't break the flow
  }
}

/**
 * Check and send credit alerts for a party
 * Called from invoice/purchase create/edit APIs and approval workflows
 */
export async function checkAndSendCreditAlerts(
  businessId: string,
  entityType: 'customer' | 'supplier',
  entityId: string,
  creditLimit: number | string | null,
  currentBalance: number | string | null,
  projectedMetrics?: CreditMetrics,
  referenceType?: 'invoice' | 'purchase',
  referenceId?: string
): Promise<void> {
  try {
    // Get entity name
    const entityTable = entityType === 'customer' ? 'customers' : 'suppliers';
    const entity = await db.queryOne<{ name: string }>(
      `SELECT name FROM ${entityTable} WHERE id = $1 AND business_id = $2`,
      [entityId, businessId]
    );

    if (!entity) {
      return; // Entity not found, skip
    }

    // Use projected metrics if provided, otherwise calculate current
    const metrics = projectedMetrics || calculateCreditMetrics(creditLimit, currentBalance);

    // Skip if unlimited credit
    if (metrics.credit_status === 'UNLIMITED' || metrics.credit_utilization_percent === null) {
      return;
    }

    const utilization = metrics.credit_utilization_percent;

    // Check thresholds and send alerts
    // Alert at 90% (critical) and 100% (over limit)
    if (utilization >= 100) {
      // Over limit - check if alert should be sent
      const shouldSend = await shouldSendAlert(businessId, entityType, entityId, 100);
      if (shouldSend) {
        await sendCreditAlert(
          businessId,
          entityType,
          entityId,
          entity.name,
          metrics,
          100,
          referenceType,
          referenceId
        );
      }
    } else if (utilization >= 90) {
      // Critical (90-100%) - check if alert should be sent
      const shouldSend = await shouldSendAlert(businessId, entityType, entityId, 90);
      if (shouldSend) {
        await sendCreditAlert(
          businessId,
          entityType,
          entityId,
          entity.name,
          metrics,
          90,
          referenceType,
          referenceId
        );
      }
    }
    // Note: 70% threshold is for warnings only, not alerts
  } catch (error) {
    console.error('[Credit Alerts] Error checking credit alerts:', error);
    // Don't throw - alert failure shouldn't break the flow
  }
}
