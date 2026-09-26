import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { platformChat } from '@/lib/ai/platform-chat';
import {
  SEO_DESC_MAX,
  SEO_TITLE_MAX,
  clipSeoDescription,
  clipSeoTitle,
  type SeoDraftInput,
} from '@/lib/store/item-seo';

export const dynamic = 'force-dynamic';

function parseAiJson(raw: string): { title?: string; description?: string } {
  const trimmed = raw.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
      title?: unknown;
      description?: unknown;
    };
    return {
      title: typeof parsed.title === 'string' ? parsed.title : undefined,
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
    };
  } catch {
    return {};
  }
}

function buildPrompt(input: SeoDraftInput): string {
  return [
    'Write SEO copy for an Indian online store product.',
    `Name: ${input.name}`,
    input.brand ? `Brand: ${input.brand}` : '',
    input.category ? `Category: ${input.category}` : '',
    input.description ? `Description: ${input.description.slice(0, 400)}` : '',
    `Return JSON only: {"title":"max ${SEO_TITLE_MAX} characters","description":"max ${SEO_DESC_MAX} characters"}`,
    'Title is specific, no quotes. Description invites a shopper to buy. No hashtags.',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const tenant = requireTenantBusinessId(request, body.business_id);
  if (!tenant.ok) return tenant.response;
  const userId = getUserIdFromRequest(request, body);
  if (!userId) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  try {
    await authorize(userId, 'items', 'update', { businessId: tenant.businessId });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  const field = body.field === 'description' ? 'description' : body.field === 'title' ? 'title' : 'both';
  const input: SeoDraftInput = {
    name: String(body.name ?? ''),
    description: typeof body.description === 'string' ? body.description : '',
    brand: typeof body.brand === 'string' ? body.brand : '',
    category: typeof body.category === 'string' ? body.category : '',
  };
  if (!input.name.trim()) {
    return NextResponse.json({ error: 'Enter the item name first' }, { status: 400 });
  }

  try {
    const raw = await platformChat(
      'You write concise ecommerce SEO for Indian shoppers. Reply with JSON only.',
      buildPrompt(input),
      tenant.businessId,
    );
    const parsed = parseAiJson(raw);
    const title = clipSeoTitle(parsed.title);
    const description = clipSeoDescription(parsed.description);
    if ((field === 'title' && !title) || (field === 'description' && !description) || (!title && !description)) {
      return NextResponse.json({ error: 'Khatario AI returned empty copy. Try again.' }, { status: 502 });
    }
    return NextResponse.json({
      title,
      description,
      field,
      source: 'khatario',
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'KHATARIO_AI_UNAVAILABLE') {
      return NextResponse.json(
        { error: 'Khatario AI is not configured on this server.' },
        { status: 503 },
      );
    }
    console.error('[seo-suggest]', error);
    return NextResponse.json(
      { error: 'Could not generate copy. Try again in a moment.' },
      { status: 502 },
    );
  }
}
