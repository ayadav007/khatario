/** Section content = defaults overlaid with the defined keys of `props` (undefined/null never wipe a default). */
export function withDefaults<T extends object>(defaults: T, props: Partial<T> | undefined): T {
  const out = { ...defaults };
  if (!props) return out;
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const value = props[key];
    if (value !== undefined && value !== null) out[key] = value as T[keyof T];
  }
  return out;
}
