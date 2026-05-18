/**
 * Generate bcrypt hash for platform admin password
 * Run: node scripts/generate_admin_password.js admin123
 */

const bcrypt = require('bcryptjs');

const password = process.argv[2] || 'admin123';

bcrypt.hash(password, 10, (err, hash) => {
  if (err) {
    console.error('Error generating hash:', err);
    process.exit(1);
  }

  console.log('\n===========================================');
  console.log('Password Hash Generated');
  console.log('===========================================');
  console.log('Password:', password);
  console.log('Hash:', hash);
  console.log('\nCopy this hash to database/seed_platform_admin.sql');
  console.log('===========================================\n');
});

