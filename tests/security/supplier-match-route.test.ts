/**
 * The supplier alias lookup used by bill scan reads the business from the strict session,
 * never from the request body, and its callers send no business id.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '../..');
const route = fs.readFileSync(path.join(root, 'app/api/suppliers/match/route.ts'), 'utf8');
const matcher = fs.readFileSync(path.join(root, 'lib/matching/supplier-matcher.ts'), 'utf8');
const phone = fs.readFileSync(path.join(root, 'phone/lib/screens/purchases/bill_form_screen.dart'), 'utf8');

describe('POST /api/suppliers/match is scoped to the session business', () => {
  it('authenticates with the strict session before reading the body', () => {
    const post = route.slice(route.indexOf('export async function POST'));
    expect(post.indexOf('requireStrictSession(request)')).toBeGreaterThan(-1);
    expect(post.indexOf('requireStrictSession(request)')).toBeLessThan(post.indexOf('request.json()'));
    expect(post).toMatch(/const business_id = session\.businessId;/);
    expect(post).not.toMatch(/\{\s*business_id\s*,[^}]*\}\s*=\s*body/);
    expect(post).not.toMatch(/body\.business_id/);
  });

  it('the website and phone callers send no business id', () => {
    const web = matcher.slice(matcher.indexOf("fetch(`/api/suppliers/match`"), matcher.indexOf("fetch(`/api/suppliers/match`") + 300);
    expect(web).not.toMatch(/business_id/);
    const app = phone.slice(phone.indexOf("'/api/suppliers/match'"), phone.indexOf("'/api/suppliers/match'") + 200);
    expect(app).not.toMatch(/business_id/);
  });
});
