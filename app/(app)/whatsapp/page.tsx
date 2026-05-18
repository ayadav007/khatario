'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RefreshCw, LogOut, Send, Loader2, QrCode, Bell, Send as SendIcon, FileText, X } from 'lucide-react';
import { ReminderSettingsTab } from '@/components/whatsapp/ReminderSettingsTab';
import { SendRemindersTab } from '@/components/whatsapp/SendRemindersTab';
import { ReminderLogsTab } from '@/components/whatsapp/ReminderLogsTab';
import { QRCodeSVG } from 'qrcode.react';
import { Toast, ToastType } from '@/components/ui/Toast';

type ConnectionStatus = 'disconnected' | 'pending_qr' | 'connected' | 'error';
type Tab = 'connection' | 'auto-reminders' | 'send-reminders' | 'logs';

export default function WhatsAppPage() {
  const { business } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('connection');
  
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [qrExpired, setQrExpired] = useState(false);
  
  // Test Message State
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('Hello from Khatario!');
  const [sending, setSending] = useState(false);
  
  // Toast notifications
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  
  // Confirmation dialog state
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  
  // Cleanup flag for race conditions
  const isMountedRef = useRef(true);
  
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
        // Clear QR when connected
        setQrCode(null);
        if (!silent) {
          setToast({ message: 'WhatsApp connected successfully!', type: 'success' });
        }
      } else if (newStatus === 'pending_qr') {
        // When status is pending_qr, only update QR if we receive a new one
        // Preserve existing QR code if API doesn't return one
        if (data.qr) {
          setQrCode(data.qr);
        }
        // If data.qr is null/undefined, keep the existing QR code (don't clear it)
      } else {
        // For other statuses (disconnected, error), don't clear QR if expired
        // We want to show the expired QR with refresh button
        if (newStatus !== 'pending_qr' && newStatus !== 'disconnected') {
          setQrCode(null);
        }
      }
      
      if (isMountedRef.current) {
        setStatus(newStatus);
        setPhoneNumber(data.phoneNumber || null);
        setLastError(data.lastError || null);
        
        // Check if QR expired: disconnected status with QR-related error AND we have a QR code
        const isQrExpired = newStatus === 'disconnected' && 
                           qrCode !== null &&
                           (data.lastError?.includes('QR code expired') || 
                            data.lastError?.includes('QR') ||
                            data.lastError?.includes('expired'));
        setQrExpired(isQrExpired);
        
        // Clear expired flag if we're back to pending_qr or connected
        if (newStatus === 'pending_qr' || newStatus === 'connected') {
          setQrExpired(false);
        }
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
        }
        setPhoneNumber(data.phoneNumber || null);
        setLastError(null);
        setQrExpired(false);
        setToast({ message: 'QR code generated. Please scan with WhatsApp.', type: 'info' });
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
  }, [business?.id]);

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

  const validatePhoneNumber = (phone: string): boolean => {
    // Remove spaces, dashes, and plus signs for validation
    const cleaned = phone.replace(/[\s\-+]/g, '');
    return phoneRegex.test(cleaned);
  };

  const handleSendTest = useCallback(async () => {
    if (!business?.id || !isMountedRef.current) return;
    
    if (!testPhone || !testMessage.trim()) {
      setToast({ message: 'Please enter phone number and message', type: 'warning' });
      return;
    }

    // Validate phone number
    if (!validatePhoneNumber(testPhone)) {
      setToast({ 
        message: 'Invalid phone number. Please enter a valid number with country code (10-15 digits)', 
        type: 'error' 
      });
      return;
    }

    setSending(true);
    try {
      // Clean phone number (remove spaces, dashes)
      const cleanedPhone = testPhone.replace(/[\s\-+]/g, '');
      
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          business_id: business.id, 
          to: cleanedPhone, 
          message: testMessage 
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      if (isMountedRef.current) {
        setToast({ message: 'Message sent successfully!', type: 'success' });
        setTestPhone('');
        setTestMessage('Hello from Khatario!');
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setToast({ message: err.message || 'Failed to send message', type: 'error' });
      }
    } finally {
      if (isMountedRef.current) {
        setSending(false);
      }
    }
  }, [business?.id, testPhone, testMessage]);

  const tabs = [
    { id: 'connection' as Tab, label: 'Connection', icon: QrCode },
    { id: 'auto-reminders' as Tab, label: 'Auto Reminders', icon: Bell },
    { id: 'send-reminders' as Tab, label: 'Send Reminders', icon: SendIcon },
    { id: 'logs' as Tab, label: 'Logs', icon: FileText },
  ];

  return (
    
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">WhatsApp Integration</h1>
          <p className="text-gray-600 mt-1">Connect your business number to send automated invoices and reminders.</p>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap
                    ${activeTab === tab.id
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }
                  `}
                >
                  <Icon className="w-5 h-5" />
                  {tab.label}
                </button>
              );
            })}
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
                    <h3 className="font-semibold text-lg text-gray-900">Connection Status</h3>
                    <div className="flex items-center gap-2 mt-2">
                      <div className={`w-3 h-3 rounded-full ${
                        status === 'connected' ? 'bg-green-500' : 
                        status === 'pending_qr' ? 'bg-yellow-500' : 'bg-red-500'
                      }`} />
                      <span className="capitalize font-medium text-gray-700">
                        {status === 'pending_qr' ? 'Scan QR Code' : status}
                      </span>
                    </div>
                    {phoneNumber && (
                      <p className="text-sm text-gray-500 mt-1">Connected: {phoneNumber}</p>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => fetchStatus()} disabled={loading}>
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>

                <div className="border-t pt-6 flex flex-col items-center justify-center min-h-[200px] bg-gray-50 rounded-lg">
                  {status === 'connected' ? (
                    <div className="text-center space-y-3">
                      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                        <Send className="w-8 h-8 text-green-600" />
                      </div>
                      <p className="text-gray-900 font-medium">WhatsApp is active</p>
                      <Button 
                        variant="secondary" 
                        onClick={() => setShowDisconnectConfirm(true)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <LogOut className="w-4 h-4 mr-2" />
                        Disconnect
                      </Button>
                    </div>
                  ) : status === 'pending_qr' && qrCode ? (
                    <div className="text-center space-y-4">
                      <div className="bg-white p-4 rounded-lg shadow-sm inline-block">
                        <QRCodeSVG 
                          value={qrCode} 
                          size={200}
                          level="L"
                          includeMargin={true}
                        />
                      </div>
                      <div className="text-sm text-gray-600">
                        <p>1. Open WhatsApp on your phone</p>
                        <p>2. Go to Linked Devices {'>'} Link a Device</p>
                        <p>3. Scan this code</p>
                      </div>
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
                      <div className="text-sm text-gray-600">
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
                    <div className="text-center space-y-3">
                      <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto">
                        <QrCode className="w-8 h-8 text-gray-500" />
                      </div>
                      <p className="text-gray-500">No active session found</p>
                      <Button onClick={handleConnect} disabled={loading}>
                        {loading ? 'Initializing...' : 'Start Connection'}
                      </Button>
                    </div>
                  )}
                </div>
              </Card>

              {/* Test Message Card */}
              <Card padding="lg" className="space-y-6">
                <h3 className="font-semibold text-lg text-gray-900">Send Test Message</h3>
                <div className="space-y-4">
                  <Input 
                    label="Phone Number" 
                    placeholder="e.g. 919876543210"
                    value={testPhone}
                    onChange={e => setTestPhone(e.target.value)}
                  />
                  <Input 
                    label="Message Content" 
                    placeholder="Type a message..."
                    value={testMessage}
                    onChange={e => setTestMessage(e.target.value)}
                  />
                  <Button 
                    className="w-full" 
                    onClick={handleSendTest} 
                    disabled={status !== 'connected' || sending}
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                    Send Message
                  </Button>
                  {status !== 'connected' && (
                    <p className="text-xs text-center text-red-500">
                      Connect WhatsApp first to send messages
                    </p>
                  )}
                </div>
              </Card>
            </div>
          )}

          {activeTab === 'auto-reminders' && <ReminderSettingsTab />}
          {activeTab === 'send-reminders' && <SendRemindersTab />}
          {activeTab === 'logs' && <ReminderLogsTab />}
        </div>

        {/* Disconnect Confirmation Modal */}
        {showDisconnectConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowDisconnectConfirm(false)}>
            <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Disconnect WhatsApp?</h3>
              <p className="text-sm text-gray-600 mb-6">
                This will disconnect your WhatsApp session. You&apos;ll need to scan the QR code again to reconnect.
              </p>
              <div className="flex justify-end gap-3">
                <Button variant="secondary" onClick={() => setShowDisconnectConfirm(false)} disabled={loading}>
                  Cancel
                </Button>
                <Button onClick={handleDisconnect} disabled={loading} className="bg-red-600 hover:bg-red-700 text-white">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <LogOut className="w-4 h-4 mr-2" />}
                  Disconnect
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Toast Notifications */}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </div>
    
  );
}

