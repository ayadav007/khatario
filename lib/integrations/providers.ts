// Server-only: this module reads the database and must never be imported by client components.
// (The `server-only` package is not a dependency of this repo, so this comment marks the boundary.)
import type { PoolClient } from 'pg';
import { queryOne } from '@/lib/db';
import { clearShiprocketCache, verifyShiprocketLogin } from '@/lib/store/delivery/shiprocket';

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'rejected' | 'unreachable'; message: string };

export type ProviderServer = {
  verify(input: { config: Record<string, string>; secrets: Record<string, string> }): Promise<VerifyResult>;
  countInFlight(businessId: string): Promise<number>;
  onChanged?(businessId: string): void;
  /** Extra statements inside the disconnect transaction. */
  onDisconnect?(client: PoolClient, businessId: string): Promise<void>;
};

const shiprocket: ProviderServer = {
  async verify({ config, secrets }) {
    const r = await verifyShiprocketLogin({ email: config.email, password: secrets.password });
    if (r.ok) return r;
    return r.reason === 'rejected'
      ? {
          ok: false,
          reason: 'rejected',
          message:
            'Shiprocket did not accept this email and password. Use the API user from Shiprocket → Settings → API, not your main login.',
        }
      : { ok: false, reason: 'unreachable', message: 'Could not reach Shiprocket. Nothing was saved; try again.' };
  },

  async countInFlight(businessId) {
    const row = await queryOne<{ n: string | number }>(
      `SELECT (SELECT count(*) FROM order_fulfilments
                WHERE business_id = $1 AND method = 'shiprocket'
                  AND status IN ('shipped','out_for_delivery','delivery_failed'))
            + (SELECT count(*) FROM order_returns
                WHERE business_id = $1 AND carrier_order_id IS NOT NULL
                  AND pickup_status IN ('booked','out_for_pickup','pickup_issue')) AS n`,
      [businessId],
    );
    return Number(row?.n ?? 0);
  },

  onChanged() {
    clearShiprocketCache();
  },

  async onDisconnect(client, businessId) {
    await client.query(
      `UPDATE business_settings
          SET store_shiprocket_email = NULL,
              store_shiprocket_password_enc = NULL,
              store_shiprocket_webhook_token_hash = NULL,
              store_delivery_provider = CASE WHEN store_delivery_provider = 'shiprocket' THEN 'self' ELSE store_delivery_provider END
        WHERE business_id = $1`,
      [businessId],
    );
  },
};

export const PROVIDERS: Record<string, ProviderServer> = { shiprocket };

export function getProvider(provider: string): ProviderServer | null {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, provider) ? PROVIDERS[provider] : null;
}
