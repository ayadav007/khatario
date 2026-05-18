const puppeteer = require('puppeteer');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

/**
 * HSN Master Generator
 * Scrapes most common HSN codes and GST rates from reliable sources
 * and saves them to an Excel file for small businesses.
 */

const CATEGORIES = [
    { name: 'Garments & Apparel (Ch 61-62)', codes: ['61', '62'] },
    { name: 'Food & Groceries (Ch 19-21)', codes: ['19', '20', '21'] },
    { name: 'Electronics & Hardware (Ch 84-85)', codes: ['84', '85'] },
    { name: 'Furniture & Interiors (Ch 94)', codes: ['94'] },
    { name: 'Services (SAC 99)', codes: ['99'] }
];

async function scrapeHSN() {
    console.log('🚀 Starting HSN Scraper...');
    
    // We will use a reliable developer-friendly source or a public directory
    // For this tool, we'll target a structured directory
    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    const hsnData = [];

    try {
        // Target: A public, high-quality HSN directory
        // We'll scrape a few primary pages to get the "Most Used" ones
        console.log('📡 Navigating to data source...');
        
        // Note: Using a well-structured site that allows scraping for educational/tooling purposes
        // ClearTax/TaxBuddy are good, but let's use a simpler directory if possible for robustness
        
        // Strategy: Iterate through common chapters on a public HSN finder
        for (const cat of CATEGORIES) {
            console.log(`📦 Scraping Category: ${cat.name}...`);
            
            for (const chapter of cat.codes) {
                // We'll use a search-based approach on a public directory
                // For demonstration, let's assume we target a URL like:
                // https://www.mastersindia.co/gst-hsn-code-list-rates/chapter-${chapter}/
                
                try {
                    await page.goto(`https://www.mastersindia.co/gst-hsn-code-list-rates/chapter-${chapter}/`, { 
                        waitUntil: 'networkidle2',
                        timeout: 60000 
                    });

                    const rows = await page.evaluate(() => {
                        const results = [];
                        const tableRows = document.querySelectorAll('table tr');
                        
                        tableRows.forEach((row, index) => {
                            if (index === 0) return; // Skip header
                            const cols = row.querySelectorAll('td');
                            if (cols.length >= 3) {
                                results.push({
                                    code: cols[0].innerText.trim(),
                                    desc: cols[1].innerText.trim(),
                                    rate: cols[2].innerText.trim().replace('%', '')
                                });
                            }
                        });
                        return results;
                    });

                    console.log(`✅ Found ${rows.length} entries for Chapter ${chapter}`);
                    rows.forEach(r => hsnData.push({ ...r, category: cat.name }));
                    
                } catch (err) {
                    console.error(`❌ Error scraping Chapter ${chapter}:`, err.message);
                }
            }
        }

        if (hsnData.length === 0) {
            console.error('⚠️ No data scraped. Using comprehensive fallback data for Indian MSMEs.');
            // Fallback: Most used codes across various industries in India
            hsnData.push(
                // Garments & Textiles
                { code: '6109', desc: 'T-shirts, singlets and other vests, knitted or crocheted', rate: '5', category: 'Garments' },
                { code: '6204', desc: 'Women’s or girls’ suits, ensembles, jackets, dresses, skirts, trousers, bib and brace overalls, breeches and shorts', rate: '12', category: 'Garments' },
                { code: '6203', desc: 'Men’s or boys’ suits, ensembles, jackets, blazers, trousers, bib and brace overalls, breeches and shorts', rate: '12', category: 'Garments' },
                { code: '6105', desc: 'Men’s or boys’ shirts, knitted or crocheted', rate: '5', category: 'Garments' },
                
                // Food & Groceries
                { code: '1905', desc: 'Bread, pastry, cakes, biscuits and other bakers’ wares', rate: '18', category: 'Food & Groceries' },
                { code: '2106', desc: 'Food preparations not elsewhere specified (including namkeens, bhujia, etc.)', rate: '12', category: 'Food & Groceries' },
                { code: '0901', desc: 'Coffee, whether or not roasted or decaffeinated', rate: '5', category: 'Food & Groceries' },
                { code: '0902', desc: 'Tea, whether or not flavoured', rate: '5', category: 'Food & Groceries' },
                { code: '1701', desc: 'Cane or beet sugar and chemically pure sucrose, in solid form', rate: '5', category: 'Food & Groceries' },
                
                // Electronics & Hardware
                { code: '8471', desc: 'Automatic data processing machines (Computers, Laptops) and units thereof', rate: '18', category: 'Electronics' },
                { code: '8517', desc: 'Telephone sets, including smartphones and other telephones for cellular networks', rate: '18', category: 'Electronics' },
                { code: '8528', desc: 'Monitors and projectors, not incorporating television reception apparatus', rate: '18', category: 'Electronics' },
                { code: '8443', desc: 'Printers, copying machines and facsimile machines', rate: '18', category: 'Electronics' },
                
                // Furniture & Interiors
                { code: '9403', desc: 'Other furniture (Wood, Metal, Plastic) and parts thereof', rate: '18', category: 'Furniture' },
                { code: '9404', desc: 'Mattress supports; articles of bedding and similar furnishing', rate: '18', category: 'Furniture' },
                
                // Services (SAC)
                { code: '9983', desc: 'Other professional, technical and business services (Consulting, IT)', rate: '18', category: 'Services' },
                { code: '9987', desc: 'Maintenance, repair and installation (except construction) services', rate: '18', category: 'Services' },
                { code: '9963', desc: 'Accommodation, food and beverage services (Hotels/Restaurants)', rate: '5', category: 'Services' },
                { code: '9965', desc: 'Goods transport services (GTA)', rate: '5', category: 'Services' },
                { code: '9967', desc: 'Supporting and auxiliary transport services (Storage, Warehousing)', rate: '18', category: 'Services' }
            );
        }

        // Create Excel
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('HSN Master List');

        sheet.columns = [
            { header: 'HSN/SAC Code', key: 'code', width: 15 },
            { header: 'Description', key: 'desc', width: 60 },
            { header: 'GST Rate (%)', key: 'rate', width: 15 },
            { header: 'Industry Category', key: 'category', width: 25 }
        ];

        // Add styling
        sheet.getRow(1).font = { bold: true };
        sheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        hsnData.forEach(item => {
            sheet.addRow(item);
        });

        const outputPath = path.join(process.cwd(), 'public', 'downloads', 'Most_Used_HSN_India.xlsx');
        
        // Ensure directory exists
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir, { recursive: true });
        }

        await workbook.xlsx.writeFile(outputPath);
        console.log(`\n✨ Excel Master Created successfully!`);
        console.log(`📍 Path: ${outputPath}`);
        console.log(`📊 Total HSN Codes: ${hsnData.length}`);

        // Also save a JSON version for the UI finder
        const jsonPath = path.join(process.cwd(), 'public', 'data', 'hsn_master.json');
        const jsonDir = path.dirname(jsonPath);
        if (!fs.existsSync(jsonDir)) fs.mkdirSync(jsonDir, { recursive: true });
        fs.writeFileSync(jsonPath, JSON.stringify(hsnData, null, 2));
        console.log(`📍 JSON Copy saved for HSN Finder tool: ${jsonPath}`);

    } catch (error) {
        console.error('💥 Fatal Scraper Error:', error);
    } finally {
        await browser.close();
    }
}

scrapeHSN();

