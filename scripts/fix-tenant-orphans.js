#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const BROKEN = [
  'app/api/todos/users/route.ts',
  'app/api/template-assignments/route.ts',
  'app/api/tasks/[id]/route.ts',
  'app/api/suppliers/[id]/approve/route.ts',
  'app/api/items/[id]/serials/[serialId]/route.ts',
  'app/api/provisions/[id]/route.ts',
  'app/api/payment-methods/route.ts',
  'app/api/shifts/[id]/route.ts',
  'app/api/settings/whatsapp-bot/route.ts',
  'app/api/settings/warehouses/route.ts',
  'app/api/leave-types/[id]/route.ts',
  'app/api/settings/account-mappings/route.ts',
  'app/api/settings/product-variants/route.ts',
  'app/api/journal-entries/templates/[id]/route.ts',
  'app/api/locations/route.ts',
  'app/api/items/[id]/batches/[batchId]/route.ts',
  'app/api/expense-categories/route.ts',
  'app/api/document-attachments/[id]/route.ts',
  'app/api/employees/targets/[id]/route.ts',
  'app/api/holidays/[id]/route.ts',
  'app/api/inventory-adjustments/[id]/route.ts',
  'app/api/financial-years/[id]/close/route.ts',
  'app/api/financial-years/route.ts',
  'app/api/cloud-storage/google/list/route.ts',
  'app/api/cloud-storage/google/credentials/route.ts',
  'app/api/cloud-storage/google/auth/route.ts',
  'app/api/badges/counts/route.ts',
  'app/api/backup/schedule/route.ts',
  'app/api/currencies/route.ts',
  'app/api/backup/history/[id]/route.ts',
  'app/api/backup/history/[id]/download/route.ts',
  'app/api/commission-rules/[id]/route.ts',
];

const orphanRe = /const businessId = tenant\.businessId;\s*\n\s*\);\s*\n\s*\}\s*\n/g;

for (const rel of BROKEN) {
  const file = path.join(process.cwd(), rel);
  let content = fs.readFileSync(file, 'utf8');
  const next = content.replace(orphanRe, 'const businessId = tenant.businessId;\n\n');
  if (next !== content) {
    fs.writeFileSync(file, next);
    console.log('fixed orphan:', rel);
  } else {
    console.log('no match:', rel);
  }
}
