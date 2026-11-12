import fs from 'fs';
import path from 'path';
import { buildMoreMenuSections } from '@/lib/more-navigation';
import { PLATFORM_MODULES } from '@/lib/platform-modules';

/**
 * The phone's route coverage test (phone/test/route_coverage_test.dart) walks the hrefs listed in
 * phone/test/fixtures/more_hrefs.dart. If the More menu gains a link, this fails until the fixture has it.
 */
describe('phone More-menu fixture', () => {
  it('lists every href the More menu can show', () => {
    const sections = buildMoreMenuSections({
      isSupplier: true,
      warehousesEnabled: true,
      hasCapability: () => true,
      checkCapability: () => ({ allowed: true }),
      enabledModules: [...PLATFORM_MODULES],
      supplierHubVisible: true,
    });
    const hrefs = [...new Set(sections.flatMap((s) => s.items.map((i) => i.href)))];
    expect(hrefs.length).toBeGreaterThan(50);

    const fixture = fs.readFileSync(path.join(process.cwd(), 'phone/test/fixtures/more_hrefs.dart'), 'utf8');
    const missing = hrefs.filter((h) => !fixture.includes(`'${h}'`));
    expect(missing).toEqual([]);
  });
});
