import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');

function read(rel: string) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('WhatsApp flow routes', () => {
  it('list and generate sit behind withWhatsAppPremiumApi', () => {
    const list = read('app/api/whatsapp/flows/route.ts');
    expect(list).toMatch(/withWhatsAppPremiumApi/);
    expect(list).toMatch(/managePermission:\s*true/);
    const gen = read('app/api/whatsapp/flows/generate/route.ts');
    expect(gen).toMatch(/^export const POST = withWhatsAppPremiumApi/m);
    expect(gen).toMatch(/assertNotConnectAgentWrite/);
    expect(gen).toMatch(/createFlow/);
    expect(gen).not.toMatch(/status:\s*['"]published['"]/);
  });

  it('generate never reads business_id from the client body for auth', () => {
    const gen = read('app/api/whatsapp/flows/generate/route.ts');
    expect(gen).not.toMatch(/body\.business_id/);
    expect(gen).toMatch(/businessId/);
  });
});
