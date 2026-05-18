const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function checkRecentOrders(businessId) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log(`\n🔍 Checking recent sales orders for business: ${businessId}\n`);

    // Check if next_sales_order_number column exists
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'businesses' AND column_name = 'next_sales_order_number'
    `);
    
    if (columnCheck.rows.length === 0) {
      console.log('❌ Column "next_sales_order_number" does NOT exist in businesses table!');
      console.log('⚠️  Orders cannot be created until migration 095 is run.\n');
    } else {
      console.log('✅ Column "next_sales_order_number" exists\n');
    }

    // Check recent orders
    const orders = await pool.query(`
      SELECT 
        so.id,
        so.order_number,
        so.grand_total,
        so.status,
        so.ocr_status,
        so.notes,
        so.created_at,
        wc.from_number as whatsapp_phone,
        c.name as customer_name
      FROM sales_orders so
      LEFT JOIN whatsapp_conversations wc ON so.whatsapp_conversation_id = wc.id
      LEFT JOIN customers c ON so.customer_id = c.id
      WHERE so.business_id = $1
      ORDER BY so.created_at DESC
      LIMIT 10
    `, [businessId]);

    console.log(`📦 Found ${orders.rows.length} recent orders:\n`);
    
    if (orders.rows.length === 0) {
      console.log('   No orders found. This could mean:');
      console.log('   1. Migration not run (next_sales_order_number column missing)');
      console.log('   2. Order creation failed due to error');
      console.log('   3. No orders have been created yet\n');
    } else {
      orders.rows.forEach((order, idx) => {
        console.log(`${idx + 1}. Order #${order.order_number}`);
        console.log(`   Amount: ₹${order.grand_total}`);
        console.log(`   Status: ${order.status}`);
        console.log(`   OCR Status: ${order.ocr_status || 'N/A'}`);
        console.log(`   WhatsApp: ${order.whatsapp_phone || 'N/A'}`);
        console.log(`   Customer: ${order.customer_name || 'N/A'}`);
        if (order.notes) {
          console.log(`   Notes: ${order.notes.substring(0, 100)}`);
        }
        console.log(`   Created: ${order.created_at}`);
        console.log('');
      });
    }

    // Check for orders with amount mismatches
    const mismatchOrders = await pool.query(`
      SELECT id, order_number, grand_total, ocr_status, ocr_data, notes
      FROM sales_orders
      WHERE business_id = $1
        AND ocr_status = 'requires_review'
        AND ocr_data::text LIKE '%amount mismatch%'
      ORDER BY created_at DESC
      LIMIT 5
    `, [businessId]);

    if (mismatchOrders.rows.length > 0) {
      console.log(`\n⚠️  Found ${mismatchOrders.rows.length} orders with amount mismatches:\n`);
      mismatchOrders.rows.forEach((order) => {
        const ocrData = typeof order.ocr_data === 'string' ? JSON.parse(order.ocr_data) : order.ocr_data;
        console.log(`   Order #${order.order_number}:`);
        console.log(`   Expected: ₹${ocrData.expected_amount || order.grand_total}`);
        console.log(`   Received: ₹${ocrData.received_amount || 'N/A'}`);
        console.log(`   Difference: ₹${ocrData.difference || 'N/A'}\n`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

const businessId = process.argv[2];
if (!businessId) {
  console.error('Usage: node scripts/check-whatsapp-orders.js <business_id>');
  process.exit(1);
}

checkRecentOrders(businessId);
