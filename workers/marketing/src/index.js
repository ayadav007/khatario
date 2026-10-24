const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const IMAGE_MODEL = '@cf/black-forest-labs/flux-2-klein-9b';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function authorized(request, env) {
  const expected = String(env.MARKETING_WORKER_SECRET || '');
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!expected || token.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return mismatch === 0;
}

function clip(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseCopy(raw) {
  const cleaned = String(raw || '').replace(/```/g, '').trim();
  const [first, ...rest] = cleaned.split(/\n+/);
  const headline = clip((first || '').replace(/^headline:\s*/i, ''), 80);
  const caption = clip(rest.join(' ').replace(/^caption:\s*/i, ''), 500);
  if (!headline || !caption) return null;
  return { headline: headline.slice(0, 40), caption: caption.slice(0, 300) };
}

async function writeCopy(env, body) {
  const system = [
    'You write short Facebook and Instagram posts for Khatario, a GST billing app for Indian shopkeepers.',
    'First line is a headline of at most 40 characters.',
    'Then a blank line, then the caption in plain language, at most 300 characters.',
    'No hashtags, no quotes around the whole post, and no special symbols.',
    body.bannedClaims ? `Never use these claims: ${clip(body.bannedClaims, 400)}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const prompt = [
    `Audience: ${clip(body.audience, 240) || 'shopkeepers'}`,
    `Offer: ${clip(body.offer, 240) || 'GST invoices and khata'}`,
    body.angle ? `Angle: ${clip(body.angle, 240)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const result = await env.AI.run(TEXT_MODEL, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    max_tokens: 220,
  });
  const raw = typeof result?.response === 'string' ? result.response : '';
  const copy = parseCopy(raw);
  if (!copy) return json({ error: 'The text model returned an empty post' }, 502);
  return json(copy);
}

function imagePrompt(body) {
  const scene = clip(body.angle || body.offer || 'a shopkeeper using a phone to make a GST bill', 240);
  if (body.style === 'poster') {
    const headline = clip(body.headline, 40) || 'Khatario';
    return [
      'Vertical marketing poster, 4:5, for an Indian shop billing app.',
      `Scene: ${scene}.`,
      `Paint this exact headline in large bold white letters: ${headline}.`,
      'Teal and white, uncluttered, no extra slogans, no watermark, no misspelled words.',
    ].join(' ');
  }
  return [
    'Realistic photo inside an Indian kirana or small shop.',
    `Scene: ${scene}.`,
    'Natural light. No text, no letters, no logo, no watermark, no poster layout.',
  ].join(' ');
}

async function imageBytes(env, body) {
  const poster = body.style === 'poster';
  const form = new FormData();
  form.append('prompt', imagePrompt(body));
  form.append('width', '1080');
  form.append('height', poster ? '1350' : '1080');
  const formResponse = new Response(form);
  const result = await env.AI.run(IMAGE_MODEL, {
    multipart: {
      body: formResponse.body,
      contentType: formResponse.headers.get('content-type'),
    },
  });
  const image = result?.image;
  if (typeof image !== 'string' || !image.trim()) {
    throw new Error('The image model returned no picture');
  }
  const raw = image.replace(/^data:image\/\w+;base64,/, '');
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export default {
  async fetch(request, env) {
    if (!env.MARKETING_WORKER_SECRET) return json({ error: 'Worker secret is not set' }, 503);
    if (!authorized(request, env)) return json({ error: 'Unauthorized' }, 401);
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const path = new URL(request.url).pathname;
    let body = {};
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Send a JSON body' }, 400);
    }

    try {
      if (path === '/copy') return await writeCopy(env, body);
      if (path === '/image') {
        const bytes = await imageBytes(env, body);
        return new Response(bytes, { headers: { 'content-type': 'image/png' } });
      }
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Worker failed';
      return json({ error: message.slice(0, 300) }, 502);
    }
  },
};
