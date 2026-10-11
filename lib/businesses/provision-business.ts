import type { PoolClient } from 'pg';
import type { Business } from '@/types/database';
import { getBusinessWorkflowDefaults, applyWorkflowDefaults } from '@/lib/business-workflows';
import { getDefaultTemplateSettings } from '@/lib/template-defaults';
import { getSignupPlanConfig, normalizeProductLine, type ProductLine } from '@/lib/product-lines';
import { productLineToModule } from '@/lib/platform-modules';
import { seedInitialBusinessModules } from '@/lib/business-modules';
import { seedInitialModuleSubscription } from '@/lib/subscription/module-subscriptions';
import { ensureComplimentaryHrForBilling } from '@/lib/subscription/ensure-complimentary-hr';
import { applyIndustryCoa } from '@/lib/accounting/apply-industry-coa';

type PgClient = Pick<PoolClient, 'query'>;

async function withSavepoint(
  client: PgClient,
  name: string,
  fn: () => Promise<void>,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  await client.query(`SAVEPOINT ${name}`);
  try {
    await fn();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return { ok: true };
  } catch (error) {
    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    } catch (rollbackErr) {
      console.error(`Business setup: failed to rollback savepoint ${name}:`, rollbackErr);
    }
    return { ok: false, error };
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export type ProvisionBusinessInput = {
  businessName: string;
  businessEmail?: string | null;
  businessPhone?: string | null;
  businessType: string;
  industry: string;
  businessModel?: string | null;
  productLine: ProductLine;
};

export type ProvisionBusinessResult = {
  businessId: string;
  defaultBranchId: string;
  primaryAdminRoleId: string;
  softFailures: string[];
  planLabel: string;
  trialDays: number | null;
};

/**
 * Empty company: books, roles, main branch, chart of accounts, and its own trial.
 * Does not create a login. Caller attaches the existing user.
 */
export async function provisionBusiness(
  client: PgClient,
  input: ProvisionBusinessInput,
): Promise<ProvisionBusinessResult> {
  const productLine = normalizeProductLine(input.productLine);
  const signupPlan = getSignupPlanConfig(productLine);
  const softFailures: string[] = [];

  const businessRes = await client.query(
    `INSERT INTO businesses (
       name, email, phone, business_type, industry, business_model,
       gst_registration_type, product_line, primary_module
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'unregistered', $7, $8)
     RETURNING id`,
    [
      input.businessName,
      input.businessEmail || null,
      input.businessPhone || null,
      input.businessType,
      input.industry,
      input.businessModel || null,
      productLine,
      productLineToModule(productLine),
    ],
  );
  const businessId = businessRes.rows[0].id as string;

  await seedInitialBusinessModules(client, businessId, productLine);

  await client.query(
    `
      INSERT INTO permission_modules (module_key, module_name, description, display_order, is_active)
      VALUES
        ('dashboard', 'Dashboard', 'View dashboard and analytics', 1, true),
        ('invoices', 'Sales / Invoices', 'Manage sales invoices', 2, true),
        ('credit_notes', 'Credit Notes', 'Manage credit notes (sales returns)', 3, true),
        ('customers', 'Customers', 'Manage customer information', 4, true),
        ('purchases', 'Purchases', 'Manage purchase bills', 5, true),
        ('purchase_returns', 'Purchase Returns', 'Manage purchase returns', 6, true),
        ('suppliers', 'Suppliers', 'Manage supplier information', 7, true),
        ('items', 'Items & Inventory', 'Manage items and stock', 8, true),
        ('payments', 'Payments', 'Manage payments (in/out)', 9, true),
        ('reports', 'Reports', 'View and export reports', 10, true),
        ('settings', 'Settings', 'Access business settings', 11, true),
        ('warehouses', 'Warehouses', 'Warehouse and inventory management', 12, true),
        ('employees', 'Employees', 'Employee records and profiles', 13, true),
        ('attendance', 'Attendance', 'Attendance tracking and roll call', 14, true),
        ('leaves', 'Leaves', 'Leave balances and policies', 15, true),
        ('leave_requests', 'Leave Requests', 'Leave applications and approvals', 16, true),
        ('payroll', 'Payroll', 'Salary payments and payslips', 17, true),
        ('recruitment', 'Recruitment', 'Jobs, candidates, interviews, and offers', 18, true),
        ('commissions', 'Commissions', 'Employee commissions and incentives', 19, true)
      ON CONFLICT (module_key) DO NOTHING
    `,
  );

  await client.query(`SELECT create_default_roles_for_business($1)`, [businessId]);

  const roleResult = await client.query(
    `SELECT id FROM user_roles WHERE business_id = $1 AND role_key = 'primary_admin' LIMIT 1`,
    [businessId],
  );
  const primaryAdminRoleId = roleResult.rows[0]?.id as string | undefined;
  if (!primaryAdminRoleId) {
    throw new Error('Failed to create Primary Admin role');
  }

  const defaultBranchResult = await client.query(
    `INSERT INTO branches (
       business_id, name, branch_code, branch_type, is_default, is_primary, is_active
     )
     VALUES ($1, 'Main Branch', 'MAIN', 'retail', true, true, true)
     RETURNING id`,
    [businessId],
  );
  const defaultBranchId = defaultBranchResult.rows[0]?.id as string | undefined;
  if (!defaultBranchId) {
    throw new Error('Failed to create default branch');
  }

  const workflowDefaults = getBusinessWorkflowDefaults({
    business_type: input.businessType,
    industry: input.industry,
  } as Partial<Business>);
  const workflowSettings = applyWorkflowDefaults(businessId, workflowDefaults);
  const productVariantsEnabled =
    workflowSettings.product_variants_enabled || input.industry === 'textiles' || input.industry === 'garments';

  await client.query(
    `INSERT INTO business_settings (business_id, user_management_enabled, product_variants_enabled)
     VALUES ($1, false, $2)
     ON CONFLICT (business_id) DO NOTHING`,
    [businessId, productVariantsEnabled],
  );

  if (productLine === 'billing') {
    const tpl = await withSavepoint(client, 'sp_tax_invoice_template', async () => {
      const gstStandardSettings = getDefaultTemplateSettings('gst_standard');
      await client.query(
        `INSERT INTO business_template_assignments (business_id, document_type, template_id, settings)
         VALUES ($1::uuid, 'tax_invoice', 'gst_standard', $2::jsonb)
         ON CONFLICT (business_id, document_type) DO UPDATE SET
           template_id = EXCLUDED.template_id,
           settings = EXCLUDED.settings,
           updated_at = CURRENT_TIMESTAMP`,
        [businessId, JSON.stringify(gstStandardSettings)],
      );
    });
    if (!tpl.ok) {
      softFailures.push(`tax_invoice_template: ${errorMessage(tpl.error)}`);
      console.error('Business setup: failed to seed default tax_invoice template assignment:', tpl.error);
    }
  }

  {
    const coa = await withSavepoint(client, 'sp_coa', async () => {
      await client.query(`SELECT create_default_chart_of_accounts($1)`, [businessId]);
    });
    if (!coa.ok) {
      softFailures.push(`chart_of_accounts: ${errorMessage(coa.error)}`);
      console.error('Error creating default Chart of Accounts:', coa.error);
    } else {
      const heads = await withSavepoint(client, 'sp_coa_heads', async () => {
        const fn = await client.query(`SELECT to_regproc('ensure_standard_account_heads') IS NOT NULL AS ok`);
        if (fn.rows[0]?.ok) {
          await client.query(`SELECT ensure_standard_account_heads($1)`, [businessId]);
        }
        const ecl = await client.query(`SELECT to_regproc('ensure_gst_electronic_cash_ledger') IS NOT NULL AS ok`);
        if (ecl.rows[0]?.ok) {
          await client.query(`SELECT ensure_gst_electronic_cash_ledger($1)`, [businessId]);
        }
      });
      if (!heads.ok) softFailures.push(`standard_account_heads: ${errorMessage(heads.error)}`);
      const industryCoa = await withSavepoint(client, 'sp_coa_industry', async () => {
        await applyIndustryCoa(client as PoolClient, businessId);
      });
      if (!industryCoa.ok) softFailures.push(`industry_chart_of_accounts: ${errorMessage(industryCoa.error)}`);
    }
  }

  if (workflowDefaults.invoice_prefix || workflowDefaults.default_tax_rate) {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;
    if (workflowDefaults.invoice_prefix) {
      updates.push(`invoice_prefix = $${paramIndex++}`);
      values.push(workflowDefaults.invoice_prefix);
    }
    if (workflowDefaults.default_tax_rate) {
      updates.push(`default_tax_rate = $${paramIndex++}`);
      values.push(workflowDefaults.default_tax_rate);
    }
    if (updates.length > 0) {
      values.push(businessId);
      await client.query(
        `UPDATE businesses SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex}`,
        values,
      );
    }
  }

  const targetPlan = await client.query(
    `SELECT id, name, display_name FROM subscription_plans WHERE id = $1 AND is_active = true`,
    [signupPlan.planId],
  );
  const freePlan = await client.query(
    `SELECT id, name, display_name FROM subscription_plans WHERE id = $1 AND is_active = true`,
    [signupPlan.postTrialPlanId],
  );
  if (targetPlan.rows.length === 0) {
    console.error(`CRITICAL: Signup plan "${signupPlan.planId}" not found for product line "${productLine}".`);
    if (freePlan.rows.length === 0) {
      throw new Error('System configuration error: Default subscription plan not found. Please contact support.');
    }
  }
  const useConfiguredPlan = targetPlan.rows.length > 0;
  const initialPlanId = useConfiguredPlan ? targetPlan.rows[0].id : freePlan.rows[0].id;
  const initialStatus = signupPlan.status;
  if (!useConfiguredPlan) {
    console.warn(
      `SIGNUP: plan "${signupPlan.planId}" not found — falling back to "${signupPlan.postTrialPlanId}". Run migration 253_product_lines_and_module_plans.sql.`,
    );
  }

  await seedInitialModuleSubscription(
    client,
    businessId,
    productLine,
    initialPlanId,
    initialStatus,
    signupPlan.trialDays,
  );

  if (productLine === 'billing') {
    await ensureComplimentaryHrForBilling(businessId, client);
  }

  const assignedPlanRow = useConfiguredPlan ? targetPlan.rows[0] : freePlan.rows[0];
  return {
    businessId,
    defaultBranchId,
    primaryAdminRoleId,
    softFailures,
    planLabel: assignedPlanRow?.display_name || signupPlan.planId,
    trialDays: signupPlan.trialDays,
  };
}
