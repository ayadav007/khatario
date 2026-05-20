import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';

let registered = false;

/** Register shared invoice partials (custom fields, etc.) once per process. */
export function registerInvoiceHandlebarsPartials(): void {
  if (registered) return;
  const partialsDir = path.join(process.cwd(), 'templates', 'partials');
  const names = ['custom-invoice-meta', 'custom-item-lines', 'thermal-items'];
  for (const name of names) {
    const filePath = path.join(partialsDir, `${name}.html`);
    if (fs.existsSync(filePath)) {
      Handlebars.registerPartial(name, fs.readFileSync(filePath, 'utf-8'));
    }
  }
  registered = true;
}
