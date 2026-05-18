import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { serializeFaceEncoding, averageFaceDescriptors } from '@/lib/face-recognition';

/**
 * POST /api/employees/face-enrollment
 * Enroll face data for an employee
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      employee_id,
      business_id,
      face_encodings, // Array of face encoding JSON strings (captured from multiple angles)
      face_image_url, // Optional: reference image URL
    } = body;

    if (!employee_id || !business_id || !face_encodings || !Array.isArray(face_encodings)) {
      return NextResponse.json(
        { error: 'employee_id, business_id, and face_encodings array are required' },
        { status: 400 }
      );
    }

    if (face_encodings.length < 1) {
      return NextResponse.json(
        { error: 'At least one face encoding is required' },
        { status: 400 }
      );
    }

    // Verify employee belongs to business
    const employee = await queryOne(
      'SELECT id FROM employees WHERE id = $1 AND business_id = $2',
      [employee_id, business_id]
    );

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      );
    }

    // Parse all face encodings
    const descriptors: Float32Array[] = [];
    for (const encodingJson of face_encodings) {
      try {
        const encodingArray = JSON.parse(encodingJson);
        const descriptor = new Float32Array(encodingArray);
        if (descriptor.length !== 128) {
          throw new Error('Face encoding must be 128-dimensional');
        }
        descriptors.push(descriptor);
      } catch (error: any) {
        return NextResponse.json(
          { error: `Invalid face encoding format: ${error.message}` },
          { status: 400 }
        );
      }
    }

    // Average all descriptors for better accuracy
    const averagedDescriptor = averageFaceDescriptors(descriptors);
    const faceEncodingJson = serializeFaceEncoding(averagedDescriptor);

    // Check if face data already exists
    const existing = await queryOne(
      'SELECT id FROM employee_face_data WHERE employee_id = $1',
      [employee_id]
    );

    if (existing) {
      // Update existing face data
      await query(
        `UPDATE employee_face_data
         SET face_encoding = $1, face_image_url = $2, enrollment_date = CURRENT_TIMESTAMP, is_active = true
         WHERE employee_id = $3`,
        [faceEncodingJson, face_image_url || null, employee_id]
      );
    } else {
      // Create new face data
      await query(
        `INSERT INTO employee_face_data (employee_id, face_encoding, face_image_url)
         VALUES ($1, $2, $3)`,
        [employee_id, faceEncodingJson, face_image_url || null]
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Face enrollment completed successfully',
    });
  } catch (error: any) {
    console.error('Error enrolling face:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/employees/face-enrollment
 * Check if employee has face data enrolled
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employee_id');
    const businessId = searchParams.get('business_id');

    if (!employeeId || !businessId) {
      return NextResponse.json(
        { error: 'employee_id and business_id are required' },
        { status: 400 }
      );
    }

    // Verify employee belongs to business
    const employee = await queryOne(
      'SELECT id FROM employees WHERE id = $1 AND business_id = $2',
      [employeeId, businessId]
    );

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      );
    }

    // Check if face data exists
    const faceData = await queryOne(
      'SELECT id, enrollment_date, is_active FROM employee_face_data WHERE employee_id = $1',
      [employeeId]
    );

    return NextResponse.json({
      enrolled: !!faceData,
      enrollment_date: faceData?.enrollment_date,
      is_active: faceData?.is_active,
    });
  } catch (error: any) {
    console.error('Error checking face enrollment:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

