'use client';

import React, { useState, useEffect } from 'react';
import { X, Plus, Edit2, Trash2, Loader2, Tag } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Toast, ToastType } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/whatsapp/ConfirmDialog';

interface Label {
  id: string;
  name: string;
  color: string;
  created_at?: string;
  updated_at?: string;
}

interface LabelManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  businessId: string;
}

export function LabelManagerModal({
  isOpen,
  onClose,
  businessId
}: LabelManagerModalProps) {
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#25D366');
  const [editLabelName, setEditLabelName] = useState('');
  const [editLabelColor, setEditLabelColor] = useState('#25D366');
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Preset colors (similar to Interakt/AiSensy)
  const presetColors = [
    '#25D366', '#FF3B30', '#FF9500', '#FFCC00', '#34C759',
    '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#8E8E93',
    '#5AC8FA', '#FF9500', '#FFCC00', '#34C759', '#00C7BE'
  ];

  useEffect(() => {
    if (isOpen) {
      fetchLabels();
    }
  }, [isOpen, businessId]);

  const fetchLabels = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/labels?business_id=${businessId}`);
      if (res.ok) {
        const data = await res.json();
        setLabels(data.labels || []);
      }
    } catch (error) {
      console.error('Error fetching labels:', error);
      setToast({ message: 'Failed to fetch labels', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newLabelName.trim()) {
      setToast({ message: 'Label name is required', type: 'warning' });
      return;
    }

    setCreating(true);
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

      if (res.ok) {
        setNewLabelName('');
        setNewLabelColor('#25D366');
        await fetchLabels();
      } else {
        const error = await res.json();
        setToast({ message: error.error || 'Failed to create label', type: 'error' });
      }
    } catch (error: any) {
      console.error('Error creating label:', error);
      setToast({ message: error.message || 'Failed to create label', type: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const handleEditStart = (label: Label) => {
    setEditingId(label.id);
    setEditLabelName(label.name);
    setEditLabelColor(label.color);
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditLabelName('');
    setEditLabelColor('#25D366');
  };

  const handleUpdate = async (labelId: string) => {
    if (!editLabelName.trim()) {
      setToast({ message: 'Label name is required', type: 'warning' });
      return;
    }

    setUpdating(true);
    try {
      const res = await fetch(`/api/whatsapp/labels/${labelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          name: editLabelName.trim(),
          color: editLabelColor
        })
      });

      if (res.ok) {
        setEditingId(null);
        setEditLabelName('');
        setEditLabelColor('#25D366');
        await fetchLabels();
      } else {
        const error = await res.json();
        setToast({ message: error.error || 'Failed to update label', type: 'error' });
      }
    } catch (error: any) {
      console.error('Error updating label:', error);
      setToast({ message: error.message || 'Failed to update label', type: 'error' });
    } finally {
      setUpdating(false);
    }
  };

  const executeDeleteLabel = async (labelId: string) => {
    setDeletingId(labelId);
    try {
      const res = await fetch(`/api/whatsapp/labels/${labelId}?business_id=${businessId}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        await fetchLabels();
      } else {
        const error = await res.json();
        setToast({ message: error.error || 'Failed to delete label', type: 'error' });
      }
    } catch (error: any) {
      console.error('Error deleting label:', error);
      setToast({ message: error.message || 'Failed to delete label', type: 'error' });
    } finally {
      setDeletingId(null);
    }
  };

  const handleDelete = (labelId: string, labelName: string) => {
    setConfirmDialog({
      title: 'Confirm',
      message: `Delete label "${labelName}"? This will remove it from all conversations.`,
      onConfirm: () => {
        void executeDeleteLabel(labelId).finally(() => setConfirmDialog(null));
      },
    });
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-3">
            <Tag className="w-6 h-6 text-primary-600" />
            <h2 className="text-xl font-bold text-gray-900">Manage Labels</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Create New Label */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Create New Label</h3>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Label Name
                </label>
                <Input
                  type="text"
                  value={newLabelName}
                  onChange={(e) => setNewLabelName(e.target.value)}
                  placeholder="e.g., Priority, Follow-up"
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleCreate();
                    }
                  }}
                />
              </div>
              <div className="w-32">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={newLabelColor}
                    onChange={(e) => setNewLabelColor(e.target.value)}
                    className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
                  />
                  <Input
                    type="text"
                    value={newLabelColor}
                    onChange={(e) => setNewLabelColor(e.target.value)}
                    className="w-20 text-xs font-mono"
                    placeholder="#25D366"
                  />
                </div>
              </div>
              <Button
                onClick={handleCreate}
                disabled={creating || !newLabelName.trim()}
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" />
                    Create
                  </>
                )}
              </Button>
            </div>
            
            {/* Preset Colors */}
            <div className="mt-3">
              <label className="block text-xs text-gray-600 mb-2">Preset Colors:</label>
              <div className="flex items-center gap-2 flex-wrap">
                {presetColors.map((color) => (
                  <button
                    key={color}
                    onClick={() => setNewLabelColor(color)}
                    className={`w-8 h-8 rounded border-2 transition-all ${
                      newLabelColor === color ? 'border-gray-900 scale-110' : 'border-gray-300 hover:border-gray-500'
                    }`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Labels List */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">All Labels ({labels.length})</h3>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : labels.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Tag className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>No labels created yet</p>
                <p className="text-sm mt-1">Create your first label above</p>
              </div>
            ) : (
              <div className="space-y-2">
                {labels.map((label) => (
                  <div
                    key={label.id}
                    className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    {editingId === label.id ? (
                      <>
                        {/* Edit Mode */}
                        <div
                          className="w-6 h-6 rounded-full flex-shrink-0"
                          style={{ backgroundColor: editLabelColor }}
                        />
                        <Input
                          type="text"
                          value={editLabelName}
                          onChange={(e) => setEditLabelName(e.target.value)}
                          className="flex-1"
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              handleUpdate(label.id);
                            } else if (e.key === 'Escape') {
                              handleEditCancel();
                            }
                          }}
                          autoFocus
                        />
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={editLabelColor}
                            onChange={(e) => setEditLabelColor(e.target.value)}
                            className="w-8 h-8 rounded border border-gray-300 cursor-pointer"
                          />
                          <Button
                            size="sm"
                            onClick={() => handleUpdate(label.id)}
                            disabled={updating}
                          >
                            {updating ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              'Save'
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={handleEditCancel}
                            disabled={updating}
                          >
                            Cancel
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        {/* View Mode */}
                        <div
                          className="w-6 h-6 rounded-full flex-shrink-0"
                          style={{ backgroundColor: label.color }}
                        />
                        <div className="flex-1">
                          <span className="font-medium text-gray-900">{label.name}</span>
                          <span className="ml-2 text-xs text-gray-500 font-mono">{label.color}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleEditStart(label)}
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Edit label"
                          >
                            <Edit2 className="w-4 h-4 text-gray-600" />
                          </button>
                          <button
                            onClick={() => handleDelete(label.id, label.name)}
                            disabled={deletingId === label.id}
                            className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete label"
                          >
                            {deletingId === label.id ? (
                              <Loader2 className="w-4 h-4 animate-spin text-red-600" />
                            ) : (
                              <Trash2 className="w-4 h-4 text-red-600" />
                            )}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end p-6 border-t">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
      <ConfirmDialog
        isOpen={!!confirmDialog}
        title={confirmDialog?.title || ''}
        message={confirmDialog?.message || ''}
        variant="danger"
        confirmLabel="Confirm"
        onConfirm={() => {
          confirmDialog?.onConfirm();
        }}
        onCancel={() => setConfirmDialog(null)}
      />
    </div>
  );
}

