import { queryOne } from './db';

const columnCache = new Map<string, boolean>();

function cacheKey(tableName: string, columnName: string): string {
  return `${tableName}.${columnName}`;
}

/** Cached check for whether a public schema column exists (safe for pre-migration DBs). */
export async function hasTableColumn(
  tableName: string,
  columnName: string
): Promise<boolean> {
  const key = cacheKey(tableName, columnName);
  if (columnCache.has(key)) {
    return columnCache.get(key)!;
  }

  try {
    const row = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
      ) AS exists`,
      [tableName, columnName]
    );
    const exists = row?.exists === true;
    columnCache.set(key, exists);
    return exists;
  } catch (error) {
    console.error(`Error checking column ${tableName}.${columnName}:`, error);
    return false;
  }
}
