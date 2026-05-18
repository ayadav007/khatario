'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { RefreshCw, LogOut, Send, Loader2, QrCode, X, Download } from 'lucide-react';
import { ReminderSettingsTab } from '@/components/whatsapp/ReminderSettingsTab';
import { SendRemindersTab } from '@/components/whatsapp/SendRemindersTab';
import { ReminderLogsTab } from '@/components/whatsapp/ReminderLogsTab';
import { QRCodeSVG } from 'qrcode.react';
import { Toast, ToastType } from '@/components/ui/Toast';

type ConnectionStatus = 'disconnected' | 'pending_qr' | 'connected' | 'error';
type Tab = 'connection' | 'bot-settings' | 'auto-reminders' | 'send-reminders' | 'logs';

export function WhatsAppTab() {
  const { business } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('connection');
  
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [qrExpired, setQrExpired] = useState(false);
  
  // Toast notifications
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  
  // Confirmation dialog state
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  // Bot Settings state
  const [botTypingEnabled, setBotTypingEnabled] = useState(false);
  const [botTypingDelay, setBotTypingDelay] = useState(3);
  const [loadingBotSettings, setLoadingBotSettings] = useState(false);
  const [savingBotSettings, setSavingBotSettings] = useState(false);
  
  // Cleanup flag for race conditions
  const isMountedRef = useRef(true);
  
  // QR code refresh timer (60 seconds)
  const [qrCodeAge, setQrCodeAge] = useState<number>(0); // seconds since QR was generated
  const qrTimerRef = useRef<NodeJS.Timeout | null>(null);
  const qrGeneratedAtRef = useRef<number | null>(null);
  
  // Phone number validation regex (supports country codes)
  const phoneRegex = /^[1-9]\d{9,14}$/; // 10-15 digits, starting with 1-9

  const fetchStatus = useCallback(async (silent = false) => {
    if (!business?.id || !isMountedRef.current) return;
    if (!silent && isMountedRef.current) setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/status?business_id=${business.id}`);
      const data = await res.json();
      
      if (!isMountedRef.current) return;
      
      const newStatus = data.status;
      
      // Handle QR code: Only update if we get a new one, or clear when connected
      if (newStatus === 'connected') {
        // Clear QR when connected - also clear any error messages
        setQrCode(null);
        qrGeneratedAtRef.current = null;
        setQrCodeAge(0);
        setQrExpired(false);
        setLastError(null); // Clear error messages when connected
        if (!silent) {
          setToast({ message: 'WhatsApp connected successfully!', type: 'success' });
        }
      } else if (newStatus === 'pending_qr') {
        // When status is pending_qr, preserve existing QR code at all costs
        // Only update QR if we receive a new/different one
        if (data.qr) {
          // Check if this is a different QR code before updating
          setQrCode((currentQr) => {
            if (currentQr !== data.qr) {
              // New QR code - reset timer
              qrGeneratedAtRef.current = Date.now();
              setQrCodeAge(0);
              return data.qr;
            }
            // Same QR code - keep existing and ensure timer is initialized
            if (!qrGeneratedAtRef.current) {
              qrGeneratedAtRef.current = Date.now();
              setQrCodeAge(0);
            }
            return currentQr; // Keep existing QR
          });
        } else {
          // No QR in response - ensure timer is initialized if we have a QR code
          setQrCode((currentQr) => {
            if (currentQr && !qrGeneratedAtRef.current) {
              qrGeneratedAtRef.current = Date.now();
              setQrCodeAge(0);
            }
            return currentQr; // NEVER clear the QR code if status is pending_qr
          });
        }
      } else {
        // For other statuses (disconnected, error), only clear QR if status actually changed
        // Don't clear if we're transitioning from pending_qr to disconnected temporarily
        setQrCode((currentQr) => {
          // Only clear QR if status is truly disconnected and not pending
          if (newStatus === 'disconnected' && currentQr) {
            // Check if this is a real disconnect or just a temporary status update
            // Keep QR if there's no explicit error about expiration
            const isExpired = data.lastError?.includes('QR code expired') || 
                             data.lastError?.includes('expired');
            return isExpired ? null : currentQr; // Only clear if explicitly expired
          }
          return currentQr;
        });
      }
      
      if (isMountedRef.current) {
        setStatus(newStatus);
        setPhoneNumber(data.phoneNumber || null);
        setLastError(data.lastError || null);
        
        // Check if QR expired: Only if explicitly marked as expired
        setQrExpired((currentExpired) => {
          const isExpired = newStatus === 'disconnected' && 
                           (data.lastError?.includes('QR code expired') || 
                            data.lastError?.includes('expired'));
          return isExpired;
        });
      }
    } catch (err) {
      console.error(err);
      if (isMountedRef.current && !silent) {
        setToast({ message: 'Failed to fetch status', type: 'error' });
      }
    } finally {
      if (isMountedRef.current && !silent) {
        setLoading(false);
      }
    }
  }, [business?.id]);

  const handleConnect = useCallback(async () => {
    if (!business?.id || !isMountedRef.current) return;
    setLoading(true);
    setQrExpired(false); // Clear expired flag when refreshing
    try {
      // 1. Request connection / QR
      const res = await fetch('/api/whatsapp/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id }),
      });
      const data = await res.json();
      
      if (data.error) throw new Error(data.error);
      
      if (isMountedRef.current) {
        setStatus(data.status || 'pending_qr');
        if (data.qr) {
          setQrCode(data.qr);
          // Reset QR age timer when new QR is generated
          qrGeneratedAtRef.current = Date.now();
          setQrCodeAge(0);
        }
        setPhoneNumber(data.phoneNumber || null);
        setLastError(null);
        setQrExpired(false);
        setToast({ message: 'QR code generated. Please scan with WhatsApp.', type: 'info' });
        
        // Don't call fetchStatus immediately - let the polling effect handle it
        // This prevents clearing the QR code we just set
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setToast({ message: err.message || 'Failed to connect', type: 'error' });
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [business?.id, fetchStatus]); // Added fetchStatus dependency

  // Effect 1: Initial status fetch on mount (only once per business)
  const hasInitializedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    // Only fetch initial status if we haven't initialized for this business yet
    // This prevents clearing QR codes that were just set by handleConnect
    if (business?.id && !hasInitializedRef.current && isMountedRef.current) {
      hasInitializedRef.current = true;
      fetchStatus();
    }
    return () => {
      isMountedRef.current = false;
      // Reset initialization flag when business changes
      if (!business?.id) {
        hasInitializedRef.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id]); // Only run when business.id changes

  // Effect 2: Polling Logic (Runs when status changes, but does NOT fetch immediately)
  useEffect(() => {
    if (!business?.id) return;
    
    let interval: NodeJS.Timeout | null = null;
    
    if (status === 'pending_qr' && isMountedRef.current) {
      // Poll every 30 seconds when waiting for QR (increased from 10s)
      interval = setInterval(() => {
        if (isMountedRef.current) {
          fetchStatus(true); // Silent poll
        }
      }, 30000); // 30 seconds
    } else if (status === 'connected' && isMountedRef.current) {
      // Poll every 60 seconds when connected (increased from 30s)
      interval = setInterval(() => {
        if (isMountedRef.current) {
          fetchStatus(true); // Silent poll
        }
      }, 60000); // 60 seconds
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [business?.id, status, fetchStatus]);

  // Effect 4: QR Code Age Timer (Update every second when QR is displayed)
  useEffect(() => {
    if (status === 'pending_qr' && qrCode && isMountedRef.current) {
      // Initialize timer if not already set
      if (!qrGeneratedAtRef.current) {
        qrGeneratedAtRef.current = Date.now();
        setQrCodeAge(0);
      }
      
      // Update QR age every second
      const interval = setInterval(() => {
        if (isMountedRef.current && qrGeneratedAtRef.current) {
          const age = Math.floor((Date.now() - qrGeneratedAtRef.current) / 1000);
          setQrCodeAge(age);
        }
      }, 1000);
      
      return () => clearInterval(interval);
    } else {
      // Reset when not in pending_qr state or QR is cleared
      if (status !== 'pending_qr' || !qrCode) {
        setQrCodeAge(0);
        qrGeneratedAtRef.current = null;
      }
    }
  }, [status, qrCode]);

  // Effect 5: Auto-refresh QR after 60 seconds
  useEffect(() => {
    if (status === 'pending_qr' && qrCodeAge >= 60 && !loading && isMountedRef.current && qrCode) {
      // QR code is 60+ seconds old, auto-refresh
      // Only trigger once per QR code (reset when new QR is generated)
      const shouldRefresh = qrCodeAge === 60; // Only at exactly 60 seconds
      if (shouldRefresh) {
        console.log('[WA] QR code expired (60s), auto-refreshing...');
        handleConnect();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrCodeAge]); // Only depend on qrCodeAge to avoid infinite loops

  const handleDisconnect = useCallback(async () => {
    if (!business?.id || !isMountedRef.current) return;
    
    setLoading(true);
    try {
      await fetch('/api/whatsapp/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id }),
      });
      if (isMountedRef.current) {
        await fetchStatus();
        setToast({ message: 'WhatsApp disconnected successfully', type: 'success' });
        setShowDisconnectConfirm(false);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setToast({ message: err.message || 'Failed to disconnect', type: 'error' });
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [business?.id, fetchStatus]);

  const handleSyncMessages = useCallback(async () => {
    if (!business?.id || !isMountedRef.current) return;
    
    setSyncing(true);
    try {
      const res = await fetch('/api/whatsapp/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id }),
      });
      
      const data = await res.json();
      
      if (isMountedRef.current) {
        if (data.success) {
          setToast({ 
            message: data.message || 'Message sync initiated. Reconnecting...', 
            type: 'info' 
          });
          // Refresh status after a moment to show reconnection
          setTimeout(() => {
            if (isMountedRef.current) {
              fetchStatus();
            }
          }, 3000);
        } else {
          setToast({ 
            message: data.error || 'Failed to sync messages', 
            type: 'error' 
          });
        }
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setToast({ message: err.message || 'Failed to sync messages', type: 'error' });
      }
    } finally {
      if (isMountedRef.current) {
        setSyncing(false);
      }
    }
  }, [business?.id, fetchStatus]);

  // No longer using third-party QR API - using client-side rendering

  const tabs = [
    { id: 'connection' as Tab, label: 'Connection' },
    { id: 'bot-settings' as Tab, label: 'Bot Settings' },
    { id: 'auto-reminders' as Tab, label: 'Auto Reminders' },
    { id: 'send-reminders' as Tab, label: 'Send Reminders' },
    { id: 'logs' as Tab, label: 'Logs' },
  ];

  // Load bot settings
  const loadBotSettings = useCallback(async () => {
    if (!business?.id) return;
    setLoadingBotSettings(true);
    try {
      const res = await fetch(`/api/settings/whatsapp-bot?business_id=${business.id}`);
      const data = await res.json();
      if (res.ok) {
        setBotTypingEnabled(data.whatsapp_bot_typing_enabled || false);
        setBotTypingDelay(data.whatsapp_bot_typing_delay_seconds || 3);
      }
    } catch (err: any) {
      console.error('Error loading bot settings:', err);
    } finally {
      setLoadingBotSettings(false);
    }
  }, [business?.id]);

  // Save bot settings
  const saveBotSettings = useCallback(async () => {
    if (!business?.id) return;
    setSavingBotSettings(true);
    try {
      const res = await fetch('/api/settings/whatsapp-bot', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          whatsapp_bot_typing_enabled: botTypingEnabled,
          whatsapp_bot_typing_delay_seconds: botTypingDelay
        })
      });
      const data = await res.json();
      if (res.ok) {
        setToast({ message: 'Bot settings saved successfully', type: 'success' });
      } else {
        setToast({ message: data.error || 'Failed to save bot settings', type: 'error' });
      }
    } catch (err: any) {
      console.error('Error saving bot settings:', err);
      setToast({ message: 'Failed to save bot settings', type: 'error' });
    } finally {
      setSavingBotSettings(false);
    }
  }, [business?.id, botTypingEnabled, botTypingDelay]);

  // Load bot settings when bot-settings tab is selected
  useEffect(() => {
    if (activeTab === 'bot-settings' && business?.id) {
      loadBotSettings();
    }
  }, [activeTab, business?.id, loadBotSettings]);

  return (
    <div className="space-y-6">
      {/* WhatsApp Tabs */}
      <div className="border-b border-border">
        <nav className="-mb-px flex space-x-8 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap
                ${activeTab === tab.id
                  ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-text-muted hover:text-text-secondary dark:hover:text-text-primary hover:border-border'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === 'connection' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Connection Card */}
            <Card padding="lg" className="space-y-6">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-lg text-text-primary">Connection Status</h3>
                  <div className="flex items-center gap-2 mt-2">
                    <div className={`w-3 h-3 rounded-full ${
                      status === 'connected' ? 'bg-green-500' : 
                      status === 'pending_qr' ? 'bg-yellow-500' : 'bg-red-500'
                    }`} />
                    <span className="capitalize font-medium text-text-secondary">
                      {status === 'pending_qr' ? 'Scan QR Code' : status}
                    </span>
                  </div>
                  {/* Only show error when NOT connected */}
                  {lastError && status !== 'connected' && (
                    <p className="text-xs text-red-600 mt-2">{lastError}</p>
                  )}
                  {phoneNumber && status === 'connected' && (
                    <p className="text-sm text-text-muted mt-1">Connected: {phoneNumber}</p>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => fetchStatus()} disabled={loading}>
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              </div>

              <div className="border-t border-border pt-6 flex flex-col items-center justify-center min-h-[200px] bg-gray-50 dark:bg-slate-800/40 rounded-lg">
                {status === 'connected' ? (
                  <div className="text-center space-y-4">
                    <div className="w-16 h-16 bg-green-100 dark:bg-green-900/40 rounded-full flex items-center justify-center mx-auto">
                      <QrCode className="w-8 h-8 text-green-600" />
                    </div>
                    <div>
                      <p className="font-medium text-text-primary">Connected</p>
                      {phoneNumber && (
                        <p className="text-sm text-text-muted mt-1">{phoneNumber}</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 w-full max-w-xs">
                      <Button
                        variant="secondary"
                        onClick={handleSyncMessages}
                        disabled={syncing || loading}
                        className="flex items-center gap-2 w-full"
                      >
                        {syncing ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                        {syncing ? 'Syncing Messages...' : 'Sync Messages'}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setShowDisconnectConfirm(true)}
                        disabled={loading || syncing}
                        className="flex items-center gap-2 w-full"
                      >
                        <LogOut className="w-4 h-4" />
                        Disconnect
                      </Button>
                    </div>
                  </div>
                ) : status === 'pending_qr' && qrCode ? (
                  <div className="text-center space-y-4">
                    {qrCode ? (
                      <>
                        <div className="bg-white p-4 rounded-lg shadow-sm inline-block relative">
                          <QRCodeSVG 
                            value={qrCode} 
                            size={200}
                            level="L"
                            includeMargin={true}
                          />
                          {/* Show refresh button after 60 seconds */}
                          {qrCodeAge >= 60 && (
                            <div className="absolute inset-0 bg-black bg-opacity-40 flex items-center justify-center rounded-lg">
                              <Button
                                onClick={handleConnect}
                                disabled={loading}
                                className="flex items-center gap-2 bg-white text-text-primary hover:bg-gray-100"
                              >
                                {loading ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <>
                                    <RefreshCw className="w-4 h-4" />
                                    Refresh QR Code
                                  </>
                                )}
                              </Button>
                            </div>
                          )}
                          {/* Show countdown timer overlay after 50 seconds */}
                          {qrCodeAge >= 50 && qrCodeAge < 60 && (
                            <div className="absolute top-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded">
                              Refreshing in {60 - qrCodeAge}s
                            </div>
                          )}
                        </div>
                        <div className="text-sm text-text-secondary">
                          <p>1. Open WhatsApp on your phone</p>
                          <p>2. Go to Linked Devices {'>'} Link a Device</p>
                          <p>3. Scan this code</p>
                          {qrCodeAge >= 50 && qrCodeAge < 60 && (
                            <p className="text-orange-600 font-medium mt-2">
                              QR code will refresh in {60 - qrCodeAge} seconds
                            </p>
                          )}
                        </div>
                      </>
                    ) : (
                      <Loader2 className="w-8 h-8 animate-spin text-primary-500 mx-auto" />
                    )}
                  </div>
                ) : (status === 'disconnected' && qrExpired) ? (
                  <div className="text-center space-y-4">
                    <div className="bg-white p-4 rounded-lg shadow-sm inline-block opacity-50 relative">
                      {qrCode && (
                        <QRCodeSVG 
                          value={qrCode} 
                          size={200}
                          level="L"
                          includeMargin={true}
                        />
                      )}
                      <div className="absolute inset-0 bg-gray-900 bg-opacity-60 flex items-center justify-center rounded-lg">
                        <div className="text-white text-center px-4">
                          <p className="font-semibold mb-2">QR Code Expired</p>
                          <p className="text-sm">Click refresh to generate a new QR code</p>
                        </div>
                      </div>
                    </div>
                    <div className="text-sm text-text-secondary">
                      <p className="text-orange-600 font-medium mb-2">
                        This QR code has expired
                      </p>
                      <p>Click the button below to generate a new QR code</p>
                    </div>
                    <Button
                      onClick={handleConnect}
                      disabled={loading}
                      className="flex items-center gap-2"
                    >
                      {loading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                      Refresh QR Code
                    </Button>
                  </div>
                ) : (
                  <div className="text-center space-y-4">
                    <div className="w-16 h-16 bg-gray-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto">
                      <QrCode className="w-8 h-8 text-text-muted" />
                    </div>
                    <div>
                      <p className="font-medium text-text-primary">Not Connected</p>
                      <p className="text-sm text-text-muted mt-1">
                        Connect your WhatsApp account to send messages
                      </p>
                    </div>
                    <Button
                      onClick={handleConnect}
                      disabled={loading}
                      className="flex items-center gap-2"
                    >
                      {loading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <QrCode className="w-4 h-4" />
                      )}
                      Connect WhatsApp
                    </Button>
                  </div>
                )}
              </div>
            </Card>

          </div>
        )}

        {activeTab === 'bot-settings' && (
          <Card padding="lg" className="w-full max-w-4xl">
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-text-primary mb-2">Bot Response Settings</h3>
                <p className="text-sm text-text-secondary">
                  Configure typing indicator and response delay for all bot replies
                </p>
              </div>

              {loadingBotSettings ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
                </div>
              ) : (
                <>
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        id="bot-typing-enabled"
                        checked={botTypingEnabled}
                        onChange={(e) => {
                          setBotTypingEnabled(e.target.checked);
                          if (!e.target.checked) {
                            setBotTypingDelay(3); // Reset to default when disabled
                          }
                        }}
                        className="mt-1 w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                      />
                      <div className="flex-1">
                        <label htmlFor="bot-typing-enabled" className="block text-sm font-medium text-text-primary cursor-pointer">
                          Enable Typing Animation
                        </label>
                        <p className="text-sm text-text-muted mt-1">
                          Show animated typing indicator (three dots) before bot sends a response
                        </p>
                      </div>
                    </div>

                    {botTypingEnabled && (
                      <div className="pl-7 space-y-2">
                        <label className="block text-sm font-medium text-text-secondary">
                          Response Delay: {botTypingDelay} seconds
                          <span className="text-xs text-text-muted ml-2">Time before sending response</span>
                        </label>
                        <input
                          type="range"
                          min="1"
                          max="10"
                          value={botTypingDelay}
                          onChange={(e) => setBotTypingDelay(parseInt(e.target.value))}
                          className="w-full h-2 bg-gray-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary-600"
                        />
                        <div className="flex justify-between text-xs text-text-muted">
                          <span>1s (Fast)</span>
                          <span>10s (Slow)</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end pt-4 border-t">
                    <Button
                      onClick={saveBotSettings}
                      disabled={savingBotSettings}
                      className="flex items-center gap-2"
                    >
                      {savingBotSettings ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        'Save Settings'
                      )}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </Card>
        )}

        {activeTab === 'auto-reminders' && <ReminderSettingsTab />}
        {activeTab === 'send-reminders' && <SendRemindersTab />}
        {activeTab === 'logs' && <ReminderLogsTab />}
      </div>

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Disconnect Confirmation Dialog */}
      {showDisconnectConfirm && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
          onClick={(e) => {
            // Close modal if clicking outside (on backdrop)
            if (e.target === e.currentTarget) {
              setShowDisconnectConfirm(false);
            }
          }}
        >
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-text-primary mb-4">
              Disconnect WhatsApp?
            </h3>
            <p className="text-sm text-text-secondary mb-6">
              Are you sure you want to disconnect your WhatsApp account? You'll need to scan the QR code again to reconnect.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setShowDisconnectConfirm(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                onClick={handleDisconnect}
                disabled={loading}
                className="bg-red-600 hover:bg-red-700"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Disconnect'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

