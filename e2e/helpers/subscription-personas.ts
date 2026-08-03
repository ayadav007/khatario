import type { APIRequestContext, Page } from '@playwright/test';
import { withDbClient, deleteBusinessCascade } from './db';

export type PersonaKind = 'hr' | 'billing' | 'connect' | 'multi';

export type TestPersona = {
  kind: PersonaKind;
  phone: string;
  password: string;
  businessId: string;
  label: string;
};

const PASSWORD = process.env.E2E_PERSONA_PASSWORD || 'E2E_Sub_audit!2026';

function phoneFor(kind: PersonaKind, runId: number): string {
  const suffix: Record<PersonaKind, string> = {
    hr: '1',
    billing: '2',
    connect: '3',
    multi: '4',
  };
  return `88${String(runId).slice(-8)}${suffix[kind]}`;
}

async function signupPersona(
  request: APIRequestContext,
  baseUrl: string,
  kind: PersonaKind,
  runId: number,
): Promise<TestPersona> {
  const phone = phoneFor(kind, runId);
  const productLine = kind === 'multi' ? 'billing' : kind;
  const label = `E2E ${kind.toUpperCase()} ${runId}`;

  const res = await request.post(`${baseUrl}/api/signup`, {
    data: {
      businessName: label,
      businessType: 'retail',
      industry: 'services',
      userName: 'E2E Admin',
      userPhone: phone,
      password: PASSWORD,
      productLine,
    },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok()) {
    throw new Error(`Signup ${kind} failed ${res.status()}: ${JSON.stringify(body)}`);
  }

  const businessId = body.businessId as string;
  if (!businessId) throw new Error(`Signup ${kind} missing businessId`);

  if (kind === 'multi') {
    const loginRes = await request.post(`${baseUrl}/api/auth/login`, {
      data: { phone, password: PASSWORD },
    });
    if (!loginRes.ok()) {
      throw new Error(`Login multi persona failed: ${await loginRes.text()}`);
    }
    const addHr = await request.post(`${baseUrl}/api/subscriptions/upgrade`, {
      data: {
        business_id: businessId,
        plan_id: 'hr_trial',
        module_key: 'hr',
        billing_cycle: 'monthly',
        payment_method: 'e2e',
      },
    });
    if (!addHr.ok()) {
      throw new Error(`Add HR to multi failed: ${await addHr.text()}`);
    }
  }

  return { kind, phone, password: PASSWORD, businessId, label };
}

export async function provisionPersonas(
  request: APIRequestContext,
  baseUrl: string,
): Promise<{ personas: TestPersona[]; runId: number; cleanup: () => Promise<void> }> {
  const runId = Date.now();
  const kinds: PersonaKind[] = ['hr', 'billing', 'connect', 'multi'];
  const personas: TestPersona[] = [];

  for (const kind of kinds) {
    personas.push(await signupPersona(request, baseUrl, kind, runId));
  }

  return {
    personas,
    runId,
    cleanup: async () => {
      for (const p of personas) {
        await deleteBusinessCascade(p.businessId).catch(() => {});
      }
    },
  };
}

/** Seed session cookies via API (faster; avoids UI rate limits). */
export async function seedPersonaSession(
  page: Page,
  api: APIRequestContext,
  baseUrl: string,
  persona: TestPersona,
): Promise<void> {
  const res = await api.post(`${baseUrl}/api/auth/login`, {
    data: { phone: persona.phone, password: persona.password },
  });
  if (!res.ok()) {
    throw new Error(`API login ${persona.kind} failed: ${await res.text()}`);
  }
  const state = await api.storageState();
  await page.context().addCookies(state.cookies);
  const home =
    persona.kind === 'hr'
      ? '/hr/dashboard'
      : persona.kind === 'connect'
        ? '/whatsapp/dashboard'
        : '/dashboard';
  await page.goto(`${baseUrl}${home}`);
  await page.waitForLoadState('networkidle').catch(() => {});
}

/** UI login for explicit login validation tests. */
export async function loginPersona(
  page: import('@playwright/test').Page,
  baseUrl: string,
  persona: TestPersona,
): Promise<void> {
  await page.goto(`${baseUrl}/login`);
  await page.getByPlaceholder(/enter your phone/i).waitFor({ state: 'visible', timeout: 90000 });
  await page.getByPlaceholder(/enter your phone/i).fill(persona.phone);
  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByPlaceholder(/enter your password/i).waitFor({ state: 'visible', timeout: 15000 });
  await page.getByPlaceholder(/enter your password/i).fill(persona.password);
  await page.getByRole('button', { name: /login/i }).click();
  await page.waitForURL(
    (url) => url.pathname !== '/login' && !url.pathname.startsWith('/login/'),
    { timeout: 45000 },
  );
}

export async function getEnabledModules(
  businessId: string,
): Promise<string[]> {
  return withDbClient(async (c) => {
    const r = await c.query<{ module_key: string }>(
      `SELECT module_key FROM business_modules
       WHERE business_id = $1 AND enabled = true ORDER BY module_key`,
      [businessId],
    );
    return r.rows.map((x) => x.module_key);
  });
}
