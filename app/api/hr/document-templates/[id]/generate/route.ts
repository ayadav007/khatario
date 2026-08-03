import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  generateDocumentHtml,
  logDocumentGeneration,
} from '@/lib/hr/document-templates';
import { htmlToPdfBuffer } from '@/lib/hr/html-to-pdf';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'employees', 'read', { businessId });

    const body = await request.json();
    const employeeId = String(body?.employee_id ?? '');
    if (!employeeId) {
      return NextResponse.json({ error: 'employee_id is required' }, { status: 400 });
    }

    const { html, template } = await generateDocumentHtml(businessId, params.id, employeeId);
    await logDocumentGeneration(businessId, params.id, employeeId, html, userId);

    const format = body?.format === 'word' ? 'word' : body?.format === 'pdf' ? 'pdf' : 'html';

    if (format === 'pdf') {
      const m = template.margin_mm;
      const pdf = await htmlToPdfBuffer(html, {
        top: `${m.top}mm`,
        right: `${m.right}mm`,
        bottom: `${m.bottom}mm`,
        left: `${m.left}mm`,
      });
      return new NextResponse(pdf, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${template.name.replace(/\s+/g, '-')}.pdf"`,
        },
      });
    }

    if (format === 'word') {
      const wordHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
        xmlns:w="urn:schemas-microsoft-com:office:word">${html}</html>`;
      return new NextResponse(wordHtml, {
        headers: {
          'Content-Type': 'application/msword',
          'Content-Disposition': `attachment; filename="${template.name.replace(/\s+/g, '-')}.doc"`,
        },
      });
    }

    return NextResponse.json({ html, template_id: params.id, employee_id: employeeId });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const message = error instanceof Error ? error.message : 'Generation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
