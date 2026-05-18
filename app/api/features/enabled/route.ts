import { NextRequest, NextResponse } from 'next/server';
import { getAllFeatureAccessForBusiness } from '@/lib/subscription/feature-access';
import * as db from '@/lib/db';

/**
 * GET /api/features/enabled
 * 
 * Returns enabled features for a business, grouped by category.
 * Used by frontend to render dynamic sidebar and route access.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Get enabled feature IDs (bulk Set from plan matrix — coalesced per businessId in-flight)
    let enabledFeatureIds: string[] = [];
    try {
      const enabledSet = await getAllFeatureAccessForBusiness(businessId);
      enabledFeatureIds = Array.from(enabledSet);
      console.log('[Features API] Enabled features for business:', {
        businessId,
        enabledCount: enabledFeatureIds.length,
        enabledIds: enabledFeatureIds
      });
    } catch (error: any) {
      console.error('[Features API] Error in getAllFeatureAccessForBusiness:', error);
      console.error('[Features API] Error stack:', error.stack);
      // If getEnabledFeatures fails, return empty array but still try to fetch features
      // This allows the UI to show all features (with locks) even if enabled list fails
      enabledFeatureIds = [];
    }

    // Try to fetch ALL features from Feature Registry (enabled and disabled)
    // This allows the sidebar to show locks for disabled features
    try {
      const features = await db.query(
        `SELECT 
          id,
          category,
          label,
          description,
          icon_name,
          route_path,
          sort_order,
          is_addon
        FROM platform_features
        WHERE is_active = true
        ORDER BY category, sort_order`
      );

      // Source is always 'registry' - Feature Registry is the only source of truth
      // JSONB fallback has been removed in migration 137
      const actualSource = 'registry';

      // Create a Set for fast lookup of enabled features
      const enabledSet = new Set(enabledFeatureIds);

      // Group by category and include enabled status
      const grouped = features.rows.reduce((acc: any, feature: any) => {
        if (!acc[feature.category]) {
          acc[feature.category] = [];
        }
        acc[feature.category].push({
          id: feature.id,
          label: feature.label,
          description: feature.description,
          icon_name: feature.icon_name,
          route_path: feature.route_path,
          sort_order: feature.sort_order,
          is_addon: feature.is_addon,
          enabled: enabledSet.has(feature.id) // Include enabled status
        });
        return acc;
      }, {});

      return NextResponse.json({
        features: grouped,
        enabledIds: enabledFeatureIds,
        source: actualSource
      });
    } catch (error) {
      // Feature Registry is mandatory - this is a critical error
      console.error('Feature Registry is not accessible:', error);
      return NextResponse.json(
        { 
          error: 'Feature Registry is not accessible. This indicates a database schema issue.',
          details: error instanceof Error ? error.message : String(error)
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Error fetching enabled features:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch enabled features' },
      { status: 500 }
    );
  }
}
