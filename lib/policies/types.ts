/**
 * Policy-Based Access Control (PBAC) Types
 * 
 * PBAC wraps RBAC and adds context-based business rules.
 * RBAC checks happen FIRST, then policy evaluation.
 */

/**
 * Policy condition evaluator function
 * Returns true if condition passes, false otherwise
 */
export type ConditionEvaluator = (
  user: PolicyUser,
  resource: any,
  context: PolicyContext
) => Promise<boolean> | boolean;

/**
 * Policy condition definition
 */
export interface PolicyCondition {
  /** Unique identifier for the condition */
  id: string;
  /** Human-readable description */
  description: string;
  /** Function that evaluates the condition */
  evaluate: ConditionEvaluator;
  /** Error message if condition fails */
  errorMessage: string;
  /** Error code if condition fails */
  errorCode: string;
}

/**
 * Policy definition
 */
export interface Policy {
  /** Resource type (e.g., 'invoice', 'purchase') */
  resource: string;
  /** Action (e.g., 'read', 'create', 'update', 'delete', 'finalize') */
  action: string;
  /** Required RBAC permission (must pass before policy evaluation) */
  requiresPermission: string;
  /** Conditions that must all pass */
  conditions: PolicyCondition[];
  /** Priority (higher number = evaluated first; e.g. 20 bootstrap before 10 normal) */
  priority?: number;
}

/**
 * User context for policy evaluation
 */
export interface PolicyUser {
  id: string;
  business_id: string;
  role_id?: string;
  branch_ids?: string[];
  warehouse_ids?: string[];
  [key: string]: any;
}

/**
 * Resource context for policy evaluation
 */
export interface PolicyResource {
  id?: string;
  business_id?: string;
  branch_id?: string;
  warehouse_id?: string;
  status?: string;
  [key: string]: any;
}

/**
 * Policy evaluation context
 */
export interface PolicyContext {
  resource?: PolicyResource;
  businessId?: string;
  branchId?: string;
  warehouseId?: string;
  [key: string]: any;
}

/**
 * Policy evaluation result
 */
export interface PolicyEvaluationResult {
  /** Whether all conditions passed */
  allowed: boolean;
  /** First failed condition (if any) */
  failedCondition?: PolicyCondition;
  /** Error message if denied */
  errorMessage?: string;
  /** Error code if denied */
  errorCode?: string;
}
