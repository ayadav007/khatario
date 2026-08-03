#!/usr/bin/env node
/**
 * Apply requireTenantBusinessId to VULNERABLE routes from FINAL_ROUTE_SIGNOFF.md
 */
const fs = require('fs');
const path = require('path');

const VULNERABLE_FILES = [
  'app/api/backup/history/route.ts',
  'app/api/backup/history/[id]/download/route.ts',
  'app/api/backup/history/[id]/route.ts',
  'app/api/backup/schedule/route.ts',
  'app/api/badges/counts/route.ts',
  'app/api/cloud-storage/google/auth/route.ts',
  'app/api/cloud-storage/google/credentials/route.ts',
  'app/api/cloud-storage/google/list/route.ts',
  'app/api/commission-rules/[id]/route.ts',
  'app/api/currencies/route.ts',
  'app/api/debug/template-assignment/route.ts',
  'app/api/delivery-challans/route.ts',
  'app/api/depreciation/calculate/route.ts',
  'app/api/document-attachments/[id]/route.ts',
  'app/api/employees/face-enrollment/route.ts',
  'app/api/employees/performance/route.ts',
  'app/api/employees/salary/advances/balance/route.ts',
  'app/api/employees/salary/advances/[id]/approve/route.ts',
  'app/api/employees/targets/route.ts',
  'app/api/employees/targets/[id]/route.ts',
  'app/api/exchange-rates/route.ts',
  'app/api/expense-categories/route.ts',
  'app/api/filters/presets/route.ts',
  'app/api/financial-years/route.ts',
  'app/api/financial-years/[id]/close/route.ts',
  'app/api/fixed-assets/depreciation-schedule/route.ts',
  'app/api/fixed-assets/route.ts',
  'app/api/holidays/route.ts',
  'app/api/holidays/[id]/route.ts',
  'app/api/inventory-adjustments/[id]/route.ts',
  'app/api/invoice-template-settings/route.ts',
  'app/api/invoices/next-number/route.ts',
  'app/api/items/[id]/batches/route.ts',
  'app/api/items/[id]/batches/[batchId]/route.ts',
  'app/api/items/[id]/serials/route.ts',
  'app/api/items/[id]/serials/[serialId]/route.ts',
  'app/api/items/[id]/valuation/route.ts',
  'app/api/journal-entries/templates/route.ts',
  'app/api/journal-entries/templates/[id]/route.ts',
  'app/api/leave-types/route.ts',
  'app/api/leave-types/[id]/route.ts',
  'app/api/locations/route.ts',
  'app/api/notifications/read-all/route.ts',
  'app/api/opening-balances/route.ts',
  'app/api/payment-methods/route.ts',
  'app/api/promotions/active/route.ts',
  'app/api/provisions/route.ts',
  'app/api/provisions/[id]/entries/route.ts',
  'app/api/provisions/[id]/route.ts',
  'app/api/settings/account-mappings/route.ts',
  'app/api/settings/ai-config/route.ts',
  'app/api/settings/item-sales-stock/route.ts',
  'app/api/settings/product-variants/route.ts',
  'app/api/settings/warehouses/route.ts',
  'app/api/settings/whatsapp-bot/route.ts',
  'app/api/shifts/route.ts',
  'app/api/shifts/[id]/route.ts',
  'app/api/suppliers/check-duplicate/route.ts',
  'app/api/suppliers/requests/route.ts',
  'app/api/suppliers/[id]/approve/route.ts',
  'app/api/tasks/route.ts',
  'app/api/tasks/[id]/route.ts',
  'app/api/tax-provisions/route.ts',
  'app/api/template-assignments/route.ts',
  'app/api/template-preview/route.ts',
  'app/api/todos/check-reminders/route.ts',
  'app/api/todos/users/route.ts',
  'app/api/tools/whatsapp-groups/route.ts',
  'app/api/warehouses/[id]/stock-availability/route.ts',
];

