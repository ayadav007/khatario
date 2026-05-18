/**
 * Image Upload Utility
 * Handles image uploads to the server
 */

/**
 * Upload an image file
 * @param file - The file to upload
 * @param businessId - The business ID (optional, for future use)
 * @param folder - The folder/category for the image (optional, for organization)
 * @returns Promise<string> - The uploaded image URL (base64 data URL)
 */
export async function uploadImage(
  file: File,
  businessId?: string,
  folder?: string
): Promise<string> {
  // Validate file type
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and PDF are allowed.');
  }

  // Validate file size (max 5MB)
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) {
    throw new Error('File size too large. Maximum size is 5MB.');
  }

  // Create form data
  const formData = new FormData();
  formData.append('file', file);
  if (businessId) {
    formData.append('business_id', businessId);
  }
  if (folder) {
    formData.append('folder', folder);
  }

  // Upload to API
  const response = await fetch('/api/upload/image', {
    method: 'POST',
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to upload image');
  }

  return data.url;
}

