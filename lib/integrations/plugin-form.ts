import type { IntegrationCatalogEntry, PluginField } from '@/lib/integrations/catalog';
import type { ConnectionView } from '@/lib/integrations/service';
import type { IntegrationRowStatus } from '@/hooks/useIntegrationMarketplaceStatus';

const isSecretKind = (f: PluginField) => f.kind === 'password' || f.kind === 'webhook_token';

/** Text and email fields come from the stored config; secrets always start blank. */
export function initialFormValues(
  fields: PluginField[],
  connection: ConnectionView | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    out[f.key] = isSecretKind(f) ? '' : connection?.config?.[f.key] ?? '';
  }
  return out;
}

/** Text and email are always sent trimmed. Secrets are sent exactly as typed, only when not empty. */
export function buildSaveValues(
  fields: PluginField[],
  form: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const raw = form[f.key] ?? '';
    if (isSecretKind(f)) {
      if (raw !== '') out[f.key] = raw;
    } else {
      out[f.key] = raw.trim();
    }
  }
  return out;
}

export type CardActionLabel =
  | 'Connect'
  | 'Manage'
  | 'Coming soon'
  | 'Upgrade'
  | 'Access'
  | 'Try now'
  | 'Open';

export function cardAction(
  entry: IntegrationCatalogEntry,
  status: IntegrationRowStatus,
): { label: CardActionLabel; href: string | null; disabled: boolean } {
  if (entry.comingSoon) return { label: 'Coming soon', href: null, disabled: true };
  if (entry.plugin) {
    return {
      label: status.active ? 'Manage' : 'Connect',
      href: `/settings/integrations/${entry.id}`,
      disabled: status.loading,
    };
  }
  if (!status.entitled) return { label: 'Upgrade', href: '/settings/subscription', disabled: false };
  const href = entry.configureHref ?? null;
  if (status.active) return { label: 'Access', href, disabled: !href };
  if (entry.ctaVariant === 'try') return { label: 'Try now', href, disabled: !href };
  if (entry.ctaVariant === 'access') return { label: 'Open', href, disabled: !href };
  return { label: 'Connect', href, disabled: !href || status.loading };
}
