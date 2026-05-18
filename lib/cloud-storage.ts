/**
 * Cloud Storage Service
 * Handles Google Drive and Dropbox integrations for backup storage
 */

import * as db from '@/lib/db';
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || process.env.JWT_SECRET || 'default-key-change-in-production';

/**
 * Encrypt sensitive data (OAuth tokens)
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt sensitive data
 */
export function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  
  const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Google Drive Service
 */
export class GoogleDriveService {
  private accessToken: string;
  private refreshToken: string;
  private tokenExpiresAt: Date;
  private businessId: string;

  constructor(businessId: string, accessToken: string, refreshToken: string, tokenExpiresAt: Date) {
    this.businessId = businessId;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.tokenExpiresAt = tokenExpiresAt;
  }

  /**
   * Get or refresh access token
   */
  async getValidAccessToken(): Promise<string> {
    // Check if token is expired or will expire in next 5 minutes
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    if (this.tokenExpiresAt && this.tokenExpiresAt > fiveMinutesFromNow) {
      return this.accessToken;
    }

    // Refresh token
    return await this.refreshAccessToken();
  }

  /**
   * Refresh access token using refresh token
   */
  private async refreshAccessToken(): Promise<string> {
    const tokenEndpoint = 'https://oauth2.googleapis.com/token';
    
    // Get business-specific credentials
    const connection = await db.queryOne(`
      SELECT client_id_encrypted, client_secret_encrypted
      FROM cloud_storage_connections
      WHERE business_id = $1 AND provider = 'google_drive'
    `, [this.businessId]);

    let clientId: string;
    let clientSecret: string;

    if (connection && connection.client_id_encrypted && connection.client_secret_encrypted) {
      clientId = decrypt(connection.client_id_encrypted);
      clientSecret = decrypt(connection.client_secret_encrypted);
    } else {
      // Fallback to environment variables
      clientId = process.env.GOOGLE_CLIENT_ID || '';
      clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    }

    if (!clientId || !clientSecret) {
      throw new Error('Google Drive credentials not configured');
    }
    
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to refresh Google Drive token');
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000);

    // Update token in database
    await db.query(`
      UPDATE cloud_storage_connections
      SET access_token_encrypted = $1,
          token_expires_at = $2,
          updated_at = NOW()
      WHERE business_id = $3 AND provider = 'google_drive'
    `, [encrypt(this.accessToken), this.tokenExpiresAt, this.businessId]);

    return this.accessToken;
  }

  /**
   * Upload file to Google Drive
   */
  async uploadFile(fileName: string, fileContent: string, mimeType: string = 'application/json'): Promise<{ fileId: string; filePath: string }> {
    const accessToken = await this.getValidAccessToken();

    // Create metadata
    const metadata = {
      name: fileName,
      mimeType: mimeType,
      parents: ['appDataFolder'], // Store in app-specific folder
    };

    // Create multipart request body
    const boundary = '-------314159265358979323846';
    const delimiter = '\r\n--' + boundary + '\r\n';
    const closeDelimiter = '\r\n--' + boundary + '--';

    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: ' + mimeType + '\r\n\r\n' +
      fileContent +
      closeDelimiter;

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to upload to Google Drive: ${error}`);
    }

    const result = await response.json();

    return {
      fileId: result.id,
      filePath: `google_drive://${result.id}/${fileName}`,
    };
  }

  /**
   * List backup files from Google Drive
   */
  async listBackupFiles(): Promise<Array<{ id: string; name: string; createdTime: string; size: number }>> {
    const accessToken = await this.getValidAccessToken();

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name,createdTime,size)&orderBy=createdTime desc`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to list files from Google Drive');
    }

    const data = await response.json();
    return data.files || [];
  }

  /**
   * Download file from Google Drive
   */
  async downloadFile(fileId: string): Promise<string> {
    const accessToken = await this.getValidAccessToken();

    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to download from Google Drive');
    }

    return await response.text();
  }

  /**
   * Delete file from Google Drive
   */
  async deleteFile(fileId: string): Promise<void> {
    const accessToken = await this.getValidAccessToken();

    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to delete from Google Drive');
    }
  }

  /**
   * Load Google Drive service from database
   */
  static async load(businessId: string): Promise<GoogleDriveService | null> {
    const connection = await db.queryOne(`
      SELECT * FROM cloud_storage_connections
      WHERE business_id = $1 AND provider = 'google_drive' AND is_active = true
    `, [businessId]);

    if (!connection) {
      return null;
    }

    const accessToken = decrypt(connection.access_token_encrypted);
    const refreshToken = decrypt(connection.refresh_token_encrypted);

    return new GoogleDriveService(
      businessId,
      accessToken,
      refreshToken,
      connection.token_expires_at
    );
  }
}

/**
 * Dropbox Service
 */
export class DropboxService {
  private accessToken: string;
  private refreshToken: string;
  private businessId: string;

  constructor(businessId: string, accessToken: string, refreshToken: string) {
    this.businessId = businessId;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }

  /**
   * Upload file to Dropbox
   */
  async uploadFile(fileName: string, fileContent: string): Promise<{ fileId: string; filePath: string }> {
    const path = `/Khatario Backups/${fileName}`;

    const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: path,
          mode: 'add',
          autorename: true,
          mute: false,
        }),
      },
      body: fileContent,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to upload to Dropbox: ${error}`);
    }

    const result = await response.json();

    return {
      fileId: result.id,
      filePath: result.path_display,
    };
  }

  /**
   * List backup files from Dropbox
   */
  async listBackupFiles(): Promise<Array<{ id: string; name: string; createdTime: string; size: number }>> {
    const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: '/Khatario Backups',
        recursive: false,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to list files from Dropbox');
    }

    const data = await response.json();
    
    return (data.entries || [])
      .filter((entry: any) => entry['.tag'] === 'file')
      .map((entry: any) => ({
        id: entry.id,
        name: entry.name,
        createdTime: entry.client_modified,
        size: entry.size,
      }));
  }

  /**
   * Download file from Dropbox
   */
  async downloadFile(path: string): Promise<string> {
    const response = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({ path }),
      },
    });

    if (!response.ok) {
      throw new Error('Failed to download from Dropbox');
    }

    return await response.text();
  }

  /**
   * Delete file from Dropbox
   */
  async deleteFile(path: string): Promise<void> {
    const response = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path }),
    });

    if (!response.ok) {
      throw new Error('Failed to delete from Dropbox');
    }
  }

  /**
   * Load Dropbox service from database
   */
  static async load(businessId: string): Promise<DropboxService | null> {
    const connection = await db.queryOne(`
      SELECT * FROM cloud_storage_connections
      WHERE business_id = $1 AND provider = 'dropbox' AND is_active = true
    `, [businessId]);

    if (!connection) {
      return null;
    }

    const accessToken = decrypt(connection.access_token_encrypted);
    const refreshToken = decrypt(connection.refresh_token_encrypted);

    return new DropboxService(businessId, accessToken, refreshToken);
  }
}
