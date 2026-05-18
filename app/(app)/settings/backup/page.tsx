'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { 
  Download, Upload, Database, AlertCircle, Clock, CheckCircle, 
  Cloud, Calendar, Trash2, Eye, Link as LinkIcon, X, Save,
  RefreshCw, FileText, HardDrive, ChevronDown, ChevronUp
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { WIDE_PAGE_CONTENT_CLASS } from '@/lib/page-layout';

interface BackupHistory {
  id: string;
  backup_type: string;
  created_at: string;
  file_size: number;
  storage_location: string;
  status: string;
  record_counts: any;
}

interface Schedule {
  id: string;
  is_enabled: boolean;
  frequency: string;
  time_of_day: string;
  storage_destination: string;
  retention_days: number;
  last_run_at: string | null;
  next_run_at: string;
}

export default function BackupRestorePage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreMode, setRestoreMode] = useState<'replace_all' | 'merge_smart'>('replace_all');
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  
  // Cloud storage
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [showGoogleCredentialsModal, setShowGoogleCredentialsModal] = useState(false);
  const [googleCredentials, setGoogleCredentials] = useState({
    client_id: '',
    client_secret: '',
    redirect_uri: `${typeof window !== 'undefined' ? window.location.origin : ''}/api/cloud-storage/google/callback`,
  });
  
  // Scheduling
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    is_enabled: true,
    frequency: 'weekly',
    time_of_day: '02:00',
    day_of_week: 0,
    storage_destination: 'local',
    retention_days: 30,
  });
  
  // History
  const [history, setHistory] = useState<BackupHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState(false);

  useEffect(() => {
    if (business?.id) {
      loadCloudStatus();
      loadSchedule();
      loadHistory();
    }
  }, [business?.id]);

  async function loadCloudStatus() {
    try {
      const response = await fetch(`/api/cloud-storage/google/credentials?business_id=${business?.id}`);
      const data = await response.json();
      
      if (data.success && data.configured) {
        setGoogleConfigured(true);
        if (data.credentials?.is_active) {
          setGoogleConnected(true);
        }
      }

      // Also check URL params for connection success
      const params = new URLSearchParams(window.location.search);
      if (params.get('google_drive') === 'connected') {
        setGoogleConnected(true);
        setGoogleConfigured(true);
      }
    } catch (error) {
      console.error('Error loading cloud status:', error);
    }
  }

  async function loadSchedule() {
    try {
      const response = await fetch(`/api/backup/schedule?business_id=${business?.id}`);
      const data = await response.json();
      if (data.success && data.schedule) {
        setSchedule(data.schedule);
        setScheduleForm({
          is_enabled: data.schedule.is_enabled,
          frequency: data.schedule.frequency,
          time_of_day: data.schedule.time_of_day,
          day_of_week: data.schedule.day_of_week || 0,
          storage_destination: data.schedule.storage_destination,
          retention_days: data.schedule.retention_days,
        });
      }
    } catch (error) {
      console.error('Error loading schedule:', error);
    }
  }

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const response = await fetch(`/api/backup/history?business_id=${business?.id}&limit=10`);
      const data = await response.json();
      console.log('Backup history response:', data); // DEBUG
      if (data.success) {
        setHistory(data.backups);
        console.log('Loaded backups:', data.backups); // DEBUG
      } else {
        console.error('Failed to load history:', data); // DEBUG
      }
    } catch (error) {
      console.error('Error loading history:', error);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function handleCreateBackup() {
    if (!business?.id) return;

    setCreating(true);
    try {
      const response = await fetch('/api/backup/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          business_id: business.id,
          user_id: user?.id,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create backup');
      }

      // Download the backup file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `khatario_backup_${business.id}_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success('Backup created successfully!');
      loadHistory(); // Refresh history
    } catch (error: any) {
      console.error('Error creating backup:', error);
      toast.error('Failed to create backup: ' + error.message);
    } finally {
      setCreating(false);
    }
  }

  async function handlePreviewRestore() {
    if (!restoreFile) return;

    try {
      const fileContent = await restoreFile.text();
      const backup = JSON.parse(fileContent);

      const response = await fetch('/api/backup/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backup, restore_mode: restoreMode }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to preview backup');
      }

      setPreviewData(result);
      setShowPreview(true);
    } catch (error: any) {
      console.error('Error previewing backup:', error);
      toast.error('Failed to preview backup: ' + error.message);
    }
  }

  async function handleRestoreBackup() {
    if (!restoreFile || !confirm('Are you sure? This will modify your existing data.')) return;

    setRestoring(true);
    try {
      const fileContent = await restoreFile.text();
      const backup = JSON.parse(fileContent);

      const response = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          backup, 
          restore_mode: restoreMode,
          user_id: user?.id,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to restore backup');
      }

      toast.success('Backup restored successfully! Total records: ' + result.total_records);
      setShowPreview(false);
      setRestoreFile(null);
    } catch (error: any) {
      console.error('Error restoring backup:', error);
      toast.error('Failed to restore backup: ' + error.message);
    } finally {
      setRestoring(false);
    }
  }

  async function handleSaveGoogleCredentials() {
    if (!business?.id) return;

    if (!googleCredentials.client_id || !googleCredentials.client_secret) {
      toast.warning('Please enter both Client ID and Client Secret');
      return;
    }

    try {
      const response = await fetch('/api/cloud-storage/google/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          user_id: user?.id,
          ...googleCredentials,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save credentials');
      }

      toast.success('Google Drive credentials saved! You can now connect.');
      setShowGoogleCredentialsModal(false);
      setGoogleConfigured(true);
    } catch (error: any) {
      console.error('Error saving credentials:', error);
      toast.error('Failed to save credentials: ' + error.message);
    }
  }

  async function handleConnectGoogleDrive() {
    if (!business?.id) return;
    
    // Check if credentials are configured
    if (!googleConfigured) {
      setShowGoogleCredentialsModal(true);
      return;
    }

    setConnectingGoogle(true);
    window.location.href = `/api/cloud-storage/google/auth?business_id=${business.id}`;
  }

  async function handleDisconnectGoogleDrive() {
    if (!confirm('Disconnect Google Drive? Existing backups in Google Drive will not be deleted.')) return;

    try {
      const response = await fetch('/api/cloud-storage/google/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business?.id }),
      });

      if (!response.ok) {
        throw new Error('Failed to disconnect');
      }

      setGoogleConnected(false);
      toast.success('Google Drive disconnected successfully');
    } catch (error: any) {
      console.error('Error disconnecting:', error);
      toast.error('Failed to disconnect: ' + error.message);
    }
  }

  async function handleSaveSchedule() {
    if (!business?.id) return;

    try {
      const response = await fetch('/api/backup/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          user_id: user?.id,
          ...scheduleForm,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save schedule');
      }

      toast.success('Backup schedule saved successfully!');
      setShowScheduleForm(false);
      loadSchedule();
    } catch (error: any) {
      console.error('Error saving schedule:', error);
      toast.error('Failed to save schedule: ' + error.message);
    }
  }

  async function handleDeleteBackup(backupId: string) {
    if (!confirm('Delete this backup?')) return;

    try {
      const response = await fetch(`/api/backup/history?id=${backupId}&business_id=${business?.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete backup');
      }

      toast.success('Backup deleted successfully');
      loadHistory();
    } catch (error: any) {
      console.error('Error deleting backup:', error);
      toast.error('Failed to delete backup: ' + error.message);
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  return (
    <div className={`${WIDE_PAGE_CONTENT_CLASS} space-y-6 p-4 sm:p-6`}>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Backup & Restore</h1>
        <p className="text-text-secondary text-sm mt-1">
          Keep your data safe with automated backups and cloud storage
        </p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gradient-to-br from-primary-500 to-primary-600 rounded-xl shadow-lg p-6 text-white">
          <h2 className="text-xl font-bold mb-2">Create Backup Now</h2>
          <p className="text-primary-100 text-sm mb-4">
            Download complete business data backup
          </p>
          <button
            onClick={handleCreateBackup}
            disabled={creating}
            className="flex items-center space-x-2 px-6 py-3 bg-surface dark:bg-slate-900/70 text-primary-600 rounded-lg hover:bg-slate-50 transition disabled:opacity-50 font-semibold"
          >
            <Download className="w-5 h-5" />
            <span>{creating ? 'Creating...' : 'Create Backup'}</span>
          </button>
          {history.length > 0 && (
            <p className="text-primary-100 text-xs mt-3">
              Last backup: {new Date(history[0].created_at).toLocaleString()}
            </p>
          )}
        </div>

        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-6 text-white">
          <h2 className="text-xl font-bold mb-2">Restore Backup</h2>
          <p className="text-purple-100 text-sm mb-4">
            Upload and restore from backup file
          </p>
          <label className="flex items-center space-x-2 px-6 py-3 bg-surface dark:bg-slate-900/70 text-purple-600 rounded-lg hover:bg-purple-50 transition cursor-pointer font-semibold">
            <Upload className="w-5 h-5" />
            <span>Select Backup File</span>
            <input
              type="file"
              accept=".json"
              onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
              className="hidden"
            />
          </label>
          {restoreFile && (
            <p className="text-purple-100 text-xs mt-3 truncate">
              Selected: {restoreFile.name}
            </p>
          )}
        </div>
      </div>

      {/* Google Credentials Modal */}
      {showGoogleCredentialsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface dark:bg-slate-900/70 rounded-xl shadow-2xl max-w-2xl w-full">
            <div className="sticky top-0 bg-surface dark:bg-slate-900/70 border-b px-6 py-4 flex items-center justify-between rounded-t-xl">
              <h3 className="text-lg font-bold">Configure Google Drive</h3>
              <button onClick={() => setShowGoogleCredentialsModal(false)} className="text-text-muted hover:text-text-secondary">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="bg-slate-50 border border-primary-200 rounded-lg p-4">
                <h4 className="font-semibold text-primary-900 mb-2">Setup Instructions</h4>
                <ol className="text-sm text-primary-800 space-y-2 list-decimal list-inside">
                  <li>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="underline">Google Cloud Console</a></li>
                  <li>Create a new project or select existing</li>
                  <li>Enable <strong>Google Drive API</strong></li>
                  <li>Go to Credentials → Create OAuth 2.0 Client ID</li>
                  <li>Application type: <strong>Web application</strong></li>
                  <li>Add Authorized redirect URI: <code className="bg-surface dark:bg-slate-900/70 px-2 py-1 rounded">{googleCredentials.redirect_uri}</code></li>
                  <li>Copy Client ID and Client Secret below</li>
                </ol>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Client ID</label>
                <input
                  type="text"
                  value={googleCredentials.client_id}
                  onChange={(e) => setGoogleCredentials({...googleCredentials, client_id: e.target.value})}
                  placeholder="xxxxx.apps.googleusercontent.com"
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Client Secret</label>
                <input
                  type="password"
                  value={googleCredentials.client_secret}
                  onChange={(e) => setGoogleCredentials({...googleCredentials, client_secret: e.target.value})}
                  placeholder="Your client secret"
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Redirect URI (Read-only)</label>
                <input
                  type="text"
                  value={googleCredentials.redirect_uri}
                  readOnly
                  className="w-full px-3 py-2 border rounded-lg bg-gray-50 dark:bg-slate-800/40"
                />
                <p className="text-xs text-text-secondary mt-1">Copy this URL and add it to your Google Cloud Console</p>
              </div>

              <div className="flex items-center space-x-3 pt-4">
                <button
                  onClick={handleSaveGoogleCredentials}
                  className="flex-1 px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-semibold"
                >
                  Save & Continue
                </button>
                <button
                  onClick={() => setShowGoogleCredentialsModal(false)}
                  className="px-6 py-3 border border-border rounded-lg bg-surface hover:bg-gray-50 dark:hover:bg-slate-800/80"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Restore Preview Modal */}
      {showPreview && previewData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface dark:bg-slate-900/70 rounded-xl shadow-2xl max-w-3xl w-full max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 bg-surface dark:bg-slate-900/70 border-b px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">Restore Preview</h3>
              <button onClick={() => setShowPreview(false)} className="text-text-muted hover:text-text-secondary">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="bg-slate-50 border border-primary-200 rounded-lg p-4">
                <h4 className="font-semibold text-primary-900 mb-2">Backup Information</h4>
                <div className="text-sm text-primary-800 space-y-1">
                  <p>Version: {previewData.backup_info?.version}</p>
                  <p>Created: {new Date(previewData.backup_info?.created_at).toLocaleString()}</p>
                  <p>Total Records: {previewData.summary?.total_backup_records}</p>
                </div>
              </div>

              {previewData.warnings?.length > 0 && (
                <div className="space-y-2">
                  {previewData.warnings.map((warning: any, i: number) => (
                    <div key={i} className={`border rounded-lg p-3 ${
                      warning.level === 'critical' ? 'bg-red-50 border-red-200' :
                      warning.level === 'warning' ? 'bg-yellow-50 border-yellow-200' :
                      'bg-slate-50 border-primary-200'
                    }`}>
                      <p className="text-sm">{warning.message}</p>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-2">Restore Mode</label>
                <select
                  value={restoreMode}
                  onChange={(e) => setRestoreMode(e.target.value as any)}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="replace_all">Replace All (Delete existing, insert from backup)</option>
                  <option value="merge_smart">Merge Smart (Update existing, insert new)</option>
                </select>
              </div>

              {previewData.can_proceed && (
                <button
                  onClick={handleRestoreBackup}
                  disabled={restoring}
                  className="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:opacity-50 font-semibold"
                >
                  <Upload className="w-5 h-5" />
                  <span>{restoring ? 'Restoring...' : 'Confirm & Restore'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Restore File Selected */}
      {restoreFile && !showPreview && (
        <div className="bg-surface dark:bg-slate-900/70 rounded-xl shadow-sm border border-border p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <FileText className="w-8 h-8 text-purple-600" />
              <div>
                <p className="font-semibold">{restoreFile.name}</p>
                <p className="text-sm text-text-secondary">{formatBytes(restoreFile.size)}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handlePreviewRestore}
                className="px-4 py-2 border border-border rounded-lg bg-surface hover:bg-gray-50 dark:hover:bg-slate-800/80 flex items-center space-x-2"
              >
                <Eye className="w-4 h-4" />
                <span>Preview</span>
              </button>
              <button
                onClick={() => setRestoreFile(null)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center space-x-2"
              >
                <X className="w-4 h-4" />
                <span>Cancel</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cloud Storage */}
      <div className="bg-surface dark:bg-slate-900/70 rounded-xl shadow-sm border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <Cloud className="w-6 h-6 text-primary-600" />
            <h2 className="text-lg font-semibold">Cloud Storage</h2>
          </div>
        </div>
        
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                <Cloud className="w-6 h-6 text-primary-600" />
              </div>
              <div>
                <p className="font-medium">Google Drive</p>
                <p className="text-sm text-text-secondary">
                  {googleConnected ? 'Connected' : googleConfigured ? 'Configured (not connected)' : 'Not configured'}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              {!googleConnected ? (
                <>
                  <button
                    onClick={handleConnectGoogleDrive}
                    disabled={connectingGoogle}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center space-x-2"
                  >
                    <LinkIcon className="w-4 h-4" />
                    <span>{connectingGoogle ? 'Connecting...' : googleConfigured ? 'Connect' : 'Setup'}</span>
                  </button>
                  {googleConfigured && (
                    <button
                      onClick={() => setShowGoogleCredentialsModal(true)}
                      className="px-4 py-2 border border-border rounded-lg bg-surface hover:bg-gray-50 dark:hover:bg-slate-800/80 text-sm"
                    >
                      Edit Credentials
                    </button>
                  )}
                </>
              ) : (
                <button 
                  onClick={handleDisconnectGoogleDrive}
                  className="px-4 py-2 border border-border rounded-lg bg-surface hover:bg-gray-50 dark:hover:bg-slate-800/80 flex items-center space-x-2"
                >
                  <X className="w-4 h-4" />
                  <span>Disconnect</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Scheduled Backups */}
      <div className="bg-surface dark:bg-slate-900/70 rounded-xl shadow-sm border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <Calendar className="w-6 h-6 text-green-600" />
            <h2 className="text-lg font-semibold">Scheduled Backups</h2>
          </div>
          <button
            onClick={() => setShowScheduleForm(!showScheduleForm)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"
          >
            <Calendar className="w-4 h-4" />
            <span>{schedule ? 'Edit Schedule' : 'Setup Schedule'}</span>
          </button>
        </div>

        {schedule && !showScheduleForm && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <p className="font-medium text-green-900">Active Schedule</p>
            </div>
            <div className="text-sm text-green-800 space-y-1">
              <p>Frequency: {schedule.frequency}</p>
              <p>Time: {schedule.time_of_day}</p>
              <p>Destination: {schedule.storage_destination}</p>
              <p>Next Run: {new Date(schedule.next_run_at).toLocaleString()}</p>
            </div>
          </div>
        )}

        {showScheduleForm && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Frequency</label>
                <select
                  value={scheduleForm.frequency}
                  onChange={(e) => setScheduleForm({...scheduleForm, frequency: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Time</label>
                <input
                  type="time"
                  value={scheduleForm.time_of_day}
                  onChange={(e) => setScheduleForm({...scheduleForm, time_of_day: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
            </div>

            {scheduleForm.frequency === 'weekly' && (
              <div>
                <label className="block text-sm font-medium mb-1">Day of Week</label>
                <select
                  value={scheduleForm.day_of_week}
                  onChange={(e) => setScheduleForm({...scheduleForm, day_of_week: parseInt(e.target.value)})}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value={0}>Sunday</option>
                  <option value={1}>Monday</option>
                  <option value={2}>Tuesday</option>
                  <option value={3}>Wednesday</option>
                  <option value={4}>Thursday</option>
                  <option value={5}>Friday</option>
                  <option value={6}>Saturday</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">Storage Destination</label>
              <select
                value={scheduleForm.storage_destination}
                onChange={(e) => setScheduleForm({...scheduleForm, storage_destination: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="local">Local Download</option>
                <option value="google_drive" disabled={!googleConnected}>Google Drive</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Retention (days)</label>
              <input
                type="number"
                value={scheduleForm.retention_days}
                onChange={(e) => setScheduleForm({...scheduleForm, retention_days: parseInt(e.target.value)})}
                className="w-full px-3 py-2 border rounded-lg"
                min="1"
                max="365"
              />
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={handleSaveSchedule}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"
              >
                <Save className="w-4 h-4" />
                <span>Save Schedule</span>
              </button>
              <button
                onClick={() => setShowScheduleForm(false)}
                className="px-6 py-2 border border-border rounded-lg bg-surface hover:bg-gray-50 dark:hover:bg-slate-800/80"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Backup History */}
      <div className="bg-surface dark:bg-slate-900/70 rounded-xl shadow-sm border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <Clock className="w-6 h-6 text-text-secondary" />
            <h2 className="text-lg font-semibold">Backup History</h2>
          </div>
          <button
            onClick={loadHistory}
            className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>

        {loadingHistory ? (
          <p className="text-center py-8 text-text-muted">Loading...</p>
        ) : history.length === 0 ? (
          <p className="text-center py-8 text-text-muted">No backups yet</p>
        ) : (
          <div className="space-y-2">
            {history.slice(0, expandedHistory ? undefined : 5).map((backup) => (
              <div key={backup.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 dark:bg-slate-800/40 dark:hover:bg-slate-800/70">
                <div className="flex items-center space-x-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    backup.status === 'completed' ? 'bg-green-100' :
                    backup.status === 'failed' ? 'bg-red-100' :
                    'bg-yellow-100'
                  }`}>
                    {backup.storage_location === 'google_drive' ? (
                      <Cloud className="w-5 h-5 text-primary-600" />
                    ) : (
                      <HardDrive className="w-5 h-5 text-text-secondary" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-sm">
                      {backup.backup_type === 'scheduled' ? 'Scheduled Backup' : 'Manual Backup'}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {new Date(backup.created_at).toLocaleString()} • {formatBytes(backup.file_size || 0)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    backup.status === 'completed' ? 'bg-green-100 text-green-800' :
                    backup.status === 'failed' ? 'bg-red-100 text-red-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {backup.status}
                  </span>
                  <button
                    onClick={() => handleDeleteBackup(backup.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
            
            {history.length > 5 && (
              <button
                onClick={() => setExpandedHistory(!expandedHistory)}
                className="w-full py-2 text-sm text-primary-600 hover:bg-slate-50 rounded-lg flex items-center justify-center space-x-2"
              >
                {expandedHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                <span>{expandedHistory ? 'Show Less' : `Show All (${history.length})`}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

