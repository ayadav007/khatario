import { NextRequest, NextResponse } from 'next/server';
import { query, getPool } from '@/lib/db';
import { getBusinessWorkflowDefaults, applyWorkflowDefaults } from '@/lib/business-workflows';
import { clearSubscriptionCache } from '@/lib/subscription';
import bcrypt from 'bcryptjs';
import { signAccessToken, signRefreshToken, setSessionCookies } from '@/lib/jwt';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { getDefaultTemplateSettings } from '@/lib/template-defaults';
import { notifyAdminsNewSignup, sendWelcomeEmail } from '@/lib/platform-email';

export const dynamic = 'force-dynamic';

// 3 signup attempts per IP per hour (production). Dev + Playwright bypass below.
const SIGNUP_LIMIT = 3;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

// Rate limit is skipped when:
//   1. Explicitly disabled via E2E_DISABLE_RATE_LIMIT=true (Playwright)
//   2. Running in local dev (NODE_ENV !== 'production') — localhost iteration
//      should not get throttled by an anti-abuse control meant for real traffic.
// Production (NODE_ENV='production') always enforces.
function shouldSkipSignupRateLimit(): boolean {
  if (process.env.E2E_DISABLE_RATE_LIMIT === 'true') return true;
  if (process.env.NODE_ENV !== 'production') return true;
  return false;
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (!shouldSkipSignupRateLimit()) {
    const rl = checkRateLimit(`signup:${ip}`, SIGNUP_LIMIT, SIGNUP_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many signup attempts. Please try again later.', retryAfterMs: rl.retryAfterMs },
        { status: 429 }
      );
    }
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    
    const {
      businessName,
      businessEmail,
      businessPhone,
      businessType,
      industry,
      businessModel,
      userName,
      userPhone,
      password,
    } = body;

    if (!businessName || !userName || !userPhone || !password || !businessType || !industry) {
      return NextResponse.json(
        { error: 'Required fields: Business Name, Business Type, Industry, Your Name, Phone, Password' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    const businessRes = await client.query(
      `INSERT INTO businesses (
         name, email, phone, business_type, industry, business_model,
         gst_registration_type
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'unregistered')
       RETURNING id`,
      [
        businessName,
        businessEmail || null,
        businessPhone || null,
        businessType,
        industry,
        businessModel || null,
      ]
    );
    const businessId = businessRes.rows[0].id;

    await client.query(`
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
        ('settings', 'Settings', 'Access business settings', 11, true)
      ON CONFLICT (module_key) DO NOTHING
    `);

    await client.query(`
      SELECT create_default_roles_for_business($1)
    `, [businessId]);
    
    const roleResult = await client.query(`
      SELECT id FROM user_roles 
      WHERE business_id = $1 AND role_key = 'primary_admin'
      LIMIT 1
    `, [businessId]);
    
    if (!roleResult.rows || roleResult.rows.length === 0) {
      throw new Error('Failed to create Primary Admin role');
    }
    
    const primaryAdminRoleId = roleResult.rows[0].id;
    
    if (!primaryAdminRoleId) {
      throw new Error('Primary Admin role ID is null');
    }

    const defaultBranchResult = await client.query(`
      INSERT INTO branches (
        business_id, 
        name, 
        branch_code,
        branch_type, 
        is_default, 
        is_primary,
        is_active
      )
      VALUES ($1, 'Main Branch', 'MAIN', 'retail', true, true, true)
      RETURNING id
    `, [businessId]);

    if (!defaultBranchResult.rows || defaultBranchResult.rows.length === 0) {
      throw new Error('Failed to create default branch');
    }

    const defaultBranchId = defaultBranchResult.rows[0].id;

    const passwordHash = await bcrypt.hash(password, 10);
    const userRes = await client.query(
      `INSERT INTO users (business_id, name, phone, password_hash, role_id, is_primary_admin) 
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id`,
      [businessId, userName, userPhone, passwordHash, primaryAdminRoleId]
    );
    const primaryAdminUserId = userRes.rows[0].id;

    try {
      await client.query(`
        INSERT INTO user_branches (user_id, branch_id, can_view, can_edit, can_delete, can_create_transactions)
        VALUES ($1, $2, true, true, true, true)
        ON CONFLICT (user_id, branch_id) DO NOTHING
      `, [primaryAdminUserId, defaultBranchId]);
    } catch (error: any) {
      if (error.code === '42703' || error.message?.includes('can_create_transactions')) {
        await client.query(`
          INSERT INTO user_branches (user_id, branch_id, can_view, can_edit, can_delete)
          VALUES ($1, $2, true, true, true)
          ON CONFLICT (user_id, branch_id) DO NOTHING
        `, [primaryAdminUserId, defaultBranchId]);
      } else {
        throw error;
      }
    }

    const businessData = {
      business_type: businessType,
      industry: industry,
      business_model: businessModel
    };
    const workflowDefaults = getBusinessWorkflowDefaults(businessData);
    const workflowSettings = applyWorkflowDefaults(businessId, workflowDefaults);
    
    const productVariantsEnabled = workflowSettings.product_variants_enabled || 
                                    industry === 'textiles' || 
                                    industry === 'garments';
    
    await client.query(`
      INSERT INTO business_settings (business_id, user_management_enabled, product_variants_enabled)
      VALUES ($1, false, $2)
      ON CONFLICT (business_id) DO NOTHING
    `, [businessId, productVariantsEnabled]);

    // Activate GST Standard for tax invoices with full field defaults so PDF/preview use DB settings (no silent fallback).
    try {
      const gstStandardSettings = getDefaultTemplateSettings('gst_standard');
      await client.query(
        `INSERT INTO business_template_assignments (business_id, document_type, template_id, settings)
         VALUES ($1::uuid, 'tax_invoice', 'gst_standard', $2::jsonb)
         ON CONFLICT (business_id, document_type) DO UPDATE SET
           template_id = EXCLUDED.template_id,
           settings = EXCLUDED.settings,
           updated_at = CURRENT_TIMESTAMP`,
        [businessId, JSON.stringify(gstStandardSettings)]
      );
    } catch (templateSeedError: unknown) {
      console.error('Signup: failed to seed default tax_invoice template assignment:', templateSeedError);
    }
    
    try {
      await client.query(`SELECT create_default_chart_of_accounts($1)`, [businessId]);
    } catch (coaError: any) {
      console.error('Error creating default Chart of Accounts:', coaError);
    }
    
    if (workflowDefaults.invoice_prefix || workflowDefaults.default_tax_rate) {
      const updates: string[] = [];
      const values: any[] = [];
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
        await client.query(`
          UPDATE businesses 
          SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
          WHERE id = $${paramIndex}
        `, values);
      }
    }

    const trialPlan = await client.query(`
      SELECT id, name, display_name FROM subscription_plans WHERE id = 'trial' AND is_active = true
    `);

    const freePlan = await client.query(`
      SELECT id, name, display_name FROM subscription_plans WHERE id = 'free' AND is_active = true
    `);

    if (freePlan.rows.length === 0) {
      console.error('CRITICAL: Default subscription plan (id: "free") not found or inactive.');
      throw new Error('System configuration error: Default subscription plan not found. Please contact support.');
    }

    const useTrialPlan = trialPlan.rows.length > 0;
    const initialPlanId = useTrialPlan ? trialPlan.rows[0].id : freePlan.rows[0].id;
    const initialStatus = useTrialPlan ? 'trial' : 'active';

    if (!useTrialPlan) {
      console.warn(
        'SIGNUP: subscription plan "trial" not found — new business assigned to "free" without trial. Run migration 154_add_trial_subscription_plan.sql.'
      );
    }

    const existingSubscription = await client.query(`
      SELECT id, plan_id, status FROM business_subscriptions WHERE business_id = $1
    `, [businessId]);

    if (existingSubscription.rows.length > 0) {
      await client.query(
        `
        UPDATE business_subscriptions
        SET plan_id = $1,
            status = $2,
            start_date = CURRENT_DATE,
            trial_end_date = CASE WHEN $2::text = 'trial' THEN CURRENT_DATE + INTERVAL '30 days' ELSE NULL END,
            updated_at = CURRENT_TIMESTAMP
        WHERE business_id = $3
        `,
        [initialPlanId, initialStatus, businessId]
      );

      clearSubscriptionCache(businessId);
    } else {
      const insertResult = useTrialPlan
        ? await client.query(
            `
            INSERT INTO business_subscriptions (business_id, plan_id, status, start_date, trial_end_date)
            VALUES ($1, $2, 'trial', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days')
            RETURNING id, plan_id, status
            `,
            [businessId, initialPlanId]
          )
        : await client.query(
            `
            INSERT INTO business_subscriptions (business_id, plan_id, status, start_date, trial_end_date)
            VALUES ($1, $2, 'active', CURRENT_DATE, NULL)
            RETURNING id, plan_id, status
            `,
            [businessId, initialPlanId]
          );

      if (!insertResult.rows || insertResult.rows.length === 0) {
        throw new Error('Failed to create subscription: INSERT returned no rows');
      }

      clearSubscriptionCache(businessId);
    }

    await client.query('COMMIT');
    clearSubscriptionCache(businessId);

    const tokenPayload = { userId: primaryAdminUserId, businessId, sessionVersion: 1 };
    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(tokenPayload),
      signRefreshToken(tokenPayload),
    ]);

    const response = NextResponse.json({ 
      success: true, 
      message: 'Account created successfully',
      businessId,
      userId: primaryAdminUserId,
    }, { status: 201 });

    setSessionCookies(response, accessToken, refreshToken);

    const planLabel = useTrialPlan
      ? (trialPlan.rows[0].display_name || 'Trial')
      : (freePlan.rows[0].display_name || 'Free');

    void (async () => {
      try {
        if (businessEmail?.trim()) {
          await sendWelcomeEmail({
            businessId,
            businessName,
            recipientEmail: businessEmail.trim(),
            userName,
            trialDays: useTrialPlan ? 30 : undefined,
          });
        }
        await notifyAdminsNewSignup({
          businessId,
          businessName,
          businessEmail: businessEmail?.trim() || null,
          userName,
          userPhone,
          planLabel,
        });
      } catch (emailErr) {
        console.error('Signup notification emails failed:', emailErr);
      }
    })();

    return response;

  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Signup error:', error);
    
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'Phone number or email already registered' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
