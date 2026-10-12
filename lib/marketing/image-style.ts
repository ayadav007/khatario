export type MarketingImageStyle = 'square' | 'poster';

export const DAILY_ANGLES = [
  'A shopkeeper sending a GST invoice from the phone before closing',
  'Khata that stays correct when the customer pays later',
  'Purchase entry and stock written in the same place',
  'The counter is quiet because the day’s bills are already done',
  'A Hindi-speaking shop owner who wants simple billing',
  'No desktop, just the phone and the customer in front of the counter',
  'A credit sale written down so it is not forgotten',
] as const;

export function kolkataDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}

export function dayOfYear(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  const start = Date.UTC(year, 0, 1);
  const current = Date.UTC(year, month - 1, day);
  return Math.floor((current - start) / 86_400_000) + 1;
}

export function imageStyleForDate(isoDate: string): MarketingImageStyle {
  return dayOfYear(isoDate) % 2 === 0 ? 'poster' : 'square';
}

export function angleForDate(isoDate: string): string {
  return DAILY_ANGLES[(dayOfYear(isoDate) - 1) % DAILY_ANGLES.length];
}

export function resolveImageStyle(value: unknown, isoDate: string): MarketingImageStyle {
  if (value === 'square' || value === 'poster') return value;
  return imageStyleForDate(isoDate);
}
