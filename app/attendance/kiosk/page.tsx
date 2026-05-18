'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { Camera, CheckCircle, XCircle, Loader2, LogOut, User, Clock, AlertCircle } from 'lucide-react';
import { Toast, ToastType } from '@/components/ui/Toast';

interface AttendanceState {
  sessionToken: string | null;
  employee: {
    id: string;
    name: string;
    employee_code: string;
  } | null;
  checkedIn: boolean;
  checkedOut: boolean;
  lastCheckInTime: string | null;
}

export default function AttendanceKioskPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [attendanceState, setAttendanceState] = useState<AttendanceState>({
    sessionToken: null,
    employee: null,
    checkedIn: false,
    checkedOut: false,
    lastCheckInTime: null,
  });
  const [mode, setMode] = useState<'face' | 'manual'>('face');
  const [manualCode, setManualCode] = useState('');
  const [manualOtp, setManualOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [faceRecognitionStatus, setFaceRecognitionStatus] = useState<'idle' | 'detecting' | 'recognizing' | 'success' | 'error'>('idle');
  const [cameraActive, setCameraActive] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Check for existing session on mount
  useEffect(() => {
    const sessionToken = localStorage.getItem('attendance_session_token');
    const employeeStr = localStorage.getItem('attendance_employee');
    const expiresAt = localStorage.getItem('attendance_session_expires');

    if (sessionToken && employeeStr && expiresAt) {
      const expires = new Date(expiresAt);
      if (expires > new Date()) {
        setAttendanceState({
          sessionToken,
          employee: JSON.parse(employeeStr),
          checkedIn: false,
          checkedOut: false,
          lastCheckInTime: null,
        });
        checkTodayAttendance(sessionToken);
      } else {
        // Session expired
        clearSession();
      }
    } else {
      // No session, redirect to login
      router.push('/attendance/login');
    }
  }, [router]);

  // Auto-logout after 30 seconds of inactivity
  useEffect(() => {
    const inactivityTimer = setTimeout(() => {
      handleLogout();
    }, 30000); // 30 seconds

    return () => clearTimeout(inactivityTimer);
  }, []);

  const clearSession = () => {
    localStorage.removeItem('attendance_session_token');
    localStorage.removeItem('attendance_employee');
    localStorage.removeItem('attendance_session_expires');
    setAttendanceState({
      sessionToken: null,
      employee: null,
      checkedIn: false,
      checkedOut: false,
      lastCheckInTime: null,
    });
  };

  const checkTodayAttendance = async (sessionToken: string) => {
    if (!business?.id || !attendanceState.employee) return;

    try {
      const res = await fetch(
        `/api/employees/attendance?business_id=${business.id}&employee_id=${attendanceState.employee.id}&start_date=${new Date().toISOString().split('T')[0]}&end_date=${new Date().toISOString().split('T')[0]}&user_id=${user?.id}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.attendance && data.attendance.length > 0) {
          const todayAttendance = data.attendance[0];
          setAttendanceState(prev => ({
            ...prev,
            checkedIn: !!todayAttendance.check_in_time,
            checkedOut: !!todayAttendance.check_out_time,
            lastCheckInTime: todayAttendance.check_in_time,
          }));
        }
      }
    } catch (error) {
      console.error('Error checking attendance:', error);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' }, // Front camera
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
      }
    } catch (error: any) {
      console.error('Error accessing camera:', error);
      setToast({
        message: 'Camera access denied. Please allow camera permissions.',
        type: 'error',
      });
      setShowManualEntry(true);
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setCameraActive(false);
    }
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
  };

  // Face recognition detection (simplified - requires face-api.js)
  const detectFace = async () => {
    if (!videoRef.current || !canvasRef.current || !business?.id) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    // TODO: Integrate face-api.js here
    // For now, this is a placeholder structure
    // Once face-api.js is installed, implement:
    // 1. Load face detection model
    // 2. Detect face in video frame
    // 3. Extract face descriptor
    // 4. Send to API for matching
    // 5. Handle check-in/out

    setFaceRecognitionStatus('detecting');
  };

  const handleFaceCheckIn = async () => {
    if (!business?.id || !attendanceState.sessionToken) return;

    setLoading(true);
    setFaceRecognitionStatus('recognizing');

    try {
      // TODO: Get face encoding from face-api.js
      // For now, using placeholder
      const faceEncoding = JSON.stringify(new Array(128).fill(0)); // Placeholder

      const res = await fetch('/api/employees/attendance/face-recognition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          face_encoding: faceEncoding,
          action: attendanceState.checkedIn ? 'check_out' : 'check_in',
          ip_address: await getClientIP(),
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setFaceRecognitionStatus('success');
        setToast({
          message: data.message,
          type: 'success',
        });
        setAttendanceState(prev => ({
          ...prev,
          checkedIn: data.action === 'check_in',
          checkedOut: data.action === 'check_out',
          lastCheckInTime: data.action === 'check_in' ? new Date().toISOString() : prev.lastCheckInTime,
        }));

        // Reset after 2 seconds
        setTimeout(() => {
          setFaceRecognitionStatus('idle');
        }, 2000);
      } else {
        setFaceRecognitionStatus('error');
        setToast({
          message: data.error || 'Face not recognized',
          type: 'error',
        });
        setTimeout(() => {
          setFaceRecognitionStatus('idle');
        }, 2000);
      }
    } catch (error) {
      console.error('Error in face recognition:', error);
      setFaceRecognitionStatus('error');
      setToast({
        message: 'Face recognition failed. Please try manual entry.',
        type: 'error',
      });
      setTimeout(() => {
        setFaceRecognitionStatus('idle');
      }, 2000);
    } finally {
      setLoading(false);
    }
  };

  const handleManualCheckIn = async () => {
    if (!business?.id || !attendanceState.sessionToken) return;

    if (!manualCode || !manualOtp) {
      setToast({ message: 'Please enter employee code and OTP', type: 'error' });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/employees/attendance/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_token: attendanceState.sessionToken,
          method: 'otp',
          ip_address: await getClientIP(),
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setToast({ message: 'Checked in successfully', type: 'success' });
        setAttendanceState(prev => ({
          ...prev,
          checkedIn: true,
          lastCheckInTime: new Date().toISOString(),
        }));
        setManualCode('');
        setManualOtp('');
        setShowManualEntry(false);
      } else {
        setToast({ message: data.error || 'Check-in failed', type: 'error' });
      }
    } catch (error) {
      console.error('Error checking in:', error);
      setToast({ message: 'Check-in failed. Please try again.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleCheckOut = async () => {
    if (!business?.id || !attendanceState.sessionToken) return;

    setLoading(true);
    try {
      const res = await fetch('/api/employees/attendance/check-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_token: attendanceState.sessionToken,
          method: mode === 'face' ? 'face_recognition' : 'otp',
          ip_address: await getClientIP(),
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setToast({ message: 'Checked out successfully', type: 'success' });
        setAttendanceState(prev => ({
          ...prev,
          checkedOut: true,
        }));
      } else {
        setToast({ message: data.error || 'Check-out failed', type: 'error' });
      }
    } catch (error) {
      console.error('Error checking out:', error);
      setToast({ message: 'Check-out failed. Please try again.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (attendanceState.sessionToken) {
      try {
        await fetch('/api/attendance/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_token: attendanceState.sessionToken }),
        });
      } catch (error) {
        console.error('Error logging out:', error);
      }
    }
    clearSession();
    router.push('/attendance/login');
  };

  const getClientIP = async (): Promise<string> => {
    // Simple IP detection (will be server IP in production)
    return 'unknown';
  };

  useEffect(() => {
    if (mode === 'face' && !cameraActive) {
      startCamera();
    }

    return () => {
      stopCamera();
    };
  }, [mode]);

  if (!attendanceState.employee) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-accent-50 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-text-primary mb-2">Attendance Kiosk</h1>
          {attendanceState.employee && (
            <p className="text-text-secondary">
              Welcome, <span className="font-semibold">{attendanceState.employee.name}</span> ({attendanceState.employee.employee_code})
            </p>
          )}
        </div>

        {/* Main Card */}
        <Card className="p-8">
          {mode === 'face' ? (
            <div className="space-y-6">
              {/* Camera View */}
              <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                <canvas ref={canvasRef} className="hidden" />
                
                {/* Status Overlay */}
                {faceRecognitionStatus !== 'idle' && (
                  <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                    <div className="text-center text-white">
                      {faceRecognitionStatus === 'detecting' && (
                        <>
                          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-2" />
                          <p>Detecting face...</p>
                        </>
                      )}
                      {faceRecognitionStatus === 'recognizing' && (
                        <>
                          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-2" />
                          <p>Recognizing...</p>
                        </>
                      )}
                      {faceRecognitionStatus === 'success' && (
                        <>
                          <CheckCircle className="w-12 h-12 mx-auto mb-2 text-green-500" />
                          <p>Success!</p>
                        </>
                      )}
                      {faceRecognitionStatus === 'error' && (
                        <>
                          <XCircle className="w-12 h-12 mx-auto mb-2 text-red-500" />
                          <p>Not recognized</p>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {!cameraActive && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                    <div className="text-center text-white">
                      <Camera className="w-16 h-16 mx-auto mb-4 opacity-50" />
                      <p>Camera not active</p>
                      <Button onClick={startCamera} className="mt-4">Start Camera</Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-4">
                {!attendanceState.checkedIn ? (
                  <Button
                    onClick={handleFaceCheckIn}
                    disabled={loading || !cameraActive}
                    className="flex-1 text-lg py-6"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Checking In...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-5 h-5 mr-2" />
                        Check In
                      </>
                    )}
                  </Button>
                ) : !attendanceState.checkedOut ? (
                  <Button
                    onClick={handleCheckOut}
                    disabled={loading}
                    variant="secondary"
                    className="flex-1 text-lg py-6"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Checking Out...
                      </>
                    ) : (
                      <>
                        <XCircle className="w-5 h-5 mr-2" />
                        Check Out
                      </>
                    )}
                  </Button>
                ) : (
                  <div className="flex-1 text-center py-6">
                    <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
                    <p className="text-lg font-semibold text-text-primary">Already Checked Out</p>
                    <p className="text-sm text-text-secondary mt-1">
                      {attendanceState.lastCheckInTime &&
                        `Checked in at ${new Date(attendanceState.lastCheckInTime).toLocaleTimeString()}`}
                    </p>
                  </div>
                )}
              </div>

              {/* Manual Entry Fallback */}
              <div className="text-center">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowManualEntry(!showManualEntry);
                    setMode('manual');
                  }}
                >
                  Use Manual Entry Instead
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-center mb-6">
                <AlertCircle className="w-12 h-12 text-primary-600 mx-auto mb-2" />
                <p className="text-text-secondary">Manual Entry Mode</p>
              </div>

              <Input
                label="Employee Code"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                placeholder="EMP001"
                className="text-center text-lg font-mono"
              />

              <Input
                label="OTP"
                value={manualOtp}
                onChange={(e) => setManualOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="text-center text-2xl font-mono tracking-widest"
              />

              <div className="flex gap-4">
                {!attendanceState.checkedIn ? (
                  <Button
                    onClick={handleManualCheckIn}
                    disabled={loading || !manualCode || manualOtp.length !== 6}
                    className="flex-1"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Checking In...
                      </>
                    ) : (
                      'Check In'
                    )}
                  </Button>
                ) : (
                  <Button
                    onClick={handleCheckOut}
                    disabled={loading}
                    variant="secondary"
                    className="flex-1"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Checking Out...
                      </>
                    ) : (
                      'Check Out'
                    )}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setMode('face');
                    setShowManualEntry(false);
                  }}
                >
                  Use Face Recognition
                </Button>
              </div>
            </div>
          )}

          {/* Logout Button */}
          <div className="mt-6 pt-6 border-t border-border text-center">
            <Button variant="ghost" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </Card>

        {/* Status Info */}
        {attendanceState.checkedIn && (
          <Card className="mt-4 p-4 bg-green-50">
            <div className="flex items-center justify-center gap-2 text-green-700">
              <Clock className="w-5 h-5" />
              <span className="font-medium">
                Checked in at{' '}
                {attendanceState.lastCheckInTime &&
                  new Date(attendanceState.lastCheckInTime).toLocaleTimeString()}
              </span>
            </div>
          </Card>
        )}
      </div>

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

