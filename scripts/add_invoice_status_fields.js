/**
 * Migration: add invoice status safeguards and new fields
 * - Adds is_editable (boolean, default true)
 * - Adds cancellation_details (jsonb, default {})
 * - Adds check constraints for status and payment_status
 *
 * Run: node scripts/add_invoice_status_fields.js
 */

require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

async function run() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'khatario',
    user: process.env.DB_USER || 'postgres',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };

  // Only add password if it exists and is not empty
  if (process.env.DB_PASSWORD) {
    config.password = process.env.DB_PASSWORD;
  }

  const pool = new Pool(config);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Add is_editable if missing
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'invoices' AND column_name = 'is_editable'
        ) THEN
          ALTER TABLE invoices ADD COLUMN is_editable BOOLEAN DEFAULT true;
        END IF;
      END$$;
    `);

    // Add cancellation_details if missing
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'invoices' AND column_name = 'cancellation_details'
        ) THEN
          ALTER TABLE invoices ADD COLUMN cancellation_details JSONB DEFAULT NULL;
        END IF;
      END$$;
    `);

    // Add cgst_total if missing
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'invoices' AND column_name = 'cgst_total'
        ) THEN
          ALTER TABLE invoices ADD COLUMN cgst_total DECIMAL(12,2) DEFAULT 0;
        END IF;
      END$$;
    `);

    // Add sgst_total if missing
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'invoices' AND column_name = 'sgst_total'
        ) THEN
          ALTER TABLE invoices ADD COLUMN sgst_total DECIMAL(12,2) DEFAULT 0;
        END IF;
      END$$;
    `);

    // Add igst_total if missing
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'invoices' AND column_name = 'igst_total'
        ) THEN
          ALTER TABLE invoices ADD COLUMN igst_total DECIMAL(12,2) DEFAULT 0;
        END IF;
      END$$;
    `);

    // Add/replace status check constraint
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'chk_invoice_status'
        ) THEN
          ALTER TABLE invoices DROP CONSTRAINT chk_invoice_status;
        END IF;
        ALTER TABLE invoices
        ADD CONSTRAINT chk_invoice_status CHECK (status IN ('draft','final','cancelled'));
      END$$;
    `);

    // Add/replace payment_status check constraint
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'chk_invoice_payment_status'
        ) THEN
          ALTER TABLE invoices DROP CONSTRAINT chk_invoice_payment_status;
        END IF;
        ALTER TABLE invoices
        ADD CONSTRAINT chk_invoice_payment_status CHECK (payment_status IN ('unpaid','partially_paid','paid'));
      END$$;
    `);

    await client.query('COMMIT');
    console.log('Migration completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();

