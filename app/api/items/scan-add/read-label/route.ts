import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireStrictSession } from '@/lib/auth-helpers';
import {
  LABEL_STEPS,
  LabelReaderUnavailableError,
  readProductLabel,
  type LabelStep,
} from '@/lib/product-lookup/label-reader';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/items/scan-add/read-label  (multipart: image, step = front | details | size)
 * Reads one label photo and returns what is printed on it. Nothing is saved.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;

    try {
      await authorize(session.userId, 'items', 'create', { businessId: session.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const form = await request.formData();
    const step = String(form.get('step') ?? '') as LabelStep;
    if (!LABEL_STEPS.includes(step)) {
      return NextResponse.json({ error: 'step must be front, details or size' }, { status: 400 });
    }
    const image = form.get('image');
    if (!(image instanceof Blob) || image.size === 0) {
      return NextResponse.json({ error: 'Add a photo of the label' }, { status: 400 });
    }
    if (image.size > MAX_BYTES) {
      return NextResponse.json({ error: 'The photo is too large. Use one under 10 MB.' }, { status: 413 });
    }
    const mime = image.type || 'image/jpeg';
    if (!mime.startsWith('image/')) {
      return NextResponse.json({ error: 'Only photos can be read' }, { status: 400 });
    }

    const reading = await readProductLabel(Buffer.from(await image.arrayBuffer()), mime, step);
    return NextResponse.json({ step, reading });
  } catch (error) {
    if (error instanceof LabelReaderUnavailableError) {
      return NextResponse.json({ error: 'Reading labels is not set up on this server. Type the details instead.' }, { status: 503 });
    }
    console.error('[scan-add/read-label]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not read this photo. Try again or type the details.' }, { status: 502 });
  }
}
