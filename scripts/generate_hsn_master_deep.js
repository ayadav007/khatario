const puppeteer = require('puppeteer');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

/**
 * HSN Master Generator V3 (Deep Scraper)
 * Iterates through all 98 Goods Chapters and SAC Chapter 99
 * to build a complete database of 10,000+ codes.
 */

async function deepScrapeHSN() {
    console.log('🚀 Starting Deep HSN Scraper (10,000+ codes)...');
    
    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    const hsnData = [];

    // Goods Chapters 01 to 98
    const chapters = [];
    for (let i = 1; i <= 10; i++) {
        chapters.push(i.toString().padStart(2, '0'));
    }
    // Services Chapter 99
    chapters.push('99');

    console.log(`📑 Total Chapters to process: ${chapters.length}`);

    try {
        for (const chapter of chapters) {
            console.log(`📦 Scraping Chapter ${chapter}...`);
            
            try {
                // Using a more reliable directory structure
                await page.goto(`https://www.mastersindia.co/gst-hsn-code-list-rates/chapter-${chapter}/`, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 30000 
                });

                const rows = await page.evaluate(() => {
                    const results = [];
                    const tableRows = document.querySelectorAll('table tr');
                    
                    tableRows.forEach((row, index) => {
                        if (index === 0) return; // Skip header
                        const cols = row.querySelectorAll('td');
                        if (cols.length >= 3) {
                            const code = cols[0].innerText.trim();
                            const desc = cols[1].innerText.trim();
                            const rate = cols[2].innerText.trim().replace('%', '');
                            
                            // Only add if it looks like a valid HSN (4, 6, or 8 digits)
                            if (code.length >= 4) {
                                results.push({ code, desc, rate });
                            }
                        }
                    });
                    return results;
                });

                if (rows.length > 0) {
                    console.log(`✅ Found ${rows.length} entries for Chapter ${chapter}`);
                    rows.forEach(r => hsnData.push({ 
                        ...r, 
                        category: parseInt(chapter) <= 98 ? `Goods (Ch ${chapter})` : 'Services (SAC 99)' 
                    }));
                } else {
                    console.log(`⚠️ No entries found for Chapter ${chapter}`);
                }
                
                // Small delay to prevent rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (err) {
                console.error(`❌ Error scraping Chapter ${chapter}:`, err.message);
            }

            // Save progress every 10 chapters to avoid data loss
            if (parseInt(chapter) % 10 === 0) {
                saveProgress(hsnData);
            }
        }

        saveFinal(hsnData);

    } catch (error) {
        console.error('💥 Fatal Scraper Error:', error);
    } finally {
        await browser.close();
    }
}

function saveProgress(data) {
    const tempPath = path.join(process.cwd(), 'public', 'data', 'hsn_master_temp.json');
    if (!fs.existsSync(path.dirname(tempPath))) fs.mkdirSync(path.dirname(tempPath), { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
    console.log(`💾 Progress saved: ${data.length} records.`);
}

async function saveFinal(hsnData) {
    console.log(`\n✨ Scraping Complete! Total Records: ${hsnData.length}`);
    
    if (hsnData.length === 0) {
        console.error('⚠️ No data scraped. Check internet connection or source availability.');
        return;
    }

    // Dedup
    const uniqueMap = new Map();
    hsnData.forEach(item => {
        if (!uniqueMap.has(item.code)) uniqueMap.set(item.code, item);
    });
    const finalData = Array.from(uniqueMap.values());

    // 1. Save to Excel
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Complete HSN SAC List');
    sheet.columns = [
        { header: 'HSN/SAC Code', key: 'code', width: 15 },
        { header: 'Description', key: 'desc', width: 80 },
        { header: 'GST Rate (%)', key: 'rate', width: 15 },
        { header: 'Chapter/Category', key: 'category', width: 25 }
    ];
    sheet.getRow(1).font = { bold: true };
    finalData.forEach(item => sheet.addRow(item));
    await workbook.xlsx.writeFile(path.join(process.cwd(), 'public', 'downloads', 'Most_Used_HSN_India.xlsx'));

    // 2. Save to JSON
    fs.writeFileSync(path.join(process.cwd(), 'public', 'data', 'hsn_master.json'), JSON.stringify(finalData, null, 2));

    // 3. Generate SQL
    const sqlFile = path.join(process.cwd(), 'database', 'seed_hsn_master_complete.sql');
    const stream = fs.createWriteStream(sqlFile);
    stream.write('BEGIN;\nTRUNCATE hsn_sac_master;\n');
    finalData.forEach(item => {
        const isService = item.code.startsWith('99');
        const desc = item.desc.replace(/'/g, "''").replace(/\n/g, ' ');
        const cat = item.category.replace(/'/g, "''");
        stream.write(`INSERT INTO hsn_sac_master (code, description, gst_rate, category, is_service, keywords) VALUES ('${item.code}', '${desc}', ${parseFloat(item.rate) || 0}, '${cat}', ${isService}, ARRAY['${item.code}', '${cat.toLowerCase()}']) ON CONFLICT (code) DO NOTHING;\n`);
    });
    stream.write('COMMIT;\n');
    stream.end();
    
    console.log('📍 All artifacts generated successfully.');
}

deepScrapeHSN();

