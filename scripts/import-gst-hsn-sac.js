/**
 * Import HSN/SAC codes from official GST portal Excel file
 * Source: https://tutorial.gst.gov.in/downloads/HSN_SAC.xlsx
 */

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

// Download file if not exists
async function downloadFile(url, filepath) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(filepath)) {
      console.log('File already exists, skipping download');
      resolve();
      return;
    }

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

// Determine if code is service (SAC) or goods (HSN)
function isServiceCode(code) {
  if (!code) return false;
  const codeStr = String(code).trim();
  // SAC codes start with 99 and are 6 digits
  return /^99\d{4}$/.test(codeStr);
}

// Determine category from description
function determineCategory(description) {
  if (!description) return null;
  
  const desc = description.toLowerCase();
  
  if (desc.includes('service') || desc.includes('consulting') || desc.includes('maintenance')) {
    return 'Services';
  }
  if (desc.includes('food') || desc.includes('beverage') || desc.includes('preparation')) {
    return 'Food & Beverages';
  }
  if (desc.includes('medicine') || desc.includes('pharmaceutical') || desc.includes('drug')) {
    return 'Healthcare';
  }
  if (desc.includes('textile') || desc.includes('fabric') || desc.includes('garment')) {
    return 'Textiles';
  }
  if (desc.includes('electronic') || desc.includes('computer') || desc.includes('mobile')) {
    return 'Electronics';
  }
  if (desc.includes('vehicle') || desc.includes('automobile') || desc.includes('car')) {
    return 'Automobiles';
  }
  if (desc.includes('furniture') || desc.includes('chair') || desc.includes('table')) {
    return 'Furniture';
  }
  
  return null;
}

// Parse Excel file
async function parseExcelFile(filepath) {
  console.log('Reading Excel file...');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filepath);
  
  const worksheet = workbook.getWorksheet(1); // Get first worksheet
  if (!worksheet) {
    throw new Error('No worksheet found in Excel file');
  }
  
  console.log(`Found worksheet: ${worksheet.name}`);
  console.log(`Total rows: ${worksheet.rowCount}`);
  
  // Find header row (usually row 1)
  const headerRow = worksheet.getRow(1);
  const headers = {};
  
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const headerValue = String(cell.value || '').toLowerCase().trim();
    headers[colNumber] = headerValue;
  });
  
  console.log('Headers found:', headers);
  
  // Try to identify column indices
  let codeCol = null;
  let descCol = null;
  let rateCol = null;
  
  // Common column names in GST HSN/SAC files
  const codeNames = ['code', 'hsn', 'sac', 'hsn/sac', 'hsn code', 'sac code'];
  const descNames = ['description', 'desc', 'item description', 'goods description', 'service description'];
  const rateNames = ['gst rate', 'rate', 'tax rate', 'gst', 'cgst', 'sgst'];
  
  for (const [colNum, header] of Object.entries(headers)) {
    const headerLower = header.toLowerCase();
    if (!codeCol && codeNames.some(name => headerLower.includes(name))) {
      codeCol = parseInt(colNum);
    }
    if (!descCol && descNames.some(name => headerLower.includes(name))) {
      descCol = parseInt(colNum);
    }
    if (!rateCol && rateNames.some(name => headerLower.includes(name))) {
      rateCol = parseInt(colNum);
    }
  }
  
  if (!codeCol || !descCol) {
    // If we can't find headers, try first two columns
    console.log('Could not identify headers, using first two columns as code and description');
    codeCol = 1;
    descCol = 2;
  }
  
  console.log(`Using columns - Code: ${codeCol}, Description: ${descCol}, Rate: ${rateCol || 'N/A'}`);
  
  const records = [];
  let skipped = 0;
  
  // Read data rows (skip header row)
  for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
    const row = worksheet.getRow(rowNum);
    const code = row.getCell(codeCol)?.value;
    const description = row.getCell(descCol)?.value;
    const rate = rateCol ? row.getCell(rateCol)?.value : null;
    
    // Skip empty rows
    if (!code && !description) {
      skipped++;
      continue;
    }
    
    const codeStr = String(code || '').trim();
    const descStr = String(description || '').trim();
    
    // Skip if code is empty
    if (!codeStr) {
      skipped++;
      continue;
    }
    
    // Parse GST rate
    let gstRate = null;
    if (rate !== null && rate !== undefined) {
      const rateStr = String(rate).replace('%', '').trim();
      const rateNum = parseFloat(rateStr);
      if (!isNaN(rateNum)) {
        gstRate = rateNum;
      }
    }
    
    records.push({
      code: codeStr,
      description: descStr,
      gst_rate: gstRate,
      is_service: isServiceCode(codeStr),
      category: determineCategory(descStr),
      keywords: extractKeywords(descStr)
    });
  }
  
  console.log(`Parsed ${records.length} records (skipped ${skipped} empty rows)`);
  return records;
}

// Import to database
async function importToDatabase(records) {
  console.log('Importing to database...');
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    let inserted = 0;
    let updated = 0;
    let errors = 0;
    
    for (const record of records) {
      try {
        // Check if code already exists
        const existing = await client.query(
          'SELECT id FROM hsn_sac_master WHERE code = $1',
          [record.code]
        );
        
        if (existing.rows.length > 0) {
          // Update existing
          await client.query(
            `UPDATE hsn_sac_master 
             SET description = $1, 
                 gst_rate = $2, 
                 category = $3, 
                 is_service = $4, 
                 keywords = $5,
                 updated_at = CURRENT_TIMESTAMP
             WHERE code = $6`,
            [
              record.description,
              record.gst_rate,
              record.category,
              record.is_service,
              record.keywords,
              record.code
            ]
          );
          updated++;
        } else {
          // Insert new
          await client.query(
            `INSERT INTO hsn_sac_master (code, description, gst_rate, category, is_service, keywords)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              record.code,
              record.description,
              record.gst_rate,
              record.category,
              record.is_service,
              record.keywords
            ]
          );
          inserted++;
        }
      } catch (err) {
        console.error(`Error processing code ${record.code}:`, err.message);
        errors++;
      }
    }
    
    await client.query('COMMIT');
    
    console.log('\n=== Import Summary ===');
    console.log(`Inserted: ${inserted}`);
    console.log(`Updated: ${updated}`);
    console.log(`Errors: ${errors}`);
    console.log(`Total: ${records.length}`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Main function
async function main() {
  const filepath = path.join(__dirname, 'HSN_SAC.xlsx');
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

