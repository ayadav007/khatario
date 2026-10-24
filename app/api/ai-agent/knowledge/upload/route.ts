import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { countKnowledge, createKnowledge, KNOWLEDGE_LIMITS } from '@/lib/ai-agent/knowledge';
import { pdfBufferToText } from '@/lib/documents/pdf-text';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PDF_PAGES = 30;

function kindOf(name: string, type: string): 'pdf' | 'txt' | 'csv' | null {
  const ext = name.toLowerCase().split('.').pop() || '';
  if (ext === 'pdf' || type === 'application/pdf') return 'pdf';
  if (ext === 'csv' || type === 'text/csv') return 'csv';
  if (ext === 'txt' || ext === 'md' || type === 'text/plain') return 'txt';
  return null;
}

/** CSV rows become "Header: value" lines so each row reads as a small fact sheet. */
function csvToText(csv: string): string {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return csv;
  const split = (l: string) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  const header = split(lines[0]);
  return lines
    .slice(1)
    .map((l) => {
      const cells = split(l);
      return header.map((h, i) => (cells[i] ? `${h || `Column ${i + 1}`}: ${cells[i]}` : null)).filter(Boolean).join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * POST /api/ai-agent/knowledge/upload — multipart `file` (PDF, TXT or CSV, up to 5 MB, 30 PDF pages)
 * and optional `title`. Only the extracted text is kept; the file itself is discarded.
 */
export const POST = withWhatsAppPremiumApi({ module: 'whatsapp', action: 'update' }, async ({ businessId, userId, request }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Upload a file' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof Blob) || !('name' in file)) {
    return NextResponse.json({ error: 'Upload a file' }, { status: 400 });
  }
  const name = String((file as File).name || 'upload');
  const kind = kindOf(name, file.type);
  if (!kind) return NextResponse.json({ error: 'Only PDF, TXT or CSV files are supported' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File is larger than 5 MB' }, { status: 400 });
  if ((await countKnowledge(businessId)) >= KNOWLEDGE_LIMITS.maxItems) {
    return NextResponse.json({ error: `You can add up to ${KNOWLEDGE_LIMITS.maxItems} knowledge items` }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let text = '';
  let warning: string | undefined;
  try {
    if (kind === 'pdf') {
      const res = await pdfBufferToText(buffer, { maxPages: MAX_PDF_PAGES });
      text = res.text;
      if (res.numpages > MAX_PDF_PAGES) warning = `Only the first ${MAX_PDF_PAGES} pages were read.`;
    } else {
      const raw = buffer.toString('utf8').replace(/^\uFEFF/, '');
      text = kind === 'csv' ? csvToText(raw) : raw;
    }
  } catch (error) {
    console.warn('[ai-agent] upload parse failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Couldn't read this file. Is it a valid PDF?" }, { status: 400 });
  }

  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 20) {
    return NextResponse.json(
      { error: 'No readable text found. Scanned PDFs need a text layer — try exporting it as text.' },
      { status: 400 },
    );
  }
  if (text.length > KNOWLEDGE_LIMITS.textMax) {
    text = text.slice(0, KNOWLEDGE_LIMITS.textMax);
    warning = `${warning ? `${warning} ` : ''}The text was trimmed to ${KNOWLEDGE_LIMITS.textMax.toLocaleString('en-IN')} characters.`;
  }

  const titleField = form.get('title');
  const title = (typeof titleField === 'string' && titleField.trim()) || name.replace(/\.[^.]+$/, '');
  try {
    const item = await createKnowledge(
      businessId,
      { kind: 'file', title: title.slice(0, KNOWLEDGE_LIMITS.titleMax), content: text, fileName: name.slice(0, 255), fileSize: file.size },
      userId,
    );
    return NextResponse.json({ item: { ...item, content: item.content.slice(0, KNOWLEDGE_LIMITS.previewChars) }, warning }, { status: 201 });
  } catch (error) {
    console.error('[ai-agent] upload save failed:', error);
    return NextResponse.json({ error: 'Failed to save the file text' }, { status: 500 });
  }
});
