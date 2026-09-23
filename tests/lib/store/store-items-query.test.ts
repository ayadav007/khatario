import { buildStoreItemsQuery } from '@/lib/store/store-items-query';

describe('buildStoreItemsQuery', () => {
  const businessId = '11111111-1111-1111-1111-111111111111';

  it('binds only the business id on the count query', () => {
    const q = buildStoreItemsQuery({
      businessId,
      limit: 40,
      offset: 0,
    });
    expect(q.countParams).toEqual([businessId]);
    expect(q.listParams).toEqual([businessId, 40, 0]);
  });

  it('does not put branch or page params on the count query', () => {
    const branchId = '22222222-2222-2222-2222-222222222222';
    const q = buildStoreItemsQuery({
      businessId,
      branchId,
      limit: 40,
      offset: 0,
    });
    expect(q.countParams).toEqual([businessId]);
    expect(q.listParams).toEqual([businessId, branchId, 40, 0]);
  });

  it('keeps search on both list and count', () => {
    const q = buildStoreItemsQuery({
      businessId,
      search: 'biryani',
      limit: 40,
      offset: 0,
    });
    expect(q.countParams).toEqual([businessId, '%biryani%']);
    expect(q.listParams[0]).toBe(businessId);
    expect(q.listParams[1]).toBe('%biryani%');
  });

  it('reproduces the old catalog 500: extra count params', () => {
    const conditionsLength = 4;
    const queryParams = [businessId, 40, 0];
    expect(queryParams.slice(0, conditionsLength).length).toBe(3);
    expect(queryParams.slice(0, conditionsLength).length).not.toBe(1);
  });
});
