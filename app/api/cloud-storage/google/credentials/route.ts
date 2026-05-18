import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { encrypt, decrypt } from '@/lib/cloud-storage';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/**
 * GET /api/cloud-storage/google/credentials
 * Get Google Drive credentials for a business (without secrets)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Enforce feature access
    try {
      await assertFeatureAccess(businessId, 'settings_backup');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get credentials (without returning secrets)
    const connection = await db.queryOne(`
      SELECT 
        id,
        provider,
        client_id_encrypted,
        redirect_uri,
        is_active,
        provider_user_email,
        created_at,
        updated_at
      FROM cloud_storage_connections
      WHERE business_id = $1 AND provider = 'google_drive'
    `, [businessId]);

    if (!connection) {
      return NextResponse.json({
        success: true,
        configured: false,
        message: 'No Google Drive credentials configured',
      });
    }

    // Return masked client ID (show last 4 characters only)
    const clientId = connection.client_id_encrypted ? 
      decrypt(connection.client_id_encrypted) : null;
    
    return NextResponse.json({
      success: true,
      configured: true,
      credentials: {
        client_id_masked: clientId ? `****${clientId.slice(-4)}` : null,
        redirect_uri: connection.redirect_uri,
        is_active: connection.is_active,
        connected_email: connection.provider_user_email,
      },
    });

  } catch (error: any) {
    console.error('Error fetching Google credentials:', error);
    return NextResponse.json(
      { error: 'Failed to fetch credentials', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cloud-storage/google/credentials
 * Save Google Drive OAuth credentials for a business
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, user_id, client_id, client_secret, redirect_uri } = body;

    if (!business_id || !client_id || !client_secret || !redirect_uri) {
      return NextResponse.json(
        { error: 'business_id, client_id, client_secret, and redirect_uri are required' },
        { status: 400 }
      );
    }

    // Validate redirect URI format
    try {
      new URL(redirect_uri);
    } catch (e) {
      return NextResponse.json(
        { error: 'Invalid redirect_uri format. Must be a valid URL.' },
        { status: 400 }
      );
    }

    // Enforce feature access
    try {
      await assertFeatureAccess(business_id, 'settings_backup');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Encrypt credentials
    const clientIdEncrypted = encrypt(client_id);
    const clientSecretEncrypted = encrypt(client_secret);

    // Save or update credentials (don't activate yet, just store)
    await db.query(`
      INSERT INTO cloud_storage_connections (
        business_id, user_id, provider, 
        client_id_encrypted, client_secret_encrypted, redirect_uri,
        is_active
      )
      VALUES ($1, $2, 'google_drive', $3, $4, $5, false)
      ON CONFLICT (business_id, provider)
      DO UPDATE SET
        client_id_encrypted = EXCLUDED.client_id_encrypted,
        client_secret_encrypted = EXCLUDED.client_secret_encrypted,
        redirect_uri = EXCLUDED.redirect_uri,
        updated_at = NOW()
    `, [business_id, user_id, clientIdEncrypted, clientSecretEncrypted, redirect_uri]);

    return NextResponse.json({
      success: true,
      message: 'Google Drive credentials saved successfully. You can now connect.',
    });

  } catch (error: any) {
    console.error('Error saving Google credentials:', error);
    return NextResponse.json(
      { error: 'Failed to save credentials', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/cloud-storage/google/credentials
 * Delete Google Drive credentials
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Enforce feature access
    try {
      await assertFeatureAccess(businessId, 'settings_backup');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Delete credentials and connection
    await db.query(`
      DELETE FROM cloud_storage_connections
      WHERE business_id = $1 AND provider = 'google_drive'
    `, [businessId]);

    return NextResponse.json({
      success: true,
      message: 'Google Drive credentials deleted successfully',
    });

  } catch (error: any) {
    console.error('Error deleting Google credentials:', error);
    return NextResponse.json(
      { error: 'Failed to delete credentials', details: error.message },
      { status: 500 }
    );
  }
}
