/**
 * HSN/SAC Code Import Script
 * 
 * This script helps import HSN/SAC codes from CSV file into the database.
 * 
 * Usage:
 *   node scripts/import_hsn_codes.js [path_to_csv_file]
 * 
 * CSV Format:
 *   code,description,gst_rate,category,is_service,keywords
 *   19053100,Biscuits and similar baked products,5,Food & Beverages,false,"biscuit,cookie,snack"
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

function getDbConfig() {
  // Try DATABASE_URL first
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
    };
  }

  // Fallback to individual variables
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'khatario',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  };
}

async function importHSNCodes(csvFilePath) {
  const dbConfig = getDbConfig();
  const pool = new Pool(dbConfig);

  try {
    console.log('📥 Starting HSN/SAC Code Import...\n');
    console.log(`📂 Reading file: ${csvFilePath}\n`);

    // Read and parse CSV
    const fileContent = fs.readFileSync(csvFilePath, 'utf-8');
    const lines = fileContent.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
      throw new Error('CSV file must have at least a header and one data row');
    }

    // Parse header
    const headers = lines[0].split(',').map(h => h.trim());
    console.log(`📋 Columns found: ${headers.join(', ')}\n`);

    // Validate required columns
    const requiredColumns = ['code', 'description'];
    for (const col of requiredColumns) {
      if (!headers.includes(col)) {
        throw new Error(`Missing required column: ${col}`);
      }
    }

    // Parse data rows
    const codes = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Simple CSV parsing (handles quoted fields)
      const values = [];
      let current = '';
      let inQuotes = false;
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim()); // Add last value

      // Map to object
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });

      // Validate and process
      if (!row.code || !row.description) {
        console.warn(`⚠️  Skipping row ${i + 1}: Missing code or description`);
        continue;
      }

      codes.push({
        code: row.code.trim(),
        description: row.description.trim(),
        gst_rate: row.gst_rate ? parseFloat(row.gst_rate) : null,
        category: row.category ? row.category.trim() : null,
        is_service: row.is_service === 'true' || row.is_service === '1',
        keywords: row.keywords 
          ? row.keywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k)
          : []
      });
    }

    console.log(`✅ Parsed ${codes.length} HSN/SAC codes\n`);
    console.log('💾 Importing to database...\n');

    // Import to database
    const client = await pool.connect();
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    try {
      await client.query('BEGIN');

      for (const code of codes) {
        try {
          await client.query(
            `INSERT INTO hsn_sac_master (code, description, gst_rate, category, is_service, keywords)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (code) DO UPDATE SET
               description = EXCLUDED.description,
               gst_rate = COALESCE(EXCLUDED.gst_rate, hsn_sac_master.gst_rate),
               category = COALESCE(EXCLUDED.category, hsn_sac_master.category),
               is_service = EXCLUDED.is_service,
               keywords = EXCLUDED.keywords,
               updated_at = CURRENT_TIMESTAMP`,
            [
              code.code,
              code.description,
              code.gst_rate,
              code.category,
              code.is_service,
              code.keywords
            ]
          );
          successCount++;
          if (successCount % 100 === 0) {
            process.stdout.write(`   Imported ${successCount} codes...\r`);
          }
        } catch (err) {
          if (err.code === '23505') { // Unique constraint violation
            skipCount++;
          } else {
            console.error(`\n❌ Error importing ${code.code}: ${err.message}`);
            errorCount++;
          }
        }
      }

      await client.query('COMMIT');
      console.log('\n');

      console.log('✅ Import completed!\n');
      console.log(`   ✅ Successfully imported: ${successCount} codes`);
      if (skipCount > 0) {
        console.log(`   ⏭️  Skipped (already exist): ${skipCount} codes`);
      }
      if (errorCount > 0) {
        console.log(`   ❌ Errors: ${errorCount} codes`);
      }
      console.log(`   📊 Total in database: ${codes.length} codes\n`);

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Show sample data
    const result = await pool.query('SELECT COUNT(*) as total FROM hsn_sac_master');
    console.log(`📊 Total HSN/SAC codes in database: ${result.rows[0].total}\n`);

    const sample = await pool.query(
      'SELECT code, description, gst_rate FROM hsn_sac_master ORDER BY RANDOM() LIMIT 5'
    );
    console.log('📝 Sample codes in database:');
    sample.rows.forEach(row => {
      console.log(`   ${row.code} - ${row.description} (${row.gst_rate}%)`);
    });

  } catch (error) {
    console.error('\n❌ Import failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Main execution
const csvFile = process.argv[2];

if (!csvFile) {
  console.log('📖 HSN/SAC Code Import Script\n');
  console.log('Usage:');
  console.log('  node scripts/import_hsn_codes.js <path_to_csv_file>\n');
  console.log('Example:');
  console.log('  node scripts/import_hsn_codes.js data/hsn_codes.csv\n');
  console.log('CSV Format:');
  console.log('  code,description,gst_rate,category,is_service,keywords');
  console.log('  19053100,Biscuits and similar baked products,5,Food & Beverages,false,"biscuit,cookie,snack"\n');
  process.exit(1);
}

if (!fs.existsSync(csvFile)) {
  console.error(`❌ Error: File not found: ${csvFile}`);
  process.exit(1);
}

importHSNCodes(csvFile);

