import { readFileSync } from 'fs';

const MARKER = '-- Base subscription plans';

describe('fresh database catalogue', () => {
  const sql = readFileSync('database/schema.sql', 'utf8');
  const block = sql.slice(sql.indexOf(MARKER));

  it('schema.sql seeds the four base plans without overwriting', () => {
    expect(sql.indexOf(MARKER)).toBeGreaterThan(-1);
    for (const id of ['free', 'professional', 'business', 'enterprise']) expect(block).toContain(`'${id}'`);
    expect(block).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
  });

  it('the seed block comes after the subscription_plans table and uses only its original columns', () => {
    const create = sql.indexOf('CREATE TABLE IF NOT EXISTS subscription_plans');
    expect(create).toBeGreaterThan(-1);
    expect(sql.indexOf(MARKER)).toBeGreaterThan(create);
    const insert = block.slice(block.indexOf('INSERT INTO subscription_plans'), block.indexOf('DO NOTHING'));
    for (const col of ['product_line', 'price_3year', 'is_public']) expect(insert).not.toContain(col);
  });

  it('the production setup copies platform_limits before the plan limits', () => {
    const sh = readFileSync('scripts/setup-khatario-production.sh', 'utf8');
    expect(sh.indexOf('platform_limits')).toBeGreaterThan(-1);
    expect(sh.indexOf('platform_limits')).toBeLessThan(sh.indexOf('subscription_plan_limits'));
  });
});