function ensureImport(content) {
  if (/requireTenantBusinessId/.test(content)) {
    return content;
  }
  const importLine = "import { requireTenantBusinessId } from '@/lib/auth-helpers';";
  if (/from '@\/lib\/auth-helpers'/.test(content)) {
    return content.replace(
      /import \{([^}]+)\} from '@\/lib\/auth-helpers';/,
      (m, inner) => {
        if (/requireTenantBusinessId/.test(inner)) return m;
        return `import {${inner.trim()}, requireTenantBusinessId } from '@/lib/auth-helpers';`;
      },
    );
  }
  const exportDynamic = content.match(/^export const dynamic = .+;\n/m);
  if (exportDynamic) {
    const idx = content.indexOf(exportDynamic[0]) + exportDynamic[0].length;
    return content.slice(0, idx) + '\n' + importLine + '\n' + content.slice(idx);
  }
  const firstImport = content.match(/^import .+\n/m);
  if (firstImport) {
    const idx = content.indexOf(firstImport[0]) + firstImport[0].length;
    return content.slice(0, idx) + importLine + '\n' + content.slice(idx);
  }
  return importLine + '\n' + content;
}

const TENANT_GUARD = `const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;
    const businessId = tenant.businessId;`;

const TENANT_GUARD_SNAKE = `const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;`;

function fixQueryBusinessId(content) {
  let out = content;
  let changed = false;

  // Remove redundant null checks after tenant guard
  const patterns = [
    {
      re: /const businessId = searchParams\.get\(['"]business_id['"]\);\s*\n\s*if \(!businessId\) \{[\s\S]*?\}\s*\n/g,
      rep: TENANT_GUARD + '\n\n',
    },
    {
      re: /const business_id = searchParams\.get\(['"]business_id['"]\);\s*\n\s*if \(!business_id\) \{[\s\S]*?\}\s*\n/g,
      rep: TENANT_GUARD_SNAKE + '\n\n',
    },
    {
      re: /const businessId = searchParams\.get\(['"]business_id['"]\);\s*\n/g,
      rep: TENANT_GUARD + '\n',
    },
    {
      re: /const business_id = searchParams\.get\(['"]business_id['"]\);\s*\n/g,
      rep: TENANT_GUARD_SNAKE + '\n',
    },
    {
      re: /businessId = searchParams\.get\(['"]business_id['"]\);\s*\n/g,
      rep: `const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
      if (!tenant.ok) return tenant.response;
      businessId = tenant.businessId;\n`,
    },
  ];

  for (const { re, rep } of patterns) {
    if (re.test(out)) {
      out = out.replace(re, rep);
      changed = true;
    }
  }

  return { content: out, changed };
}

function fixBodyBusinessId(content) {
  // POST/PATCH: after `const body = await request.json();` inject tenant if body uses business_id
  if (!/body\.business_id|business_id[,}\s]/.test(content)) {
    return { content, changed: false };
  }
  if (/requireTenantBusinessId\(request,\s*body\.business_id\)/.test(content)) {
    return { content, changed: false };
  }

  const re = /(const body = await request\.json\(\);\s*\n)/g;
  if (!re.test(content)) {
    return { content, changed: false };
  }

  const injection = `$1    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;
`;
  let out = content.replace(re, injection);

  // Remove business_id from destructuring when duplicated
  out = out.replace(
    /const \{\s*\n?\s*business_id,([\s\S]*?)\} = body;/g,
    'const {$1} = body;',
  );
  out = out.replace(/const \{\s*business_id,\s*/g, 'const { ');
  out = out.replace(/,\s*business_id\s*\}/g, ' }');
  out = out.replace(/const \{\s*business_id\s*\} = body;/g, '// business_id from tenant guard above');

  return { content: out, changed: true };
}

const results = { fixed: [], skipped: [], manual: [] };

for (const rel of VULNERABLE_FILES) {
  const file = path.join(process.cwd(), rel);
  if (!fs.existsSync(file)) {
    results.manual.push({ file: rel, reason: 'missing' });
    continue;
  }
  let content = fs.readFileSync(file, 'utf8');
  if (/requireTenantBusinessId/.test(content) && !/searchParams\.get\(['"]business_id['"]\)/.test(content)) {
    results.skipped.push(rel);
    continue;
  }

  const before = content;
  content = ensureImport(content);
  let q = fixQueryBusinessId(content);
  content = q.content;
  let b = fixBodyBusinessId(content);
  content = b.content;

  if (content !== before) {
    fs.writeFileSync(file, content);
    results.fixed.push(rel);
  } else if (/searchParams\.get\(['"]business_id['"]\)/.test(content)) {
    results.manual.push({ file: rel, reason: 'query pattern not auto-fixed' });
  } else {
    results.skipped.push(rel);
  }
}

console.log(JSON.stringify(results, null, 2));
