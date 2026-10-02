/** Text layer of a PDF (no OCR). `maxPages` stops parsing early for large uploads. */
export async function pdfBufferToText(
  buffer: Buffer,
  opts: { maxPages?: number } = {},
): Promise<{ text: string; numpages: number }> {
  // pdf-parse is CommonJS
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse') as (
    b: Buffer,
    o?: { max?: number },
  ) => Promise<{ text: string; numpages: number }>;
  const res = await pdfParse(buffer, opts.maxPages ? { max: opts.maxPages } : undefined);
  return { text: res.text || '', numpages: res.numpages || 0 };
}
