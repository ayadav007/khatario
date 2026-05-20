'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Edit, Loader2, User, Briefcase, Building, Calendar, Phone, Mail, CreditCard, FileText, DollarSign, AlertCircle, Camera, CheckCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Employee, EmployeeDocument } from '@/types/database';
import { format } from 'date-fns';
import { DeleteAction } from '@/components/common/DeleteAction';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { useMobileHeaderTitleOverride } from '@/contexts/MobileHeaderTitleContext';

interface EmployeeWithUser extends Employee {
  user_name: string;
  user_email?: string;
  user_phone: string;
  user_is_active: boolean;
  reporting_manager_name?: string;
  reporting_manager_code?: string;
  role_name?: string;
}

export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { business, user } = useAuth();
  const employeeId = params.id as string;
  
  const [activeTab, setActiveTab] = useState<'overview' | 'documents' | 'face_enrollment'>('overview');
  const [employee, setEmployee] = useState<EmployeeWithUser | null>(null);
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useMobileHeaderTitleOverride(employee?.user_name);

  useEffect(() => {
    if (employeeId && business?.id) {
      fetchEmployeeData();
    }
  }, [employeeId, business?.id]);

  const fetchEmployeeData = async () => {
    try {
      const res = await fetch(`/api/employees/${employeeId}?business_id=${business?.id}`);
      if (res.ok) {
        const data = await res.json();
        setEmployee(data.employee);
        setDocuments(data.documents || []);
      } else {
        console.error('Failed to fetch employee data');
      }
    } catch (error) {
      console.error('Error fetching employee data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      
    );
  }

  if (!employee) {
    return (
      
        <div className="p-6 text-center">
          <p className="text-text-secondary">Employee not found</p>
          <Link href="/employees">
            <Button className="mt-4">Back to Employees</Button>
          </Link>
        </div>
      
    );
  }

  const getStatusColor = () => {
    if (!employee.is_active || !employee.user_is_active) return 'bg-red-100 text-red-800';
    return 'bg-green-100 text-green-800';
  };

  const getAccessTypeColor = () => {
    if (employee.access_type === 'full') return 'bg-slate-100 text-primary-800';
    return 'bg-purple-100 text-purple-800';
  };

  return (
    
      <div className="space-y-6">
        <MobileDuplicatePageChrome
          className="mb-0"
          title={employee.user_name}
          description={employee.employee_code ? `Code: ${employee.employee_code}` : undefined}
          trailing={
            <div className="flex gap-2">
              <Link href={`/employees/${employeeId}/edit`}>
                <Button variant="ghost" size="sm">
                  <Edit className="w-4 h-4 mr-2" />
                  Edit
                </Button>
              </Link>
              <DeleteAction
                entityName="employee"
                variant="deactivate"
                confirmMessage="This employee will be deactivated. Existing records will remain intact."
                disabled={!employee.is_active || !employee.user_is_active}
                disabledTooltip="Employee is already inactive"
                deleteFn={async () => {
                  if (!business?.id || !user?.id) throw new Error('Missing business/user context');
                  const res = await fetch(
                    `/api/employees/${employeeId}?business_id=${business.id}&user_id=${user.id}`,
                    { method: 'DELETE' }
                  );
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(data?.error || 'Failed to deactivate employee');
                }}
                onSuccess={async () => {
                  await fetchEmployeeData();
                }}
              />
            </div>
          }
        />

        {/* Employee Header */}
        <Card padding="md">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-start gap-4">
              {employee.photo_url ? (
                <img
                  src={employee.photo_url}
                  alt={employee.user_name}
                  className="w-20 h-20 rounded-full object-cover"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center">
                  <User className="w-10 h-10 text-primary-600" />
                </div>
              )}
              <div>
                <h2 className="text-xl font-bold text-text-primary mb-2 hidden md:block">{employee.user_name}</h2>
                <div className="flex items-center gap-2 mb-2">
                  <Chip className={getStatusColor()}>
                    {employee.is_active && employee.user_is_active ? 'Active' : 'Inactive'}
                  </Chip>
                  <Chip className={getAccessTypeColor()}>
                    {employee.access_type === 'full' ? 'Full Access' : 'Attendance Only'}
                  </Chip>
                  {employee.role_name && (
                    <Chip className="bg-gray-100 text-gray-800">
                      {employee.role_name}
                    </Chip>
                  )}
                </div>
                <p className="text-text-secondary flex items-center gap-4 mt-2">
                  {employee.user_phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-4 h-4" />
                      {employee.user_phone}
                    </span>
                  )}
                  {employee.user_email && (
                    <span className="flex items-center gap-1">
                      <Mail className="w-4 h-4" />
                      {employee.user_email}
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card padding="md" className="bg-slate-50">
              <p className="text-sm text-text-secondary mb-1 flex items-center gap-1">
                <Briefcase className="w-4 h-4" />
                Employee Code
              </p>
              <p className="text-xl font-bold text-text-primary font-mono">
                {employee.employee_code}
              </p>
            </Card>
            {employee.designation && (
              <Card padding="md" className="bg-accent-50">
                <p className="text-sm text-text-secondary mb-1 flex items-center gap-1">
                  <Briefcase className="w-4 h-4" />
                  Designation
                </p>
                <p className="text-xl font-bold text-text-primary">
                  {employee.designation}
                </p>
              </Card>
            )}
            {employee.joining_date && (
              <Card padding="md" className="bg-green-50">
                <p className="text-sm text-text-secondary mb-1 flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  Joining Date
                </p>
                <p className="text-xl font-bold text-text-primary">
                  {format(new Date(employee.joining_date), 'dd MMM yyyy')}
                </p>
              </Card>
            )}
          </div>
        </Card>

        {/* Tabs */}
        <div className="border-b border-border">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('overview')}
              className={`pb-3 px-1 border-b-2 font-medium transition-colors ${
                activeTab === 'overview'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('documents')}
              className={`pb-3 px-1 border-b-2 font-medium transition-colors ${
                activeTab === 'documents'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              Documents ({documents.length})
            </button>
            <button
              onClick={() => setActiveTab('face_enrollment')}
              className={`pb-3 px-1 border-b-2 font-medium transition-colors ${
                activeTab === 'face_enrollment'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              Face Enrollment
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Employment Information */}
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <Briefcase className="w-5 h-5 text-primary-600" />
                <h2 className="text-lg font-semibold text-text-primary">Employment Information</h2>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-text-secondary">Employee Code:</span>
                  <span className="font-medium text-text-primary font-mono">{employee.employee_code}</span>
                </div>
                {employee.designation && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Designation:</span>
                    <span className="font-medium text-text-primary">{employee.designation}</span>
                  </div>
                )}
                {employee.department && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Department:</span>
                    <span className="font-medium text-text-primary">{employee.department}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-text-secondary">Employment Type:</span>
                  <span className="font-medium text-text-primary capitalize">
                    {employee.employment_type.replace('_', ' ')}
                  </span>
                </div>
                {employee.joining_date && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Joining Date:</span>
                    <span className="font-medium text-text-primary">
                      {format(new Date(employee.joining_date), 'dd MMM yyyy')}
                    </span>
                  </div>
                )}
                {employee.reporting_manager_name && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Reporting Manager:</span>
                    <span className="font-medium text-text-primary">
                      {employee.reporting_manager_code} - {employee.reporting_manager_name}
                    </span>
                  </div>
                )}
                {employee.salary && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Salary:</span>
                    <span className="font-medium text-text-primary">
                      ₹ {Number(employee.salary).toLocaleString('en-IN')}
                    </span>
                  </div>
                )}
              </div>
            </Card>

            {/* Contact Information */}
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <Phone className="w-5 h-5 text-primary-600" />
                <h2 className="text-lg font-semibold text-text-primary">Contact Information</h2>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-text-secondary">Phone:</span>
                  <span className="font-medium text-text-primary">{employee.user_phone}</span>
                </div>
                {employee.user_email && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Email:</span>
                    <span className="font-medium text-text-primary">{employee.user_email}</span>
                  </div>
                )}
                {employee.emergency_contact_name && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Emergency Contact:</span>
                    <span className="font-medium text-text-primary">{employee.emergency_contact_name}</span>
                  </div>
                )}
                {employee.emergency_contact_phone && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Emergency Phone:</span>
                    <span className="font-medium text-text-primary">{employee.emergency_contact_phone}</span>
                  </div>
                )}
              </div>
            </Card>

            {/* Bank Details */}
            {(employee.bank_account_number || employee.bank_ifsc || employee.bank_name) && (
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <CreditCard className="w-5 h-5 text-primary-600" />
                  <h2 className="text-lg font-semibold text-text-primary">Bank Details</h2>
                </div>
                <div className="space-y-3">
                  {employee.bank_account_number && (
                    <div className="flex justify-between">
                      <span className="text-text-secondary">Account Number:</span>
                      <span className="font-medium text-text-primary font-mono">
                        {employee.bank_account_number}
                      </span>
                    </div>
                  )}
                  {employee.bank_ifsc && (
                    <div className="flex justify-between">
                      <span className="text-text-secondary">IFSC Code:</span>
                      <span className="font-medium text-text-primary">{employee.bank_ifsc}</span>
                    </div>
                  )}
                  {employee.bank_name && (
                    <div className="flex justify-between">
                      <span className="text-text-secondary">Bank Name:</span>
                      <span className="font-medium text-text-primary">{employee.bank_name}</span>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* Documents Summary */}
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <FileText className="w-5 h-5 text-primary-600" />
                <h2 className="text-lg font-semibold text-text-primary">Documents</h2>
              </div>
              <div className="space-y-3">
                {employee.pan_number && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">PAN Number:</span>
                    <span className="font-medium text-text-primary font-mono">{employee.pan_number}</span>
                  </div>
                )}
                {employee.aadhaar_number && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Aadhaar Number:</span>
                    <span className="font-medium text-text-primary font-mono">
                      {employee.aadhaar_number.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3')}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-text-secondary">Uploaded Documents:</span>
                  <span className="font-medium text-text-primary">{documents.length} file(s)</span>
                </div>
              </div>
            </Card>
          </div>
        )}

        {activeTab === 'documents' && (
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-text-primary">Documents</h2>
              <Button size="sm">Upload Document</Button>
            </div>
            {documents.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-text-secondary">No documents uploaded</p>
              </div>
            ) : (
              <div className="space-y-3">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between p-3 border border-border rounded-lg hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-primary-600" />
                      <div>
                        <p className="font-medium text-text-primary">{doc.document_name || 'Document'}</p>
                        <p className="text-sm text-text-secondary">
                          {doc.document_type && (
                            <span className="capitalize">{doc.document_type}</span>
                          )}
                          {doc.document_type && ' • '}
                          {format(new Date(doc.uploaded_at), 'dd MMM yyyy')}
                        </p>
                      </div>
                    </div>
                    <a
                      href={doc.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-600 hover:text-primary-700"
                    >
                      View
                    </a>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {activeTab === 'face_enrollment' && (
          <FaceEnrollmentTab employeeId={employeeId} businessId={business?.id || ''} />
        )}
      </div>
    
  );
}

// Face Enrollment Component
function FaceEnrollmentTab({ employeeId, businessId }: { employeeId: string; businessId: string }) {
  const [enrolled, setEnrolled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const [faceEncodings, setFaceEncodings] = useState<string[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    checkEnrollmentStatus();
    return () => {
      stopCamera();
    };
  }, [employeeId, businessId]);

  const checkEnrollmentStatus = async () => {
    if (!businessId) return;

    try {
      const res = await fetch(`/api/employees/face-enrollment?employee_id=${employeeId}&business_id=${businessId}`);
      if (res.ok) {
        const data = await res.json();
        setEnrolled(data.enrolled);
      }
    } catch (error) {
      console.error('Error checking enrollment:', error);
    } finally {
      setChecking(false);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
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
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setCameraActive(false);
    }
  };

  const captureFace = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    // Convert to base64
    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    setCapturedImages(prev => [...prev, imageData]);

    // TODO: Extract face encoding using face-api.js
    // For now, using placeholder
    const placeholderEncoding = JSON.stringify(new Array(128).fill(0));
    setFaceEncodings(prev => [...prev, placeholderEncoding]);

    setToast({
      message: `Face captured (${capturedImages.length + 1}/5)`,
      type: 'success',
    });
  };

  const handleEnroll = async () => {
    if (faceEncodings.length < 3) {
      setToast({
        message: 'Please capture at least 3 face images from different angles',
        type: 'error',
      });
      return;
    }

    if (!businessId) return;

    setLoading(true);
    try {
      const res = await fetch('/api/employees/face-enrollment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId,
          business_id: businessId,
          face_encodings: faceEncodings,
          face_image_url: capturedImages[0], // Use first image as reference
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setEnrolled(true);
        setToast({
          message: 'Face enrollment completed successfully',
          type: 'success',
        });
        setCapturedImages([]);
        setFaceEncodings([]);
        stopCamera();
      } else {
        setToast({
          message: data.error || 'Face enrollment failed',
          type: 'error',
        });
      }
    } catch (error) {
      console.error('Error enrolling face:', error);
      setToast({
        message: 'Face enrollment failed. Please try again.',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <Card>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center gap-2 mb-6">
        <Camera className="w-5 h-5 text-primary-600" />
        <h2 className="text-lg font-semibold text-text-primary">Face Enrollment</h2>
      </div>

      {enrolled ? (
        <div className="text-center py-12">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <p className="text-lg font-semibold text-text-primary mb-2">Face Already Enrolled</p>
          <p className="text-sm text-text-secondary mb-4">
            This employee's face data is already enrolled for attendance recognition.
          </p>
          <Button
            onClick={() => {
              setEnrolled(false);
              setCapturedImages([]);
              setFaceEncodings([]);
            }}
            variant="secondary"
          >
            Re-enroll Face
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-slate-50 border border-primary-200 rounded-lg p-4">
            <p className="text-sm text-primary-800">
              <strong>Instructions:</strong> Capture 3-5 images of the employee's face from different angles.
              Make sure the face is clearly visible and well-lit.
            </p>
          </div>

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

            {!cameraActive && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                <div className="text-center text-white">
                  <Camera className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="mb-4">Camera not active</p>
                  <Button onClick={startCamera}>Start Camera</Button>
                </div>
              </div>
            )}
          </div>

          {/* Captured Images Preview */}
          {capturedImages.length > 0 && (
            <div>
              <p className="text-sm font-medium text-text-primary mb-2">
                Captured Images ({capturedImages.length}/5)
              </p>
              <div className="flex gap-2 overflow-x-auto">
                {capturedImages.map((img, idx) => (
                  <img
                    key={idx}
                    src={img}
                    alt={`Capture ${idx + 1}`}
                    className="w-20 h-20 object-cover rounded border border-border"
                  />
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-4">
            {cameraActive && (
              <Button
                onClick={captureFace}
                disabled={capturedImages.length >= 5}
                variant="secondary"
                className="flex-1"
              >
                <Camera className="w-4 h-4 mr-2" />
                Capture Face ({capturedImages.length}/5)
              </Button>
            )}
            {faceEncodings.length >= 3 && (
              <Button
                onClick={handleEnroll}
                disabled={loading}
                className="flex-1"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Enrolling...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Complete Enrollment
                  </>
                )}
              </Button>
            )}
          </div>

          {faceEncodings.length > 0 && faceEncodings.length < 3 && (
            <p className="text-sm text-text-secondary text-center">
              Capture {3 - faceEncodings.length} more image(s) to complete enrollment
            </p>
          )}
        </div>
      )}

      {toast && (
        <div className={`mt-4 p-3 rounded-lg ${
          toast.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
        }`}>
          {toast.message}
        </div>
      )}
    </Card>
  );
}

