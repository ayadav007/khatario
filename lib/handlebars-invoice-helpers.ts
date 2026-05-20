/**
 * Shared Handlebars helpers for invoice templates (preview + PDF render).
 * Register once per process — safe to call multiple times.
 *
 * Simple helpers receive only explicit template arguments (no leading context arg).
 */
import Handlebars from 'handlebars';

let registered = false;

function parseNum(value: unknown, fallback = 0): number {
  const n = parseFloat(String(value ?? fallback));
  return Number.isFinite(n) ? n : fallback;
}

export function registerGlobalInvoiceHandlebarsHelpers(): void {
  if (registered) return;
  registered = true;

  Handlebars.registerHelper('ifSetting', function (this: unknown, settingName: string, options: Handlebars.HelperOptions) {
    if (!options?.fn) return '';
    const root = (options.data?.root || options.data || this) as { settings?: Record<string, unknown> };
    const settings = root?.settings || {};
    const settingValue = settings[settingName];
    if (settingValue === false) {
      return options.inverse ? options.inverse(this) : '';
    }
    return options.fn(this);
  });

  Handlebars.registerHelper('ifEqual', function (this: unknown, arg1: unknown, arg2: unknown, options: Handlebars.HelperOptions) {
    return arg1 == arg2 ? options.fn(this) : options.inverse(this);
  });

  /** Block helper: {{#or a b}}…{{/or}} — must not return bare boolean (prints "true"). */
  Handlebars.registerHelper('or', function (this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const values = args.slice(0, -1);
    return values.some((v) => !!v) ? options.fn(this) : options.inverse(this);
  });

  Handlebars.registerHelper('and', function (this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const values = args.slice(0, -1);
    return values.every((v) => !!v) ? options.fn(this) : options.inverse(this);
  });

  Handlebars.registerHelper('formatCurrency', function (value: unknown) {
    if (value == null || value === '') return '0.00';
    const num = Number(value);
    if (!Number.isFinite(num)) return '0.00';
    return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  });

  Handlebars.registerHelper('formatNumber', function (value: unknown) {
    if (value == null || value === '') return '0';
    const num = Number(value);
    if (!Number.isFinite(num)) return '0';
    return num.toFixed(2);
  });

  Handlebars.registerHelper('add', function (a: unknown, b: unknown) {
    return parseNum(a) + parseNum(b);
  });

  Handlebars.registerHelper('sum', function (...args: unknown[]) {
    return args.reduce<number>((acc, val) => acc + parseNum(val), 0);
  });

  Handlebars.registerHelper('itemTableColspan', function (this: unknown, options: Handlebars.HelperOptions) {
    const root = (options?.data?.root || options?.data || this) as {
      settings?: Record<string, unknown>;
    };
    const settings = root?.settings || {};
    let count = 0;
    if (settings.show_serial_number !== false) count++;
    if (settings.show_item_name !== false) count++;
    if (settings.show_hsn !== false) count++;
    if (settings.show_quantity !== false) count++;
    if (settings.show_rate !== false) count++;
    if (settings.show_discount_percent !== false) count++;
    if (settings.show_discount_amount !== false) count++;
    if (settings.show_tax_rate !== false) count++;
    if (settings.show_tax_amount !== false) count++;
    if (settings.show_line_total !== false) count++;
    return Math.max(1, count - 1);
  });

  Handlebars.registerHelper('multiply', function (a: unknown, b: unknown) {
    return parseNum(a) * parseNum(b);
  });

  Handlebars.registerHelper('subtract', function (a: unknown, b: unknown) {
    return parseNum(a) - parseNum(b);
  });

  Handlebars.registerHelper('divide', function (a: unknown, b: unknown) {
    const divisor = parseNum(b, 1);
    return divisor === 0 ? 0 : parseNum(a) / divisor;
  });

  Handlebars.registerHelper('gt', function (a: unknown, b: unknown) {
    return parseNum(a) > parseNum(b);
  });

  Handlebars.registerHelper('lt', function (a: unknown, b: unknown) {
    return parseNum(a) < parseNum(b);
  });

  Handlebars.registerHelper('eq', function (a: unknown, b: unknown) {
    return a == b;
  });

  Handlebars.registerHelper('ne', function (a: unknown, b: unknown) {
    return a != b;
  });

  Handlebars.registerHelper('not', function (value: unknown) {
    return !value;
  });

  Handlebars.registerHelper('json', function (context: unknown) {
    return JSON.stringify(context);
  });

  Handlebars.registerHelper('uppercase', function (str: unknown) {
    return str ? String(str).toUpperCase() : '';
  });

  Handlebars.registerHelper('lowercase', function (str: unknown) {
    return str ? String(str).toLowerCase() : '';
  });

  Handlebars.registerHelper('abs', function (value: unknown) {
    return Math.abs(parseNum(value));
  });
}
