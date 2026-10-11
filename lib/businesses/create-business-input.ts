export const ADD_BUSINESS_TYPES = [
  'retail',
  'wholesaler',
  'distributor',
  'manufacturer',
  'service',
  'other',
] as const;

export const ADD_BUSINESS_INDUSTRIES = [
  'pharmaceuticals',
  'textiles',
  'garments',
  'electronics',
  'food_beverages',
  'automotive',
  'construction',
  'services',
  'other',
] as const;

export type AddBusinessInput = {
  businessName: string;
  businessType: (typeof ADD_BUSINESS_TYPES)[number];
  industry: (typeof ADD_BUSINESS_INDUSTRIES)[number];
  businessModel: string | null;
};

export function parseAddBusinessInput(body: unknown): { ok: true; value: AddBusinessInput } | { ok: false; error: string } {
  if (body === null || typeof body !== 'object') {
    return { ok: false, error: 'Invalid request body' };
  }
  const raw = body as Record<string, unknown>;
  if ('business_id' in raw || 'user_id' in raw || 'userId' in raw) {
    return { ok: false, error: 'Business and user are taken from your login' };
  }
  const businessName = typeof raw.businessName === 'string' ? raw.businessName.trim() : '';
  const businessType = typeof raw.businessType === 'string' ? raw.businessType.trim() : '';
  const industry = typeof raw.industry === 'string' ? raw.industry.trim() : '';
  const businessModel = typeof raw.businessModel === 'string' && raw.businessModel.trim() ? raw.businessModel.trim() : null;

  if (businessName.length < 2 || businessName.length > 255) {
    return { ok: false, error: 'Enter a business name' };
  }
  if (!ADD_BUSINESS_TYPES.includes(businessType as AddBusinessInput['businessType'])) {
    return { ok: false, error: 'Choose a business type' };
  }
  if (!ADD_BUSINESS_INDUSTRIES.includes(industry as AddBusinessInput['industry'])) {
    return { ok: false, error: 'Choose an industry' };
  }
  if (businessModel && !['b2b', 'b2c', 'b2b2c', 'export', 'mixed'].includes(businessModel)) {
    return { ok: false, error: 'Choose a valid business model' };
  }

  return {
    ok: true,
    value: {
      businessName,
      businessType: businessType as AddBusinessInput['businessType'],
      industry: industry as AddBusinessInput['industry'],
      businessModel,
    },
  };
}
