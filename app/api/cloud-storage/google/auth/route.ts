import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { decrypt } from '@/lib/cloud-storage';

/**
 * GET /api/cloud-storage/google/auth
 * Initiate Google Drive OAuth flow using business-specific credentials
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

    // Get business-specific credentials
    const connection = await db.queryOne(`
      SELECT client_id_encrypted, redirect_uri
      FROM cloud_storage_connections
      WHERE business_id = $1 AND provider = 'google_drive'
    `, [businessId]);

    // Check for business-specific credentials first
    let clientId: string;
    let redirectUri: string;

    if (connection && connection.client_id_encrypted && connection.redirect_uri) {
      // Use business-specific credentials
      clientId = decrypt(connection.client_id_encrypted);
      redirectUri = connection.redirect_uri;
    } else {
      // Fallback to environment variables (for backward compatibility)
      clientId = process.env.GOOGLE_CLIENT_ID || '';
      redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL}/api/cloud-storage/google/callback`;
    }

    if (!clientId) {
      return NextResponse.json(
        { 
          error: 'Google Drive not configured',
          message: 'Please configure your Google Drive credentials first in the Backup settings.',
          needs_configuration: true
        },
        { status: 400 }
      );
    }

    // Build OAuth URL
    const scopes = [
      'https://www.googleapis.com/auth/drive.file', // Access to files created by the app
      'https://www.googleapis.com/auth/drive.appdata', // Access to app data folder
    ];

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.append('client_id', clientId);
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', scopes.join(' '));
    authUrl.searchParams.append('access_type', 'offline'); // Get refresh token
    authUrl.searchParams.append('prompt', 'consent'); // Force consent to get refresh token
    authUrl.searchParams.append('state', businessId); // Pass business_id in state

    // Redirect to Google OAuth
    return NextResponse.redirect(authUrl.toString());

  } catch (error: any) {
    console.error('Error initiating Google OAuth:', error);
    return NextResponse.json(
      { error: 'Failed to initiate Google Drive authentication', details: error.message },
      { status: 500 }
    );
  }
}
