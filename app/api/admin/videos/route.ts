import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Studio = {
  preset: {
    title: string;
    subtitle: string;
    intro: string;
    voice: boolean;
    scenes: { image: string; caption: string; voice: string }[];
  };
  renderJob: (body: unknown, log: (line: string) => void) => Promise<{ job: string }>;
  shotFile: (name: string) => string | null;
  videoFile: (stamp: string) => string | null;
};

async function studio(): Promise<Studio> {
  return import('@/tools/video-studio/server.mjs') as Promise<Studio>;
}

async function requireAdmin(request: NextRequest) {
  return requirePlatformRequest(request, 'admin');
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const engine = await studio();
  return NextResponse.json(engine.preset);
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const engine = await studio();
    const logs: string[] = [];
    const result = await engine.renderJob(body, (line) => logs.push(line));
    return NextResponse.json({
      job: result.job,
      video: `/api/admin/videos/file/${result.job}`,
      logs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Render failed';
    return NextResponse.json({ error: message.slice(0, 800) }, { status: 500 });
  }
}

export async function streamShot(name: string) {
  const engine = await studio();
  const file = engine.shotFile(name);
  if (!file) return null;
  return new NextResponse(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' },
  });
}

export async function streamVideo(stamp: string) {
  const engine = await studio();
  const file = engine.videoFile(stamp);
  if (!file) return null;
  return new NextResponse(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, no-store' },
  });
}
