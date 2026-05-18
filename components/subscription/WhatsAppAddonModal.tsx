'use client';

import { useState, useEffect } from 'react';
import { X, Check, Loader2, Lock, MessageSquare, Send } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';

interface WhatsAppAddon {
  id: string;
  name: string;
  display_name: string;
  description: string;
  price_monthly: number;
  currency: string;
  features: string[];
  isActive?: boolean;
  activeAddon?: any;
}

interface WhatsAppAddonModalProps {
  addonType?: 'whatsapp_bot' | 'whatsapp_send_message' | 'all';
  onClose: () => void;
  onPurchaseSuccess?: () => void;
}

export function WhatsAppAddonModal({
  addonType = 'all',
  onClose,
  onPurchaseSuccess,
}: WhatsAppAddonModalProps) {
  const { business } = useAuth();
  const toast = useToastContext();
  const [addons, setAddons] = useState<WhatsAppAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);

  useEffect(() => {
    fetchAddons();
  }, []);

  async function fetchAddons() {
    if (!business?.id) return;

    try {
      const response = await fetch(`/api/subscriptions/addons?business_id=${business.id}`);
      if (response.ok) {
        const data = await response.json();
        let availableAddons = data.addons || [];

        // Filter by addonType if specified
        if (addonType !== 'all') {
          availableAddons = availableAddons.filter((a: WhatsAppAddon) => a.id === addonType);
        }

        setAddons(availableAddons);
      }
    } catch (error) {
      console.error('Error fetching addons:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handlePurchase(addonId: string) {
    if (!business?.id) return;

    setPurchasing(addonId);
    try {
      const response = await fetch(`/api/subscriptions/addons/${addonId}/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        const addonType = data.addon.addon_type;
        if (addonType === 'whatsapp_bot') {
          toast.success('Successfully purchased WhatsApp Bot add-on! All WhatsApp features (Conversations, Bot Rules, and Send Message) are now unlocked.');
        } else {
          toast.success('Successfully purchased WhatsApp add-on!');
        }
        await fetchAddons(); // Refresh addons list first
        // Small delay to ensure state propagates
        setTimeout(() => {
          onPurchaseSuccess?.(); // Then trigger parent refresh
        }, 200);
      } else {
        toast.error(data.error || 'Failed to purchase add-on');
      }
    } catch (error: any) {
      console.error('Error purchasing addon:', error);
      toast.error('Failed to purchase add-on. Please try again.');
    } finally {
      setPurchasing(null);
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4">
          <div className="flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-3">
            <MessageSquare className="w-6 h-6 text-primary-600" />
            <h2 className="text-2xl font-bold text-gray-900">WhatsApp Add-ons</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-gray-600 mb-6">
            Unlock advanced WhatsApp features to enhance your customer communication.
          </p>

          {addons.map((addon) => (
            <div
              key={addon.id}
              className={`border rounded-lg p-6 ${
                addon.isActive ? 'border-green-500 bg-green-50' : 'border-gray-200'
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-xl font-semibold text-gray-900">
                      {addon.display_name}
                    </h3>
                    {addon.isActive && (
                      <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-gray-600 mb-4">{addon.description}</p>

                  <div className="mb-4">
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold text-gray-900">
                        ₹{addon.price_monthly}
                      </span>
                      <span className="text-gray-600">/month</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-medium text-gray-900">Features:</h4>
                    <ul className="space-y-1">
                      {addon.features.map((feature, idx) => (
                        <li key={idx} className="flex items-center gap-2 text-gray-700">
                          <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              <button
                onClick={() => handlePurchase(addon.id)}
                disabled={addon.isActive || purchasing === addon.id}
                className={`w-full py-3 px-4 rounded-lg font-medium transition-colors ${
                  addon.isActive
                    ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                    : purchasing === addon.id
                    ? 'bg-primary-300 text-white cursor-wait'
                    : 'bg-primary-600 text-white hover:bg-primary-700'
                }`}
              >
                {addon.isActive ? (
                  <>
                    <Check className="w-5 h-5 inline mr-2" />
                    Active
                  </>
                ) : purchasing === addon.id ? (
                  <>
                    <Loader2 className="w-5 h-5 inline mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Lock className="w-5 h-5 inline mr-2" />
                    Purchase Add-on
                  </>
                )}
              </button>
            </div>
          ))}

          {addons.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No add-ons available at this time.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t bg-gray-50">
          <p className="text-sm text-gray-600 text-center">
            Add-ons are billed monthly and can be cancelled anytime.
          </p>
        </div>
      </div>
    </div>
  );
}

