/**
 * Module-subscription reads follow whatever the test configured on the mocked
 * `getBusinessSubscription`, as a single billing-module row on a billing-only business.
 */
jest.mock('@/lib/subscription/module-subscriptions', () => {
  const actual = jest.requireActual('@/lib/subscription/module-subscriptions');
  const { isModuleSubscriptionOperational } = jest.requireActual(
    '@/lib/subscription/module-operational-check',
  );
  const rowsFor = async (businessId: string) => {
    const { getBusinessSubscription } = require('@/lib/subscription');
    const sub = await getBusinessSubscription(businessId);
    return sub ? [{ ...sub, module_key: sub.module_key ?? 'billing' }] : [];
  };
  return {
    ...actual,
    getModuleSubscriptions: jest.fn(rowsFor),
    getOperationalModuleSubscriptions: jest.fn(async (businessId: string) =>
      (await rowsFor(businessId)).filter(isModuleSubscriptionOperational),
    ),
    getPrimaryModuleSubscription: jest.fn(async (businessId: string) =>
      (await rowsFor(businessId))[0] ?? null,
    ),
    getModuleSubscription: jest.fn(async (businessId: string, moduleKey: string) =>
      (await rowsFor(businessId)).find((r) => r.module_key === moduleKey) ?? null,
    ),
    isBusinessOperational: jest.fn(async (businessId: string) =>
      (await rowsFor(businessId)).some(isModuleSubscriptionOperational),
    ),
  };
});

jest.mock('@/lib/business-modules', () => {
  const actual = jest.requireActual('@/lib/business-modules');
  return {
    ...actual,
    getBusinessPlatformContext: jest.fn(async () => ({
      primaryModule: 'billing',
      enabledModules: ['billing'],
      defaultHomePath: '/dashboard',
    })),
  };
});

export {};
