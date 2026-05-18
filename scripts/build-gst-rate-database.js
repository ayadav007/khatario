/**
 * Build GST Rate Database from Common Codes
 * This script creates a curated database of common HSN/SAC codes with their typical GST rates
 * Sources: GST notifications, common industry codes, user data
 */

const { Pool } = require('pg');
const path = require('path');

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
  console.error('\n❌ ERROR: DB_PASSWORD not found or empty');
  console.error('Please set DB_PASSWORD in .env or .env.local file');
  process.exit(1);
}

const pool = new Pool(dbConfig);

// Common HSN/SAC codes with typical GST rates
// Based on GST notifications and common industry usage
const commonCodesWithRates = [
  // Food & Beverages
  { code: '19053100', rate: 5, description: 'Biscuits and similar baked products', category: 'Food & Beverages' },
  { code: '21069099', rate: 5, description: 'Food preparations not elsewhere specified', category: 'Food & Beverages' },
  { code: '0406', rate: 5, description: 'Cheese and curd', category: 'Food & Beverages' },
  { code: '0401', rate: 0, description: 'Milk and cream', category: 'Food & Beverages' },
  { code: '0402', rate: 5, description: 'Milk and cream, concentrated', category: 'Food & Beverages' },
  
  // Healthcare
  { code: '30049099', rate: 12, description: 'Medicines and pharmaceutical products', category: 'Healthcare' },
  { code: '3004', rate: 12, description: 'Medicaments', category: 'Healthcare' },
  
  // Electronics
  { code: '85171200', rate: 18, description: 'Telephones for cellular networks', category: 'Electronics' },
  { code: '85287200', rate: 18, description: 'Monitors and projectors', category: 'Electronics' },
  { code: '8471', rate: 18, description: 'Automatic data processing machines', category: 'Electronics' },
  
  // Textiles
  { code: '5205', rate: 5, description: 'Cotton yarn', category: 'Textiles' },
  { code: '5208', rate: 5, description: 'Woven fabrics of cotton', category: 'Textiles' },
  { code: '6109', rate: 5, description: 'T-shirts, singlets', category: 'Textiles' },
  
  // Services (SAC)
  { code: '996331', rate: 5, description: 'Restaurant services', category: 'Food Services' },
  { code: '998311', rate: 18, description: 'Software development services', category: 'IT Services' },
  { code: '998312', rate: 18, description: 'IT consulting services', category: 'IT Services' },
  { code: '998341', rate: 18, description: 'Accounting services', category: 'Professional Services' },
  { code: '998342', rate: 18, description: 'Legal services', category: 'Professional Services' },
  { code: '998391', rate: 18, description: 'Advertising services', category: 'Marketing' },
  { code: '998513', rate: 18, description: 'Telecommunication services', category: 'Telecom' },
  { code: '998621', rate: 18, description: 'Hotel accommodation services', category: 'Hospitality' },
  
  // Automobiles
  { code: '87032100', rate: 28, description: 'Passenger cars', category: 'Automobiles' },
  { code: '8704', rate: 28, description: 'Motor vehicles for goods transport', category: 'Automobiles' },
  
  // Furniture
  { code: '94032000', rate: 18, description: 'Other metal furniture', category: 'Furniture' },
  { code: '9403', rate: 18, description: 'Other furniture', category: 'Furniture' },
  
  // Appliances
  { code: '84211200', rate: 28, description: 'Washing machines', category: 'Appliances' },
  { code: '8418', rate: 28, description: 'Refrigerators and freezers', category: 'Appliances' },
  
  // Education
  { code: '49019900', rate: 0, description: 'Books, printed matter', category: 'Education' },
  { code: '4901', rate: 0, description: 'Printed books', category: 'Education' },
  
  // Add more common codes as needed
];

async function updateGSTRates() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    let updated = 0;
    let inserted = 0;
    let errors = 0;
    
    console.log('Updating GST rates for common codes...\n');
    
    for (const item of commonCodesWithRates) {
      try {
        // Check if code exists
        const existing = await client.query(
          'SELECT id FROM hsn_sac_master WHERE code = $1',
          [item.code]
        );
        
        if (existing.rows.length > 0) {
          // Update existing
          await client.query(
            `UPDATE hsn_sac_master 
             SET gst_rate = $1,
                 category = COALESCE($2, category),
                 updated_at = CURRENT_TIMESTAMP
             WHERE code = $3`,
            [item.rate, item.category, item.code]
          );
          updated++;
        } else {
          // Insert new (if code exists in master but not in our curated list)
          // This shouldn't happen if we imported the master file first
          console.log(`Code ${item.code} not found in master table, skipping insert`);
        }
      } catch (err) {
        console.error(`Error processing code ${item.code}:`, err.message);
        errors++;
      }
    }
    
    await client.query('COMMIT');
    
    console.log('\n=== Update Summary ===');
    console.log(`Updated: ${updated}`);
    console.log(`Errors: ${errors}`);
    console.log(`Total processed: ${commonCodesWithRates.length}`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Learn from user data
async function learnFromUserData() {
  const client = await pool.connect();
  
  try {
    console.log('\nLearning GST rates from user selections...');
    
    // Find most commonly used rate for each HSN code
    const query = `
      SELECT 
        hsn_sac_code,
        gst_rate,
        COUNT(*) as usage_count,
        COUNT(DISTINCT business_id) as business_count
      FROM hsn_usage_stats
      WHERE hsn_sac_code IS NOT NULL
        AND gst_rate IS NOT NULL
      GROUP BY hsn_sac_code, gst_rate
      HAVING COUNT(*) >= 3  -- At least 3 uses
      ORDER BY hsn_sac_code, usage_count DESC
    `;
    
    const result = await client.query(query);
    
    let learned = 0;
    
    // For each code, get the most common rate
    const codeRates = new Map();
    result.rows.forEach(row => {
      if (!codeRates.has(row.hsn_sac_code) || 
          codeRates.get(row.hsn_sac_code).usage_count < row.usage_count) {
        codeRates.set(row.hsn_sac_code, {
          rate: row.gst_rate,
          usage_count: row.usage_count,
          business_count: row.business_count
        });
      }
    });
    
    // Update master table with learned rates
    for (const [code, data] of codeRates.entries()) {
      // Only update if current rate is NULL or if learned rate has high confidence
      if (data.usage_count >= 5) {
        await client.query(
          `UPDATE hsn_sac_master 
           SET gst_rate = $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE code = $2 
             AND (gst_rate IS NULL OR gst_rate != $1)`,
          [data.rate, code]
        );
        learned++;
      }
    }
    
    console.log(`Learned rates from ${learned} codes based on user data`);
    
  } catch (error) {
    console.error('Error learning from user data:', error);
  } finally {
    client.release();
  }
}

async function main() {
  try {
    console.log('=== GST Rate Database Builder ===\n');
    
    // Step 1: Update common codes
    await updateGSTRates();
    
    // Step 2: Learn from user data
    await learnFromUserData();
    
    console.log('\n✅ GST rate database updated successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { updateGSTRates, learnFromUserData };

