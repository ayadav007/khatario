/**
 * Utility functions for applying advanced filters to database queries
 */

import { FilterCriteria } from '@/components/filters/AdvancedFilterPanel';

export interface WhereClause {
  sql: string;
  params: any[];
}

/**
 * Convert filter criteria to SQL WHERE clause
 */
export function filtersToWhereClause(
  filters: FilterCriteria[],
  paramOffset: number = 1
): WhereClause {
  if (!filters || filters.length === 0) {
    return { sql: '', params: [] };
  }

  const conditions: string[] = [];
  const params: any[] = [];
  let paramIndex = paramOffset;

  for (const filter of filters) {
    if (!filter.value && filter.value !== 0 && filter.value !== false) {
      continue; // Skip empty filters
    }

    const { field, operator, value } = filter;

    switch (operator) {
      case 'eq':
        conditions.push(`${field} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
        break;

      case 'ne':
        conditions.push(`${field} != $${paramIndex}`);
        params.push(value);
        paramIndex++;
        break;

      case 'gt':
        conditions.push(`${field} > $${paramIndex}`);
        params.push(value);
        paramIndex++;
        break;

      case 'lt':
        conditions.push(`${field} < $${paramIndex}`);
        params.push(value);
        paramIndex++;
        break;

      case 'gte':
        conditions.push(`${field} >= $${paramIndex}`);
        params.push(value);
        paramIndex++;
        break;

      case 'lte':
        conditions.push(`${field} <= $${paramIndex}`);
        params.push(value);
        paramIndex++;
        break;

      case 'contains':
        conditions.push(`${field} ILIKE $${paramIndex}`);
        params.push(`%${value}%`);
        paramIndex++;
        break;

      case 'startsWith':
        conditions.push(`${field} ILIKE $${paramIndex}`);
        params.push(`${value}%`);
        paramIndex++;
        break;

      case 'endsWith':
        conditions.push(`${field} ILIKE $${paramIndex}`);
        params.push(`%${value}`);
        paramIndex++;
        break;

      case 'in':
        const values = Array.isArray(value) ? value : [value];
        const placeholders = values.map((_, i) => `$${paramIndex + i}`).join(', ');
        conditions.push(`${field} IN (${placeholders})`);
        params.push(...values);
        paramIndex += values.length;
        break;

      case 'between':
        if (Array.isArray(value) && value.length === 2) {
          conditions.push(`${field} BETWEEN $${paramIndex} AND $${paramIndex + 1}`);
          params.push(value[0], value[1]);
          paramIndex += 2;
        }
        break;

      default:
        console.warn(`Unsupported operator: ${operator}`);
    }
  }

  if (conditions.length === 0) {
    return { sql: '', params: [] };
  }

  return {
    sql: `(${conditions.join(' AND ')})`,
    params,
  };
}

/**
 * Apply filters to a base query
 */
export function applyFiltersToQuery(
  baseQuery: string,
  filters: FilterCriteria[],
  existingParams: any[] = []
): { query: string; params: any[] } {
  const { sql: filterSql, params: filterParams } = filtersToWhereClause(
    filters,
    existingParams.length + 1
  );

  if (!filterSql) {
    return { query: baseQuery, params: existingParams };
  }

  // Check if query already has WHERE clause
  const hasWhere = /\sWHERE\s/i.test(baseQuery);
  const connector = hasWhere ? ' AND ' : ' WHERE ';

  return {
    query: baseQuery + connector + filterSql,
    params: [...existingParams, ...filterParams],
  };
}

/**
 * Client-side filter application for already-fetched data
 */
export function applyFiltersToArray<T extends Record<string, any>>(
  data: T[],
  filters: FilterCriteria[]
): T[] {
  if (!filters || filters.length === 0) {
    return data;
  }

  return data.filter((item) => {
    return filters.every((filter) => {
      const { field, operator, value } = filter;
      const itemValue = item[field];

      if (value === '' || value === null || value === undefined) {
        return true; // Skip empty filters
      }

      switch (operator) {
        case 'eq':
          return itemValue == value;
        case 'ne':
          return itemValue != value;
        case 'gt':
          return itemValue > value;
        case 'lt':
          return itemValue < value;
        case 'gte':
          return itemValue >= value;
        case 'lte':
          return itemValue <= value;
        case 'contains':
          return String(itemValue).toLowerCase().includes(String(value).toLowerCase());
        case 'startsWith':
          return String(itemValue).toLowerCase().startsWith(String(value).toLowerCase());
        case 'endsWith':
          return String(itemValue).toLowerCase().endsWith(String(value).toLowerCase());
        case 'in':
          const values = Array.isArray(value) ? value : [value];
          return values.includes(itemValue);
        case 'between':
          if (Array.isArray(value) && value.length === 2) {
            return itemValue >= value[0] && itemValue <= value[1];
          }
          return true;
        default:
          return true;
      }
    });
  });
}
