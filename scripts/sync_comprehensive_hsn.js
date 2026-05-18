const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

/**
 * HSN Master Generator (V2 - High Performance)
 * Fetches a comprehensive dataset of 7,000+ HSN/SAC codes
 * from reliable community-maintained sources.
 */

async function generateComprehensiveHSN() {
    console.log('🚀 Starting Comprehensive HSN Data Sync...');
    
    const SOURCES = [
        'https://raw.githubusercontent.com/The-Dev-Couple/gst-hsn-codes-json/master/hsn-codes.json',
        'https://raw.githubusercontent.com/vinitshahdeo/hsn-sac-codes/master/hsn-sac-codes.json'
    ];

    let hsnData = [];

    for (const url of SOURCES) {
        try {
            console.log(`📡 Fetching from: ${url}`);
            const response = await fetch(url);
            
            if (response.ok) {
                const data = await response.json();
                const raw = Array.isArray(data) ? data : (data.codes || data.results || []);
                
                console.log(`✅ Received ${raw.length} records.`);
                
                raw.forEach(item => {
                    const code = (item.code || item.hsn_code || item.hsn || '').toString();
                    const desc = item.description || item.desc || item.hsn_description || '';
                    let rate = item.gst || item.rate || item.gst_rate || '18';
                    
                    if (typeof rate === 'string') rate = rate.replace('%', '').trim();
                    
                    if (code && desc) {
                        hsnData.push({
                            code,
                            desc,
                            rate,
                            category: item.category || (code.startsWith('99') ? 'Services' : 'Goods')
                        });
                    }
                });

                if (hsnData.length > 500) break;
            }
        } catch (err) {
            console.error(`❌ Source failed: ${url} - ${err.message}`);
        }
    }

    const uniqueMap = new Map();
    hsnData.forEach(item => {
        if (!uniqueMap.has(item.code)) {
            uniqueMap.set(item.code, item);
        }
    });
    hsnData = Array.from(uniqueMap.values());

    console.log(`📊 Total Unique HSN Codes Processed: ${hsnData.length}`);

    if (hsnData.length === 0) {
        console.error('💥 No data found to process.');
        return;
    }

    // 1. Save to Excel
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('HSN Master List');

    sheet.columns = [
        { header: 'HSN/SAC Code', key: 'code', width: 15 },
        { header: 'Description', key: 'desc', width: 80 },
        { header: 'GST Rate (%)', key: 'rate', width: 15 },
        { header: 'Category', key: 'category', width: 25 }
    ];

    sheet.getRow(1).font = { bold: true };
    hsnData.forEach(item => sheet.addRow(item));

    const excelPath = path.join(process.cwd(), 'public', 'downloads', 'Most_Used_HSN_India.xlsx');
    await workbook.xlsx.writeFile(excelPath);
    console.log(`📍 Excel Master Created: ${excelPath}`);

    // 2. Save to JSON
    const jsonPath = path.join(process.cwd(), 'public', 'data', 'hsn_master.json');
    if (!fs.existsSync(path.dirname(jsonPath))) fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(hsnData, null, 2));
    console.log(`📍 JSON Copy saved: ${jsonPath}`);

    // 3. Generate SQL Seed
    console.log('📝 Generating SQL for database update...');
    const sqlFile = path.join(process.cwd(), 'database', 'seed_hsn_master_comprehensive.sql');
    const stream = fs.createWriteStream(sqlFile);
    stream.write('-- Comprehensive HSN/SAC Seed\n');
    stream.write('BEGIN;\n');
    stream.write('TRUNCATE hsn_sac_master;\n');
    
    hsnData.forEach(item => {
        const isService = item.code.startsWith('99');
        const desc = item.desc.replace(/'/g, "''").replace(/\n/g, ' ');
        const cat = (item.category || '').replace(/'/g, "''");
        stream.write(`INSERT INTO hsn_sac_master (code, description, gst_rate, category, is_service, keywords) VALUES ('${item.code}', '${desc}', ${parseFloat(item.rate) || 0}, '${cat}', ${isService}, ARRAY['${item.code}', '${cat.toLowerCase()}']) ON CONFLICT (code) DO NOTHING;\n`);
    });
    
    stream.write('COMMIT;\n');
    stream.end();
    console.log(`📍 SQL Seed script generated: ${sqlFile}`);
    console.log('\n✅ Comprehensive Sync Complete!');
}

generateComprehensiveHSN();
