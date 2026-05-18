/**
 * Face Recognition Utility Library
 * Uses face-api.js for browser-based face detection and recognition
 * 
 * Note: face-api.js models need to be downloaded and placed in public/models/
 * Models: https://github.com/justadudewhohacks/face-api.js-models
 */

export interface FaceDescriptor {
  descriptor: Float32Array; // 128-dimensional face descriptor
  detection: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface FaceRecognitionResult {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  confidence: number; // 0-1, higher is better match
  matched: boolean;
}

/**
 * Calculate cosine similarity between two face descriptors
 * Returns value between 0 and 1 (1 = identical, 0 = completely different)
 */
export function calculateFaceSimilarity(
  descriptor1: Float32Array,
  descriptor2: Float32Array
): number {
  if (descriptor1.length !== descriptor2.length || descriptor1.length !== 128) {
    throw new Error('Face descriptors must be 128-dimensional');
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < descriptor1.length; i++) {
    dotProduct += descriptor1[i] * descriptor2[i];
    norm1 += descriptor1[i] * descriptor1[i];
    norm2 += descriptor2[i] * descriptor2[i];
  }

  const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
  if (denominator === 0) return 0;

  // Cosine similarity ranges from -1 to 1, normalize to 0-1
  const similarity = dotProduct / denominator;
  return (similarity + 1) / 2; // Normalize to 0-1 range
}

/**
 * Compare a face descriptor with stored employee face encodings
 * Returns the best match if confidence is above threshold
 */
export function matchFace(
  descriptor: Float32Array,
  employeeFaceEncodings: Array<{
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    encoding: Float32Array;
  }>,
  threshold: number = 0.6 // Minimum similarity threshold (0-1)
): FaceRecognitionResult | null {
  let bestMatch: {
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    confidence: number;
  } | null = null;

  for (const employee of employeeFaceEncodings) {
    const similarity = calculateFaceSimilarity(descriptor, employee.encoding);
    
    if (similarity >= threshold && (!bestMatch || similarity > bestMatch.confidence)) {
      bestMatch = {
        employeeId: employee.employeeId,
        employeeCode: employee.employeeCode,
        employeeName: employee.employeeName,
        confidence: similarity,
      };
    }
  }

  if (!bestMatch) {
    return null;
  }

  return {
    ...bestMatch,
    matched: true,
  };
}

/**
 * Parse face encoding from JSON string stored in database
 */
export function parseFaceEncoding(encodingJson: string): Float32Array {
  try {
    const array = JSON.parse(encodingJson);
    if (!Array.isArray(array) || array.length !== 128) {
      throw new Error('Invalid face encoding format');
    }
    return new Float32Array(array);
  } catch (error) {
    throw new Error(`Failed to parse face encoding: ${error}`);
  }
}

/**
 * Serialize face descriptor to JSON string for database storage
 */
export function serializeFaceEncoding(descriptor: Float32Array): string {
  if (descriptor.length !== 128) {
    throw new Error('Face descriptor must be 128-dimensional');
  }
  return JSON.stringify(Array.from(descriptor));
}

/**
 * Average multiple face descriptors for better accuracy
 * Used during enrollment when capturing multiple images
 */
export function averageFaceDescriptors(descriptors: Float32Array[]): Float32Array {
  if (descriptors.length === 0) {
    throw new Error('At least one descriptor is required');
  }

  if (descriptors.length === 1) {
    return descriptors[0];
  }

  const averaged = new Float32Array(128);
  
  for (let i = 0; i < 128; i++) {
    let sum = 0;
    for (const descriptor of descriptors) {
      sum += descriptor[i];
    }
    averaged[i] = sum / descriptors.length;
  }

  // Normalize the averaged descriptor
  let norm = 0;
  for (let i = 0; i < 128; i++) {
    norm += averaged[i] * averaged[i];
  }
  norm = Math.sqrt(norm);
  
  for (let i = 0; i < 128; i++) {
    averaged[i] = averaged[i] / norm;
  }

  return averaged;
}

