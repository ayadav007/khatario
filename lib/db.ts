import { existsSync } from 'fs';
import { resolve } from 'path';
import { config as loadEnv } from 'dotenv';
import { Pool, QueryResult, QueryResultRow } from 'pg';

function loadDbEnvFiles() {
  const local = resolve(process.cwd(), '.env.local');
  const base = resolve(process.cwd(), '.env');
  if (existsSync(local)) loadEnv({ path: local });
  if (existsSync(base)) loadEnv({ path: base, override: false });
}

function envString(name: string, fallback = ''): string {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return String(raw);
}

// Database connection pool
let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    loadDbEnvFiles();
    const connectionString = envString('DATABASE_URL');
    const ssl = envString('DB_SSL') === 'true' ? { rejectUnauthorized: false } : false;
    pool = connectionString
      ? new Pool({
          connectionString,
          ssl,
          max: 50,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        })
      : new Pool({
          host: envString('DB_HOST', 'localhost'),
          port: parseInt(envString('DB_PORT', '5432'), 10),
          database: envString('DB_NAME', 'khatario'),
          user: envString('DB_USER', 'postgres'),
          password: envString('DB_PASSWORD'),
          ssl,
          max: 50,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        });

    // Handle pool errors
    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }

  return pool;
}

// Helper function to execute queries
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const pool = getPool();
  const start = Date.now();
  
  try {
    const res = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    
    if (process.env.NODE_ENV === 'development') {
      console.log('Executed query', { text, duration, rows: res.rowCount });
    }
    
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('password must be a string') || message.includes('SASL')) {
      pool = null;
    }
    throw error;
  }
}

// Helper function to get a single row
export async function queryOne<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] || null;
}

// Helper function to get multiple rows
export async function queryRows<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<T[]> {
  const result = await query<T>(text, params);
  return result.rows;
}

// Close the pool (useful for graceful shutdown)
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// Test database connection
export async function testConnection(): Promise<boolean> {
  try {
    await query('SELECT NOW()');
    return true;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  }
}

/** Re-export as db object for routes that use db.query, db.queryRows */
export const db = {
  query,
  queryOne,
  queryRows,
  getPool,
};