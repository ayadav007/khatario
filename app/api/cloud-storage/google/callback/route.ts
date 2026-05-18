import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { encrypt } from '@/lib/cloud-storage';

/**
 * GET /api/cloud-storage/google/callback
 * Handle Google Drive OAuth callback
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state'); // business_id
    const error = searchParams.get('error');

    if (error) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings/backup?error=${encodeURIComponent(error)}`
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings/backup?error=missing_code_or_state`
      );
    }

    const businessId = state;

    // Get business-specific credentials
    const connection = await db.queryOne(`
      SELECT client_id_encrypted, client_secret_encrypted, redirect_uri
      FROM cloud_storage_connections
      WHERE business_id = $1 AND provider = 'google_drive'
    `, [businessId]);

    let clientId: string;
    let clientSecret: string;
    let redirectUri: string;

    if (connection && connection.client_id_encrypted && connection.client_secret_encrypted) {
      // Use business-specific credentials
      const { decrypt } = await import('@/lib/cloud-storage');
      clientId = decrypt(connection.client_id_encrypted);
      clientSecret = decrypt(connection.client_secret_encrypted);
      redirectUri = connection.redirect_uri;
    } else {
      // Fallback to environment variables
      clientId = process.env.GOOGLE_CLIENT_ID || '';
      clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
      redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL}/api/cloud-storage/google/callback`;
    }

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings/backup?error=missing_credentials`
      );
    }

    // Exchange code for tokens
    const tokenEndpoint = 'https://oauth2.googleapis.com/token';

    const tokenResponse = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('Token exchange failed:', errorData);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings/backup?error=token_exchange_failed`
      );
    }

    const tokens = await tokenResponse.json();

    if (!tokens.access_token || !tokens.refresh_token) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings/backup?error=missing_tokens`
      );
    }

    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
      },
    });

    let providerUserId = null;
    let providerUserEmail = null;

    if (userInfoResponse.ok) {
      const userInfo = await userInfoResponse.json();
      providerUserId = userInfo.id;
      providerUserEmail = userInfo.email;
    }

    // Calculate token expiration
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Encrypt tokens before storing
    const accessTokenEncrypted = encrypt(tokens.access_token);
    const refreshTokenEncrypted = encrypt(tokens.refresh_token);

    // Store connection in database (upsert)
    await db.query(`
      INSERT INTO cloud_storage_connections (
        business_id, user_id, provider, access_token_encrypted, 
        refresh_token_encrypted, token_expires_at, provider_user_id, 
        provider_user_email, is_active, last_used_at
      )
      VALUES (
        $1, 
        (SELECT id FROM users WHERE business_id = $1 LIMIT 1), 
        'google_drive', $2, $3, $4, $5, $6, true, NOW()
      )
      ON CONFLICT (business_id, provider) 
      DO UPDATE SET
        access_token_encrypted = EXCLUDED.access_token_encrypted,
        refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
        token_expires_at = EXCLUDED.token_expires_at,
        provider_user_id = EXCLUDED.provider_user_id,
        provider_user_email = EXCLUDED.provider_user_email,
        is_active = true,
        last_used_at = NOW(),
        updated_at = NOW()
    `, [
      businessId,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiresAt,
      providerUserId,
      providerUserEmail,
    ]);

    // Redirect back to backup settings with success
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings/backup?google_drive=connected`
    );

  } catch (error: any) {
    console.error('Error handling Google OAuth callback:', error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings/backup?error=callback_failed`
    );
  }
}
