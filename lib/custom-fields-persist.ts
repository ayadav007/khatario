import type { PoolClient } from 'pg';
import { queryRows, queryOne } from '@/lib/db';
import {
  normalizeDefinitionRow,
  parseCustomFieldValues,
  validateCustomFieldValues,
} from '@/lib/custom-fields';
import type { CustomFieldEntityType, CustomFieldValues } from '@/types/custom-fields';

async function loadDefinitions(
  businessId: string,
  entityType: CustomFieldEntityType,
  client?: PoolClient
) {
  const sql = `SELECT * FROM custom_field_definitions
    WHERE business_id = $1 AND entity_type = $2
    ORDER BY sort_order, label`;
  const params = [businessId, entityType];
  const rows = client
    ? (await client.query(sql, params)).rows
    : await queryRows(sql, params);
  return rows.map((r) => normalizeDefinitionRow(r as Record<string, unknown>));
}

export async function saveItemCustomFields(
  businessId: string,
  itemId: string,
  rawValues: unknown,
  client?: PoolClient
): Promise<{ ok: true } | { ok: false; error: string }> {
  const definitions = await loadDefinitions(businessId, 'item', client);
  const values = parseCustomFieldValues(rawValues);
  const validated = validateCustomFieldValues(definitions, values);
  if (!validated.ok) return validated;

  const sql = `UPDATE items SET custom_fields = $1::jsonb, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2 AND business_id = $3`;
  const params = [JSON.stringify(validated.values), itemId, businessId];
  if (client) {
    await client.query(sql, params);
  } else {
    await queryOne(sql, params);
  }
  return { ok: true };
}

export async function saveInvoiceCustomFields(
  businessId: string,
  invoiceId: string,
  rawValues: unknown,
  client?: PoolClient
): Promise<{ ok: true } | { ok: false; error: string }> {
  const definitions = await loadDefinitions(businessId, 'invoice', client);
  const values = parseCustomFieldValues(rawValues);
  const validated = validateCustomFieldValues(definitions, values);
  if (!validated.ok) return validated;

  const sql = `UPDATE invoices SET custom_fields = $1::jsonb, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2 AND business_id = $3`;
  const params = [JSON.stringify(validated.values), invoiceId, businessId];
  if (client) {
    await client.query(sql, params);
  } else {
    await queryOne(sql, params);
  }
  return { ok: true };
}

export async function fetchDefinitionsForBusiness(
  businessId: string,
  entityType?: CustomFieldEntityType
) {
  const params: unknown[] = [businessId];
  let sql = `SELECT * FROM custom_field_definitions WHERE business_id = $1`;
  if (entityType) {
    sql += ` AND entity_type = $2`;
    params.push(entityType);
  }
  sql += ` ORDER BY entity_type, sort_order, label`;
  const rows = await queryRows(sql, params);
  return rows.map((r) => normalizeDefinitionRow(r as Record<string, unknown>));
}

export type { CustomFieldValues };
