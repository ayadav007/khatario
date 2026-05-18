'use client';

import { useState, useEffect } from 'react';
import { X, Plus, Tag } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Toast, ToastType } from '@/components/ui/Toast';

interface Label {
  id: string;
  name: string;
  color: string;
}

interface LabelAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
  businessId: string;
  currentLabels: Label[];
  onUpdate: () => void;
}

export function LabelAssignmentModal({
  isOpen,
  onClose,
  conversationId,
  businessId,
  currentLabels,
  onUpdate
}: LabelAssignmentModalProps) {
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#25D366');
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const currentLabelIds = new Set(currentLabels.map(l => l.id));

  useEffect(() => {
    if (isOpen) {
      fetchLabels();
    }
  }, [isOpen, businessId]);

  const fetchLabels = async () => {
    try {
      const res = await fetch(`/api/whatsapp/labels?business_id=${businessId}`);
      const data = await res.json();
      setAllLabels(data.labels || []);
    } catch (error) {
      console.error('Error fetching labels:', error);
    }
  };

  const toggleLabel = async (labelId: string) => {
    const isAssigned = currentLabelIds.has(labelId);
    setLoading(true);

    try {
      const url = `/api/whatsapp/conversations/${conversationId}/labels`;
      const method = isAssigned ? 'DELETE' : 'POST';
      
      // Both POST and DELETE need business_id in query params
      const queryParams = `?business_id=${businessId}${isAssigned ? `&label_id=${labelId}` : ''}`;
      
      const res = await fetch(`${url}${queryParams}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: isAssigned ? undefined : JSON.stringify({ label_id: labelId })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update label');
      }

      onUpdate();
      await fetchLabels();
    } catch (error: any) {
      setToast({ message: error.message || 'Failed to update label', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const createLabel = async () => {
    if (!newLabelName.trim()) return;

    setCreatingLabel(true);
    try {
      const res = await fetch('/api/whatsapp/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          name: newLabelName.trim(),
          color: newLabelColor
        })
      });

      if (!res.ok) throw new Error('Failed to create label');

      setNewLabelName('');
      await fetchLabels();
    } catch (error: any) {
      setToast({ message: error.message || 'Failed to create label', type: 'error' });
    } finally {
      setCreatingLabel(false);
    }
  };

  if (!isOpen) return null;

  const presetColors = [
    '#25D366', '#FF3B30', '#FF9500', '#FFCC00', '#34C759',
    '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#8E8E93'
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold">Manage Labels</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 max-h-[60vh] overflow-y-auto">
          {/* Create New Label */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                placeholder="Label name"
                className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
                onKeyPress={(e) => e.key === 'Enter' && createLabel()}
              />
              <input
                type="color"
                value={newLabelColor}
                onChange={(e) => setNewLabelColor(e.target.value)}
                className="w-12 h-10 rounded cursor-pointer"
              />
            </div>
            <div className="flex gap-1 mb-2">
              {presetColors.map((color) => (
                <button
                  key={color}
                  onClick={() => setNewLabelColor(color)}
                  className="w-8 h-8 rounded-full border-2 border-gray-300 hover:border-gray-400"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <Button
              onClick={createLabel}
              disabled={!newLabelName.trim() || creatingLabel}
              size="sm"
            >
              <Plus className="w-4 h-4 mr-1" />
              Create Label
            </Button>
          </div>

          {/* Existing Labels */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Assign Labels</h4>
            {allLabels.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">
                No labels created yet. Create one above.
              </p>
            ) : (
              <div className="space-y-2">
                {allLabels.map((label) => {
                  const isAssigned = currentLabelIds.has(label.id);
                  return (
                    <button
                      key={label.id}
                      onClick={() => toggleLabel(label.id)}
                      disabled={loading}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border-2 transition-colors ${
                        isAssigned
                          ? 'bg-gray-50 border-gray-300'
                          : 'bg-white border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div
                        className="w-4 h-4 rounded-full flex-shrink-0"
                        style={{ backgroundColor: label.color }}
                      />
                      <span className="flex-1 text-left text-sm">{label.name}</span>
                      {isAssigned && (
                        <div className="w-5 h-5 rounded-full bg-primary-600 flex items-center justify-center">
                          <span className="text-white text-xs">✓</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

