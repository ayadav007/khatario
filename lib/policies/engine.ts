/**
 * Policy Engine
 * 
 * Evaluates policies against user, resource, and context.
 * Simple boolean evaluation with clear error messages.
 */

import { Policy, PolicyUser, PolicyContext, PolicyEvaluationResult } from './types';

/**
 * Evaluate a policy against user, resource, and context
 * 
 * @param policy - Policy to evaluate
 * @param user - User context
 * @param context - Evaluation context (includes resource if available)
 * @returns Evaluation result
 */
export async function evaluatePolicy(
  policy: Policy,
  user: PolicyUser,
  context: PolicyContext
): Promise<PolicyEvaluationResult> {
  // If no conditions, policy passes (but RBAC must have passed first)
  if (!policy.conditions || policy.conditions.length === 0) {
    return {
      allowed: true,
    };
  }

  // Evaluate all conditions
  for (const condition of policy.conditions) {
    try {
      const result = await condition.evaluate(user, context.resource || {}, context);
      
      if (!result) {
        // Condition failed
        return {
          allowed: false,
          failedCondition: condition,
          errorMessage: condition.errorMessage,
          errorCode: condition.errorCode,
        };
      }
    } catch (error: any) {
      // Error evaluating condition - default to deny
      return {
        allowed: false,
        failedCondition: condition,
        errorMessage: condition.errorMessage || `Policy condition '${condition.id}' failed: ${error.message}`,
        errorCode: condition.errorCode || 'POLICY_CONDITION_ERROR',
      };
    }
  }

  // All conditions passed
  return {
    allowed: true,
  };
}

/**
 * Get policies for a resource and action
 * 
 * @param resource - Resource type (e.g., 'invoice')
 * @param action - Action (e.g., 'read', 'create', 'update')
 * @returns Array of applicable policies
 */
export function getPoliciesForAction(
  resource: string,
  action: string
): Policy[] {
  // Import policy registry
  const { getPolicyRegistry } = require('./registry');
  const registry = getPolicyRegistry();
  
  return registry.getPolicies(resource, action);
}
