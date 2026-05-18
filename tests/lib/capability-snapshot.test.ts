/**
 * @jest-environment jsdom
 * Unit tests for capability-snapshot (requires DOM for localStorage)
 */
import {
  saveCapabilitySnapshot,
  loadCapabilitySnapshot,
  clearCapabilitySnapshot,
  isSnapshotExpired,
  type CapabilitySnapshot,
} from '@/lib/capability-snapshot';

// jsdom provides localStorage
beforeEach(() => {
  localStorage.clear();
});

const mockSnapshot: CapabilitySnapshot = {
  businessId: 'b1',
  userId: 'u1',
  permissions: {
    invoices: {
      can_view: true,
      can_add: true,
      can_modify: true,
      can_delete: true,
      can_share: true,
    },
  },
  isPrimaryAdmin: true,
  subscription: {
    id: 'sub1',
    business_id: 'b1',
    plan_id: 'p1',
    status: 'active',
    plan_name: 'Pro',
  },
  addons: [],
  enabledFeatures: ['sales_invoices', 'sales_estimates'],
  timestamp: Date.now(),
};

describe('capability-snapshot', () => {
  describe('saveCapabilitySnapshot', () => {
    it('saves snapshot to localStorage with correct key', () => {
      saveCapabilitySnapshot(mockSnapshot);
      const key = 'offline_capability_b1_u1';
      expect(storage[key]).toBeDefined();
      const parsed = JSON.parse(storage[key]);
      expect(parsed.businessId).toBe('b1');
      expect(parsed.userId).toBe('u1');
      expect(parsed.isPrimaryAdmin).toBe(true);
      expect(parsed.enabledFeatures).toEqual(['sales_invoices', 'sales_estimates']);
    });
  });

  describe('loadCapabilitySnapshot', () => {
    it('returns null when no snapshot exists', () => {
      expect(loadCapabilitySnapshot('b1', 'u1')).toBeNull();
    });

    it('returns snapshot when it exists', () => {
      saveCapabilitySnapshot(mockSnapshot);
      const loaded = loadCapabilitySnapshot('b1', 'u1');
      expect(loaded).not.toBeNull();
      expect(loaded!.businessId).toBe('b1');
      expect(loaded!.userId).toBe('u1');
      expect(loaded!.isPrimaryAdmin).toBe(true);
    });

    it('returns null for wrong tenant', () => {
      saveCapabilitySnapshot(mockSnapshot);
      expect(loadCapabilitySnapshot('b2', 'u1')).toBeNull();
      expect(loadCapabilitySnapshot('b1', 'u2')).toBeNull();
    });
  });

  describe('clearCapabilitySnapshot', () => {
    it('removes snapshot for tenant', () => {
      saveCapabilitySnapshot(mockSnapshot);
      expect(loadCapabilitySnapshot('b1', 'u1')).not.toBeNull();
      clearCapabilitySnapshot('b1', 'u1');
      expect(loadCapabilitySnapshot('b1', 'u1')).toBeNull();
    });
  });

  describe('isSnapshotExpired', () => {
    it('returns false for fresh snapshot', () => {
      const fresh = { ...mockSnapshot, timestamp: Date.now() };
      expect(isSnapshotExpired(fresh)).toBe(false);
    });

    it('returns true for snapshot older than TTL', () => {
      const old = {
        ...mockSnapshot,
        timestamp: Date.now() - 25 * 60 * 60 * 1000,
      };
      expect(isSnapshotExpired(old)).toBe(true);
    });

    it('respects custom TTL', () => {
      const snapshot = {
        ...mockSnapshot,
        timestamp: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
      };
      expect(isSnapshotExpired(snapshot, 60 * 60 * 1000)).toBe(true); // 1h TTL
      expect(isSnapshotExpired(snapshot, 3 * 60 * 60 * 1000)).toBe(false); // 3h TTL
    });
  });
});
