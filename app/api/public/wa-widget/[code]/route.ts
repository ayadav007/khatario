/**
 * GET /api/public/wa-widget/:code - the website "Chat on WhatsApp" button.
 * Paste <script src="…/api/public/wa-widget/CODE" async></script> on any site; it draws a floating
 * button that opens the tracked link (counted as a widget click).
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolvePublicRequestOrigin } from '@/lib/http/public-request-origin';
import { widgetLink } from '@/lib/whatsapp/lead-sources';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> | { code: string } }) {
  const { code } = await params;
  const link = await widgetLink(code.replace(/\.js$/i, '')).catch(() => null);
  const headers = { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' };
  if (!link) return new NextResponse('/* Khatario: this WhatsApp button is no longer active */', { status: 404, headers });

  const href = `${resolvePublicRequestOrigin(request)}/w/${link.code}?via=widget`;
  const js = `(function(){
  if (document.getElementById('kh-wa-btn')) return;
  var a = document.createElement('a');
  a.id = 'kh-wa-btn';
  a.href = ${JSON.stringify(href)};
  a.target = '_blank';
  a.rel = 'noopener';
  a.setAttribute('aria-label', 'Chat with us on WhatsApp');
  a.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:8px;' +
    'padding:12px 16px;border-radius:999px;background:#25D366;color:#fff;font:600 15px/1 system-ui,sans-serif;' +
    'text-decoration:none;box-shadow:0 6px 20px rgba(0,0,0,.2)';
  a.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.5.3.1.2.1.7-.1 1.3z"/></svg><span>Chat with us</span>';
  (document.body || document.documentElement).appendChild(a);
})();`;
  return new NextResponse(js, { status: 200, headers });
}
