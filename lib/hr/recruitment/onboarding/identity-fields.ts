import type { IdentityDocKey } from './types';

export type IdentityFieldSpec = {
  key: string;
  label: string;
  type: 'text' | 'date' | 'textarea' | 'gender';
  required: boolean;
  uppercase?: boolean;
};

export const IDENTITY_FORM_SPECS: Record<IdentityDocKey, IdentityFieldSpec[]> = {
  aadhaar: [
    { key: 'aadhaar_number', label: 'Aadhaar Number', type: 'text', required: true },
    { key: 'enrollment_number', label: 'Enrollment Number', type: 'text', required: false },
    { key: 'date_of_birth', label: 'Date of Birth', type: 'date', required: true },
    { key: 'full_name', label: 'Name', type: 'text', required: true },
    { key: 'gender', label: 'Gender', type: 'gender', required: true },
    { key: 'address', label: 'Address', type: 'textarea', required: true },
  ],
  pan: [
    { key: 'pan_number', label: 'Permanent Account Number', type: 'text', required: true, uppercase: true },
    { key: 'full_name', label: 'Name', type: 'text', required: true },
    { key: 'date_of_birth', label: 'Date of Birth', type: 'date', required: true },
    { key: 'parent_name', label: "Parent's Name", type: 'text', required: true },
  ],
  voter_id: [
    { key: 'voter_id_number', label: 'Voter ID Number (EPIC)', type: 'text', required: true },
    { key: 'full_name', label: 'Name', type: 'text', required: true },
    { key: 'date_of_birth', label: 'Date of Birth', type: 'date', required: true },
    { key: 'address', label: 'Address', type: 'textarea', required: true },
    { key: 'constituency', label: 'Constituency', type: 'text', required: false },
  ],
  driving_license: [
    { key: 'license_number', label: 'License Number', type: 'text', required: true },
    { key: 'full_name', label: 'Name', type: 'text', required: true },
    { key: 'date_of_birth', label: 'Date of Birth', type: 'date', required: true },
    { key: 'valid_until', label: 'Valid Until', type: 'date', required: true },
    { key: 'issue_date', label: 'Issue Date', type: 'date', required: false },
    { key: 'address', label: 'Address', type: 'textarea', required: false },
  ],
  passport: [
    { key: 'passport_number', label: 'Passport Number', type: 'text', required: true, uppercase: true },
    { key: 'full_name', label: 'Name', type: 'text', required: true },
    { key: 'date_of_birth', label: 'Date of Birth', type: 'date', required: true },
    { key: 'expiry_date', label: 'Expiry Date', type: 'date', required: true },
    { key: 'issue_date', label: 'Issue Date', type: 'date', required: false },
    { key: 'place_of_issue', label: 'Place of Issue', type: 'text', required: false },
    { key: 'nationality', label: 'Nationality', type: 'text', required: false },
  ],
};

export function emptyIdentityForm(docKey: IdentityDocKey): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of IDENTITY_FORM_SPECS[docKey]) {
    out[f.key] = '';
  }
  return out;
}

export function identityFormFromStored(
  docKey: IdentityDocKey,
  fields: Record<string, unknown> | undefined,
): Record<string, string> {
  const base = emptyIdentityForm(docKey);
  if (!fields) return base;
  for (const f of IDENTITY_FORM_SPECS[docKey]) {
    const raw = fields[f.key];
    if (raw == null) continue;
    const str = String(raw);
    base[f.key] = f.type === 'date' ? str.slice(0, 10) : str;
  }
  return base;
}
