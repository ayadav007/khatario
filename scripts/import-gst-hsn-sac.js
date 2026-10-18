/**
 * Import HSN/SAC codes from official GST portal Excel file
 * Source: https://tutorial.gst.gov.in/downloads/HSN_SAC.xlsx
 */

const os = require('os');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const https = require('https');
// Load environment variables - try multiple locations
const envPaths = [
  path.join(__dirname, '..', '.env.local'),
  path.join(__dirname, '..', '.env')
];

for (const envPath of envPaths) {
  try {
    require('dotenv').config({ path: envPath });
    if (process.env.DB_PASSWORD) {
      console.log(`Loaded environment from: ${envPath}`);
      break;
    }
  } catch (e) {
    // Continue to next path
  }
}

// Database connection
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'khatario',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

// Validate password
if (!dbConfig.password || dbConfig.password === '') {
  console.error('\n❌ ERROR: DB_PASSWORD not found or empty in environment variables');
  console.error('Please set DB_PASSWORD in .env or .env.local file');
  console.error('\nCurrent config:');
  console.error(`  DB_HOST: ${dbConfig.host}`);
  console.error(`  DB_PORT: ${dbConfig.port}`);
  console.error(`  DB_NAME: ${dbConfig.database}`);
  console.error(`  DB_USER: ${dbConfig.user}`);
  console.error(`  DB_PASSWORD: ${dbConfig.password ? '***' : 'NOT SET'}`);
  process.exit(1);
}

const pool = new Pool(dbConfig);

// Always download. A leftover temp file would otherwise keep the previous GST list.
async function downloadFile(url, filepath) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

    console.log(`Downloading ${url}...`);
    const file = fs.createWriteStream(filepath);
    
    https.get(url, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log('Download complete');
          resolve();
        });
      } else {
        file.close();
        fs.unlinkSync(filepath);
        reject(new Error(`Failed to download: ${response.statusCode}`));
      }
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
      reject(err);
    });
  });
}

// Extract keywords from description
function extractKeywords(description) {
  if (!description) return [];
  
  const words = description
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3) // Only words longer than 3 chars
    .filter(word => !['and', 'the', 'for', 'with', 'from', 'that', 'this'].includes(word))
    .slice(0, 10); // Max 10 keywords
  
  return [...new Set(words)]; // Remove duplicates
}

function cellText(cell) {
  if (!cell || cell.value == null) return '';
  if (typeof cell.text === 'string' && cell.text.trim()) return cell.text.trim();
  const value = cell.value;
  if (typeof value === 'object' && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text || '').join('').trim();
  }
  return String(value).trim();
}

function parseCodeSheet(worksheet, isService) {
  const records = [];
  let skipped = 0;

  for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
    const row = worksheet.getRow(rowNum);
    const code = cellText(row.getCell(1)).replace(/\s+/g, '');
    const description = cellText(row.getCell(2)).replace(/\s+/g, ' ').trim();

    if (!/^\d{2,8}$/.test(code) || !description) {
      skipped++;
      continue;
    }

    records.push({
      code,
      description,
      gst_rate: null,
      is_service: isService,
      category: isService ? 'Services' : 'Goods',
      keywords: extractKeywords(description),
    });
  }

  console.log(`${worksheet.name}: ${records.length} codes, skipped ${skipped}`);
  return records;
}

// Official GST workbook: HSN_MSTR (goods) and SAC_MSTR (services). No rate column.
async function parseExcelFile(filepath) {
  console.log('Reading Excel file...');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filepath);

  const hsnSheet = workbook.getWorksheet('HSN_MSTR') || workbook.worksheets[0];
  const sacSheet = workbook.getWorksheet('SAC_MSTR') || workbook.worksheets[1];
  if (!hsnSheet || !sacSheet) {
    throw new Error('Workbook must contain the HSN and SAC sheets');
  }

  const byCode = new Map();
  for (const record of [
    ...parseCodeSheet(hsnSheet, false),
    ...parseCodeSheet(sacSheet, true),
  ]) {
    const existing = byCode.get(record.code);
    if (!existing || record.description.length > existing.description.length) {
      byCode.set(record.code, record);
    }
  }

  const records = [...byCode.values()];
  console.log(`Parsed ${records.length} unique codes`);
  return records;
}

// Import to database
async function importToDatabase(records) {
  console.log('Importing to database...');
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM hsn_sac_master');

    const chunkSize = 400;
    let inserted = 0;

    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize);
      const values = [];
      const params = [];
      chunk.forEach((record, index) => {
        const base = index * 5;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
        params.push(record.code, record.description, record.category, record.is_service, record.keywords);
      });

      await client.query(
        `INSERT INTO hsn_sac_master (code, description, category, is_service, keywords)
         VALUES ${values.join(', ')}`,
        params
      );
      inserted += chunk.length;
    }

    await client.query('COMMIT');

    console.log('\n=== Import Summary ===');
    console.log(`Replaced master with ${inserted} codes`);
    console.log('GST rates left empty. This file has no rate column.');
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Main function
async function main() {
  const filepath = path.join(os.tmpdir(), 'HSN_SAC.xlsx');
  const url = 'https://tutorial.gst.gov.in/downloads/HSN_SAC.xlsx';
  
  try {
    console.log('=== GST HSN/SAC Import Tool ===\n');
    
    // Download file
    await downloadFile(url, filepath);
    
    // Parse Excel
    const records = await parseExcelFile(filepath);
    
    if (records.length === 0) {
      console.log('No records found in Excel file');
      return;
    }
    
    // Import to database
    await importToDatabase(records);
    
    console.log('\n✅ Import completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { parseExcelFile, importToDatabase };

