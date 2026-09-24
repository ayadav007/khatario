export function storePhoneDigits(phone: string): string {
  return String(phone ?? '').replace(/\D/g, '').slice(-10);
}

export function storePhonesMatch(a: string, b: string): boolean {
  const x = storePhoneDigits(a);
  const y = storePhoneDigits(b);
  return x.length === 10 && x === y;
}
