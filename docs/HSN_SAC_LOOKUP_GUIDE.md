# HSN/SAC Code Lookup Feature

This document explains the HSN/SAC automatic lookup feature implemented in Khatario.

## Overview

The HSN/SAC lookup feature allows users to automatically find and select HSN (Harmonized System of Nomenclature) codes for goods or SAC (Service Accounting Code) codes for services when adding products. This ensures GST compliance and reduces manual errors.

## Features

- ✅ **Automatic Search**: Type product name or keywords to find matching HSN/SAC codes
- ✅ **Auto-fill**: Selecting a code automatically fills:
  - HSN/SAC code
  - GST rate
- ✅ **Smart Search**: Searches across:
  - Code (exact match prioritized)
  - Description (fuzzy match)
  - Keywords array
  - Full-text search
- ✅ **Free & Local**: Uses local database - no API costs, works offline

## How It Works

### For Users

1. **Adding a New Product**:
   - Go to Items → Add New Item
   - In the "HSN/SAC Code" field, start typing:
     - Product name (e.g., "biscuit", "software")
     - Or code directly (e.g., "19053100")
   - See suggestions with:
     - Code
     - Description
     - GST rate
     - Category
     - Type (HSN/SAC)
   - Click to select - code and tax rate auto-fill

2. **Search Tips**:
   - Minimum 2 characters to start search
   - More specific keywords = better results
   - Use arrow keys to navigate suggestions
   - Press Enter to select highlighted item

### Technical Implementation

#### Database Structure

```sql
CREATE TABLE hsn_sac_master (
  id SERIAL PRIMARY KEY,
  code VARCHAR(10) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  gst_rate DECIMAL(5,2),
  category VARCHAR(255),
  is_service BOOLEAN DEFAULT false,
  keywords TEXT[],
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### API Endpoint

`GET /api/hsn/lookup?q=<search_term>&limit=10`

**Response**:
```json
{
  "results": [
    {
      "code": "19053100",
      "description": "Biscuits and similar baked products",
      "gst_rate": 5.00,
      "category": "Food & Beverages",
      "is_service": false
    }
  ]
}
```

## Adding More HSN/SAC Codes

### Option 1: SQL Insert

```sql
INSERT INTO hsn_sac_master (code, description, gst_rate, category, is_service, keywords) 
VALUES (
  '19053100',
  'Biscuits and similar baked products',
  5.00,
  'Food & Beverages',
  false,
  ARRAY['biscuit', 'cookie', 'snack']
);
```

### Option 2: CSV Import

1. Prepare CSV file with columns:
   ```csv
   code,description,gst_rate,category,is_service,keywords
   19053100,Biscuits and similar baked products,5,Food & Beverages,false,"biscuit,cookie,snack"
   998314,Software development services,18,IT Services,true,"software,development,IT"
   ```

2. Import using pgAdmin or psql:
   ```sql
   COPY hsn_sac_master (code, description, gst_rate, category, is_service, keywords)
   FROM '/path/to/hsn_codes.csv'
   WITH (FORMAT csv, HEADER true, DELIMITER ',');
   ```

### Option 3: Bulk Import Script

Create a script using Node.js/PostgreSQL:

```javascript
const { Pool } = require('pg');
const fs = require('fs');
const csv = require('csv-parser');

const pool = new Pool({
  // Your database config
});

async function importHSNCodes(csvPath) {
  const codes = [];
  
  fs.createReadStream(csvPath)
    .pipe(csv())
    .on('data', (row) => {
      codes.push({
        code: row.code,
        description: row.description,
        gst_rate: parseFloat(row.gst_rate),
        category: row.category,
        is_service: row.is_service === 'true',
        keywords: row.keywords ? row.keywords.split(',').map(k => k.trim()) : []
      });
    })
    .on('end', async () => {
      for (const code of codes) {
        await pool.query(
          `INSERT INTO hsn_sac_master (code, description, gst_rate, category, is_service, keywords)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (code) DO UPDATE SET
           description = EXCLUDED.description,
           gst_rate = EXCLUDED.gst_rate,
           category = EXCLUDED.category,
           keywords = EXCLUDED.keywords,
           updated_at = CURRENT_TIMESTAMP`,
          [code.code, code.description, code.gst_rate, code.category, code.is_service, code.keywords]
        );
      }
      console.log(`Imported ${codes.length} HSN/SAC codes`);
      await pool.end();
    });
}

importHSNCodes('./hsn_master_data.csv');
```

## Data Sources

### Free Sources

1. **Government Sources**:
   - CBIC (Central Board of Indirect Taxes and Customs) notifications
   - GST portal downloads
   - Official HSN/SAC master lists

2. **Community Resources**:
   - GitHub repositories with HSN master data
   - Open-source datasets
   - Public CSV/JSON files

3. **Third-party (with permission)**:
   - Tally Solutions HSN Code Finder
   - ClearTax HSN lookup tools
   - Masters India databases

### Recommended Approach

1. Start with the **initial seed data** (included in migration)
2. Add codes as needed based on your business
3. Update quarterly/semi-annually for rate changes
4. Maintain keywords for better search results

## Maintenance

### Regular Updates

- **Frequency**: Quarterly or semi-annually
- **What to Update**:
  - New HSN/SAC codes
  - GST rate changes
  - New categories
  - Enhanced keywords

### Update Process

1. Export current data:
   ```sql
   COPY (SELECT * FROM hsn_sac_master) TO '/path/to/backup.csv' WITH CSV HEADER;
   ```

2. Update/import new data

3. Verify:
   ```sql
   SELECT COUNT(*) FROM hsn_sac_master;
   SELECT code, gst_rate, updated_at FROM hsn_sac_master ORDER BY updated_at DESC LIMIT 10;
   ```

## Troubleshooting

### No Results Appearing

1. **Check database**: Ensure migration `010_hsn_sac_master_table.sql` ran successfully
2. **Verify data**: Check if codes exist:
   ```sql
   SELECT COUNT(*) FROM hsn_sac_master;
   ```
3. **Check API**: Test endpoint directly:
   ```
   GET /api/hsn/lookup?q=biscuit
   ```

### Slow Search

1. **Check indexes**: Verify indexes exist:
   ```sql
   \d+ hsn_sac_master
   ```
2. **Optimize keywords**: Ensure keywords array is populated
3. **Limit results**: Reduce `limit` parameter if needed

## Best Practices

1. **Keywords**: Add multiple synonyms (e.g., "mobile", "phone", "smartphone")
2. **Categories**: Use consistent category names
3. **Descriptions**: Keep descriptions clear and specific
4. **Updates**: Track `updated_at` for audit trail
5. **Backup**: Regular backups of master data

## Future Enhancements

- [ ] Admin UI for managing HSN/SAC codes
- [ ] Bulk import via UI
- [ ] Version history for GST rate changes
- [ ] Popular codes statistics
- [ ] API endpoint for external integrations
- [ ] Auto-sync with official sources

