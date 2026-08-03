import crypto from 'crypto';
import { validateEmployeePortalPassword } from '@/lib/employee-portal/password';

export function generateEmployeePortalTemporaryPassword(): string {
  // Hex-only passwords can fail policy (e.g. ABCD-EFAB has no digit, 1234-5678 has no letter).
  for (let attempt = 0; attempt < 32; attempt++) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    const password = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    if (validateEmployeePortalPassword(password).ok) {
      return password;
    }
  }
  return 'A1B2-C3D4';
}
