import fs from 'fs';
import path from 'path';
import { test as setup } from '@playwright/test';
import { loginAsTestUser } from './fixtures/auth';

const authFile = path.join(__dirname, '.auth', 'auth.json');

setup('save logged-in storage state', async ({ page }) => {
  setup.setTimeout(180000);
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  await loginAsTestUser(page);
  await page.context().storageState({ path: authFile });
});
