/**
 * Seed Database Script
 * Runs SQL seed files using Node.js instead of psql
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'khatario_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'admin',
});

async function runSqlFile(filePath) {
  try {
    console.log(`\n📄 Reading ${path.basename(filePath)}...`);
    const sql = fs.readFileSync(filePath, 'utf8');
    
    console.log('⚙️  Executing SQL...');
    await pool.query(sql);
    
    console.log(`✅ Successfully executed ${path.basename(filePath)}`);
    return true;
  } catch (error) {
    console.error(`❌ Error executing ${path.basename(filePath)}:`, error.message);
    return false;
  }
}

async function main() {
  console.log('🌱 Starting Database Seeding...\n');
  console.log('Database:', process.env.DB_NAME || 'khatario_db');
  console.log('User:', process.env.DB_USER || 'postgres');
  
  try {
    // Test connection
    await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful!\n');
    
    // Seed subscription plans
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📦 Seeding Subscription Plans...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const subscriptionsSuccess = await runSqlFile(
      path.join(__dirname, '..', 'database', 'seed_subscriptions.sql')
    );
    
    // Seed platform admin
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('👑 Seeding Platform Admin...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const adminSuccess = await runSqlFile(
      path.join(__dirname, '..', 'database', 'seed_platform_admin.sql')
    );
    
    // Summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Seeding Summary');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Subscription Plans:', subscriptionsSuccess ? '✅ Success' : '❌ Failed');
    console.log('Platform Admin:', adminSuccess ? '✅ Success' : '❌ Failed');
    
    if (subscriptionsSuccess && adminSuccess) {
      console.log('\n🎉 All seed data loaded successfully!\n');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🔑 Platform Admin Credentials');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('URL:      http://localhost:3000/admin/login');
      console.log('Email:    admin@khatario.com');
      console.log('Password: admin123');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    } else {
      console.log('\n⚠️  Some seed operations failed. Check errors above.\n');
    }
    
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.error('\nPlease check your .env file and ensure PostgreSQL is running.');
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
