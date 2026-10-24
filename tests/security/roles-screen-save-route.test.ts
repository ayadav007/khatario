/**
 * Phase 4.4C: the Roles screen saves through the hardened role-permission route and sends no
 * client identity when creating a role.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '../..');
const page = fs.readFileSync(path.join(root, 'app/(app)/settings/roles/page.tsx'), 'utf8');
const saveRoute = fs.readFileSync(path.join(root, 'app/api/roles/[id]/permissions/route.ts'), 'utf8');
const settingsRoute = fs.readFileSync(path.join(root, 'app/api/settings/roles/[id]/permissions/route.ts'), 'utf8');
const createRoute = fs.readFileSync(path.join(root, 'app/api/settings/roles/route.ts'), 'utf8');

describe('Roles screen uses the hardened role-permission routes', () => {
  it('toggling a permission POSTs to /api/roles/[id]/permissions', () => {
    const save = page.match(/fetch\(`\/api\/roles\/\$\{selectedRole\}\/permissions`,\s*\{\s*method:\s*'(\w+)'/);
    expect(save?.[1]).toBe('POST');
    expect(page.match(/fetch\(`\/api\/[^`]*permissions`,\s*\{\s*method:/g)).toHaveLength(1);
  });

  it('the save and settings routes authenticate with the strict session and the shared service', () => {
    for (const src of [saveRoute, settingsRoute]) {
      expect(src).toMatch(/requireStrictSession\(request\)/);
      expect(src).toMatch(/updateRolePermissions\(/);
      expect(src).not.toMatch(/getUserIdFromRequest|getBusinessIdFromRequest|resolveCreatedByUserId|updated_by_user_id\s*}/);
      expect(src).not.toMatch(/from '@\/lib\/db'/);
    }
  });

  it('role creation sends no business or actor fields and the route ignores them', () => {
    const create = page.slice(page.indexOf("fetch('/api/settings/roles'"), page.indexOf("fetch('/api/settings/roles'") + 400);
    expect(create).not.toMatch(/business_id|created_by_user_id|user_id/);
    const post = createRoute.slice(createRoute.indexOf('export async function POST'));
    expect(post).toMatch(/requireStrictSession\(request\)/);
    expect(post).toMatch(/createRole\(/);
    expect(post).not.toMatch(/resolveCreatedByUserId|body\.business_id|getUserIdFromRequest/);
  });
});
