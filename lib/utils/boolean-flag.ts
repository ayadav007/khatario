/** A JSON body flag as a boolean: true/'true'/1/'1' and false/'false'/0/'0'; anything else is undefined (not sent). */
export function parseBooleanFlag(v: unknown): boolean | undefined {
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  return undefined;
}
