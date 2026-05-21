import type { PoolClient } from 'pg';
import { queryRows, queryOne } from '@/lib/db';
import {
  normalizeDefinitionRow,
  parseCustomFieldValues,
  validateCustomFieldValues,
} from '@/lib/custom-fields';
import type { CustomFieldEntityType, CustomFieldValues } from '@/types/custom-fields';

let customFieldDefinitionsAvailable: boolean | null = null;

function isCustomFieldsUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  return code === '42501' || code === '42P01';
}

/** True when custom_field_definitions exists and the app DB user can read it. */
async function canUseCustomFieldDefinitions(client?: PoolClient): Promise<boolean> {
  if (customFieldDefinitionsAvailable !== null) {
    return customFieldDefinitionsAvailable;
  }

  const sql = `SELECT 1 FROM custom_field_definitions LIMIT 1`;
  try {
    if (client) {
      await client.query(sql);
    } else {
      await queryOne(sql, []);
    }
    customFieldDefinitionsAvailable = true;
  } catch (error) {
    if (isCustomFieldsUnavailableError(error)) {
      console.warn(
        '[custom-fields] custom_field_definitions unavailable; skipping custom field persistence.',
        (error as { message?: string }).message
      );
      customFieldDefinitionsAvailable = false;
    } else {
      throw error;
    }
  }

  return customFieldDefinitionsAvailable;
}

async function loadDefinitions(
  businessId: string,
  entityType: CustomFieldEntityType,
  client?: PoolClient
) {
  if (!(await canUseCustomFieldDefinitions(client))) {
    return [];
  }

  try {
    const sql = `SELECT * FROM custom_field_definitions
      WHERE business_id = $1 AND entity_type = $2
      ORDER BY sort_order, label`;
    const params = [businessId, entityType];
    const rows = client
      ? (await client.query(sql, params)).rows
      : await queryRows(sql, params);
    return rows.map((r) => normalizeDefinitionRow(r as Record<string, unknown>));
  } catch (error) {
    if (isCustomFieldsUnavailableError(error)) {
      customFieldDefinitionsAvailable = false;
      console.warn('[custom-fields] Failed to load definitions; continuing without custom fields.');
      return [];
    }
    throw error;
  }
}

export async function saveItemCustomFields(
  businessId: string,
  itemId: string,
  rawValues: unknown,
  client?: PoolClient
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await canUseCustomFieldDefinitions(client))) {
    return { ok: true };
  }

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
  if (!(await canUseCustomFieldDefinitions(client))) {
    return { ok: true };
  }

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
  if (!(await canUseCustomFieldDefinitions())) {
    return [];
  }

  try {
    const params: unknown[] = [businessId];
    let sql = `SELECT * FROM custom_field_definitions WHERE business_id = $1`;
    if (entityType) {
      sql += ` AND entity_type = $2`;
      params.push(entityType);
    }
    sql += ` ORDER BY entity_type, sort_order, label`;
    const rows = await queryRows(sql, params);
    return rows.map((r) => normalizeDefinitionRow(r as Record<string, unknown>));
  } catch (error) {
    if (isCustomFieldsUnavailableError(error)) {
      customFieldDefinitionsAvailable = false;
      return [];
    }
    throw error;
  }
}

export type { CustomFieldValues };
