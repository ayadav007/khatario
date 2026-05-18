declare module 'date-fns-tz' {
  export function formatInTimeZone(
    date: Date | string | number,
    timeZone: string,
    formatStr: string,
    options?: unknown
  ): string;

  export function toDate(
    argument: string | number | Date,
    options?: { timeZone?: string }
  ): Date;
}
