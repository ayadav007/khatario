const MAX_PROMPT = 500;

export class BlogAiImageError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'BlogAiImageError';
    this.status = status;
  }
}

export function blogAiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

/** Optional. Publishing does not depend on this. */
export async function generateBlogImage(prompt: string): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new BlogAiImageError('AI images are not configured. Upload an image or choose one from the library.', 503);
  }
  const text = prompt.replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT);
  if (text.length < 3) throw new BlogAiImageError('Describe the image you want', 400);

  const model = process.env.BLOG_IMAGE_MODEL?.trim() || 'gemini-2.5-flash-image';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{
            text: `A single landscape photograph for a blog article. No words, letters, or watermarks. ${text}`,
          }],
        }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      }),
    },
  );

  const payload = await response.json().catch(() => null) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new BlogAiImageError(payload?.error?.message || 'AI image request failed');
  }
  const parts = payload?.candidates?.[0]?.content?.parts ?? [];
  const inline = parts.find((part) => part.inlineData?.data)?.inlineData;
  if (!inline?.data) throw new BlogAiImageError('The image model did not return an image');
  return Buffer.from(inline.data, 'base64');
}
