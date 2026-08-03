'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  MapPin, Plus, Trash2, Loader2, ChevronDown, ChevronUp, Save,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import clsx from 'clsx';

interface DeliveryCharge {
  min_distance_km: number;
  max_distance_km: number | null;
  charge: number;
  free_above_amount: number | null;
}

interface DeliveryZone {
  id?: string;
  branch_id: string;
  branch_name: string;
  location_lat: number | null;
  location_lng: number | null;
  location_address: string | null;
  delivery_mode: 'radius' | 'pincode' | 'all_india';
  delivery_radius_km: number;
  serviceable_pincodes: string[];
  allow_pickup: boolean;
  is_active: boolean;
  charges: DeliveryCharge[];
}

interface Branch {
  id: string;
  name: string;
}

interface DeliveryZoneEditorProps {
  businessId: string;
}

export function DeliveryZoneEditor({ businessId }: DeliveryZoneEditorProps) {
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expandedBranch, setExpandedBranch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/settings/online-store/delivery?business_id=${businessId}`,
        { credentials: 'include' },
      );
      if (res.ok) {
        const data = await res.json();
        setZones(data.zones ?? []);
        setBranches(data.branches ?? []);
      }
    } catch {
      setError('Failed to load delivery zones');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const unconfiguredBranches = branches.filter(
    (b) => !zones.some((z) => z.branch_id === b.id),
  );

  const addBranch = useCallback(
    (branch: Branch) => {
      const newZone: DeliveryZone = {
        branch_id: branch.id,
        branch_name: branch.name,
        location_lat: null,
        location_lng: null,
        location_address: null,
        delivery_mode: 'radius',
        delivery_radius_km: 10,
        serviceable_pincodes: [],
        allow_pickup: true,
        is_active: true,
        charges: [
          { min_distance_km: 0, max_distance_km: 5, charge: 0, free_above_amount: null },
          { min_distance_km: 5, max_distance_km: 10, charge: 30, free_above_amount: 500 },
        ],
      };
      setZones((prev) => [...prev, newZone]);
      setExpandedBranch(branch.id);
    },
    [],
  );

  const updateZone = useCallback(
    (branchId: string, updates: Partial<DeliveryZone>) => {
      setZones((prev) =>
        prev.map((z) =>
          z.branch_id === branchId ? { ...z, ...updates } : z,
        ),
      );
    },
    [],
  );

  const saveZone = useCallback(
    async (zone: DeliveryZone) => {
      setSaving(zone.branch_id);
      setError(null);
      try {
        const res = await fetch('/api/settings/online-store/delivery', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            business_id: businessId,
            branch_id: zone.branch_id,
            location_lat: zone.location_lat,
            location_lng: zone.location_lng,
            location_address: zone.location_address,
            delivery_mode: zone.delivery_mode,
            delivery_radius_km: zone.delivery_radius_km,
            serviceable_pincodes: zone.serviceable_pincodes,
            allow_pickup: zone.allow_pickup,
            is_active: zone.is_active,
            charges: zone.charges,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || 'Failed to save');
        }
      } catch {
        setError('Failed to save delivery zone');
      } finally {
        setSaving(null);
      }
    },
    [businessId],
  );

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {zones.map((zone) => {
        const isExpanded = expandedBranch === zone.branch_id;
        return (
          <Card key={zone.branch_id} className="overflow-hidden">
            <button
              onClick={() =>
                setExpandedBranch(isExpanded ? null : zone.branch_id)
              }
              className="flex w-full items-center justify-between px-5 py-4 text-left"
            >
              <div className="flex items-center gap-3">
                <MapPin className="h-4 w-4 text-gray-400" />
                <div>
                  <span className="text-sm font-semibold text-gray-900">
                    {zone.branch_name}
                  </span>
                  <span className="ml-2 text-xs text-gray-400">
                    {zone.delivery_mode === 'radius'
                      ? `${zone.delivery_radius_km}km radius`
                      : zone.delivery_mode === 'pincode'
                        ? `${zone.serviceable_pincodes.length} pincodes`
                        : 'All India'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={clsx(
                    'h-2 w-2 rounded-full',
                    zone.is_active ? 'bg-green-500' : 'bg-gray-300',
                  )}
                />
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-gray-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-gray-400" />
                )}
              </div>
            </button>

            {isExpanded ? (
              <div className="border-t border-gray-100 px-5 py-4 space-y-4">
                {/* Delivery mode */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-2">
                    Delivery Mode
                  </label>
                  <div className="flex gap-2">
                    {(['radius', 'pincode', 'all_india'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => updateZone(zone.branch_id, { delivery_mode: mode })}
                        className={clsx(
                          'rounded-lg px-3 py-2 text-xs font-medium transition-colors',
                          zone.delivery_mode === mode
                            ? 'bg-gray-900 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                        )}
                      >
                        {mode === 'radius'
                          ? 'By Radius'
                          : mode === 'pincode'
                            ? 'By Pincode'
                            : 'All India'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Radius setting */}
                {zone.delivery_mode === 'radius' ? (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Delivery Radius (km)
                    </label>
                    <input
                      type="number"
                      value={zone.delivery_radius_km}
                      onChange={(e) =>
                        updateZone(zone.branch_id, {
                          delivery_radius_km: parseInt(e.target.value) || 0,
                        })
                      }
                      min="1"
                      className="w-28 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    />
                  </div>
                ) : null}

                {/* Location */}
                {zone.delivery_mode === 'radius' ? (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Branch Address
                    </label>
                    <input
                      type="text"
                      value={zone.location_address ?? ''}
                      onChange={(e) =>
                        updateZone(zone.branch_id, {
                          location_address: e.target.value || null,
                        })
                      }
                      placeholder="e.g. Shop 12, MG Road, Mumbai"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    />
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Latitude</label>
                        <input
                          type="number"
                          step="0.0000001"
                          value={zone.location_lat ?? ''}
                          onChange={(e) =>
                            updateZone(zone.branch_id, {
                              location_lat: e.target.value ? parseFloat(e.target.value) : null,
                            })
                          }
                          placeholder="19.0760"
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Longitude</label>
                        <input
                          type="number"
                          step="0.0000001"
                          value={zone.location_lng ?? ''}
                          onChange={(e) =>
                            updateZone(zone.branch_id, {
                              location_lng: e.target.value ? parseFloat(e.target.value) : null,
                            })
                          }
                          placeholder="72.8777"
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Pincodes */}
                {zone.delivery_mode === 'pincode' ? (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Serviceable Pincodes
                    </label>
                    <textarea
                      value={zone.serviceable_pincodes.join(', ')}
                      onChange={(e) =>
                        updateZone(zone.branch_id, {
                          serviceable_pincodes: e.target.value
                            .split(/[,\s]+/)
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="400001, 400002, 400003"
                      rows={3}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Comma-separated pincode list
                    </p>
                  </div>
                ) : null}

                {/* Pickup toggle */}
                <label className="flex items-center gap-3 cursor-pointer">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={zone.allow_pickup}
                    onClick={() =>
                      updateZone(zone.branch_id, {
                        allow_pickup: !zone.allow_pickup,
                      })
                    }
                    className={clsx(
                      'relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors',
                      zone.allow_pickup ? 'bg-green-500' : 'bg-gray-200',
                    )}
                  >
                    <span
                      className={clsx(
                        'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition',
                        zone.allow_pickup ? 'translate-x-4' : 'translate-x-0',
                      )}
                    />
                  </button>
                  <span className="text-sm text-gray-700">Allow self-pickup</span>
                </label>

                {/* Active toggle */}
                <label className="flex items-center gap-3 cursor-pointer">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={zone.is_active}
                    onClick={() =>
                      updateZone(zone.branch_id, {
                        is_active: !zone.is_active,
                      })
                    }
                    className={clsx(
                      'relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors',
                      zone.is_active ? 'bg-green-500' : 'bg-gray-200',
                    )}
                  >
                    <span
                      className={clsx(
                        'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition',
                        zone.is_active ? 'translate-x-4' : 'translate-x-0',
                      )}
                    />
                  </button>
                  <span className="text-sm text-gray-700">Active</span>
                </label>

                {/* Delivery charges */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-gray-500">
                      Delivery Charges
                    </label>
                    <button
                      onClick={() =>
                        updateZone(zone.branch_id, {
                          charges: [
                            ...zone.charges,
                            {
                              min_distance_km: zone.charges.length > 0
                                ? (zone.charges[zone.charges.length - 1].max_distance_km ?? 0)
                                : 0,
                              max_distance_km: null,
                              charge: 0,
                              free_above_amount: null,
                            },
                          ],
                        })
                      }
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                    >
                      <Plus className="h-3 w-3" /> Add tier
                    </button>
                  </div>

                  {zone.charges.length > 0 ? (
                    <div className="space-y-2">
                      {zone.charges.map((c, i) => (
                        <div
                          key={i}
                          className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
                        >
                          <span className="text-xs text-gray-500 w-8">
                            {c.min_distance_km}km
                          </span>
                          <span className="text-xs text-gray-400">to</span>
                          <input
                            type="number"
                            value={c.max_distance_km ?? ''}
                            onChange={(e) => {
                              const newCharges = [...zone.charges];
                              newCharges[i] = {
                                ...c,
                                max_distance_km: e.target.value
                                  ? parseInt(e.target.value)
                                  : null,
                              };
                              updateZone(zone.branch_id, { charges: newCharges });
                            }}
                            placeholder="any"
                            className="w-16 rounded border border-gray-200 px-2 py-1 text-xs"
                          />
                          <span className="text-xs text-gray-400">km =</span>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-gray-500">&#x20B9;</span>
                            <input
                              type="number"
                              value={c.charge}
                              onChange={(e) => {
                                const newCharges = [...zone.charges];
                                newCharges[i] = {
                                  ...c,
                                  charge: parseFloat(e.target.value) || 0,
                                };
                                updateZone(zone.branch_id, { charges: newCharges });
                              }}
                              className="w-16 rounded border border-gray-200 px-2 py-1 text-xs"
                            />
                          </div>
                          <span className="text-xs text-gray-400 mx-1">free above</span>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-gray-500">&#x20B9;</span>
                            <input
                              type="number"
                              value={c.free_above_amount ?? ''}
                              onChange={(e) => {
                                const newCharges = [...zone.charges];
                                newCharges[i] = {
                                  ...c,
                                  free_above_amount: e.target.value
                                    ? parseFloat(e.target.value)
                                    : null,
                                };
                                updateZone(zone.branch_id, { charges: newCharges });
                              }}
                              placeholder="none"
                              className="w-16 rounded border border-gray-200 px-2 py-1 text-xs"
                            />
                          </div>
                          <button
                            onClick={() => {
                              const newCharges = zone.charges.filter((_, j) => j !== i);
                              updateZone(zone.branch_id, { charges: newCharges });
                            }}
                            className="ml-auto text-gray-400 hover:text-red-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">
                      Free delivery (no charge tiers configured)
                    </p>
                  )}
                </div>

                {/* Save button */}
                <div className="flex justify-end pt-2">
                  <Button
                    onClick={() => saveZone(zone)}
                    disabled={saving === zone.branch_id}
                    size="sm"
                  >
                    {saving === zone.branch_id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-1.5">Save</span>
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        );
      })}

      {/* Add branch button */}
      {unconfiguredBranches.length > 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 mb-2">
            Add delivery zone for:
          </p>
          <div className="flex flex-wrap gap-2">
            {unconfiguredBranches.map((b) => (
              <button
                key={b.id}
                onClick={() => addBranch(b)}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Plus className="h-3.5 w-3.5" />
                {b.name}
              </button>
            ))}
          </div>
        </div>
      ) : branches.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">
          No branches found. Create branches in Settings &gt; Branches first.
        </p>
      ) : null}
    </div>
  );
}
