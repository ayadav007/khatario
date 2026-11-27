// Server-only: reads the stored Masters India login for a business.
import { loadSecrets } from '@/lib/integrations/service';
import type { GspCredentials } from './client';

export async function loadGspCredentials(businessId: string): Promise<GspCredentials | null> {
  const stored = await loadSecrets(businessId, 'mastersindia');
  if (!stored) return null;
  const username = stored.config.username;
  const password = stored.secrets.password;
  if (!username || !password) return null;
  return { username, password };
}
