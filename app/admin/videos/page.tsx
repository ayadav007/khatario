'use client';

import { useEffect, useState } from 'react';
import { Video } from 'lucide-react';
import { useAdmin } from '@/context/AdminContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';

type Scene = {
  image?: string;
  imageData?: string;
  preview?: string;
  caption: string;
  voice: string;
};

type Preset = {
  title: string;
  subtitle: string;
  intro: string;
  voice: boolean;
  scenes: Scene[];
};

export default function AdminVideosPage() {
  useAdmin();
  const [title, setTitle] = useState('How to create an invoice');
  const [subtitle, setSubtitle] = useState('');
  const [intro, setIntro] = useState('');
  const [voice, setVoice] = useState(true);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [log, setLog] = useState('Load the invoice screens, edit the spoken lines, then make the video.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');

  async function loadPreset() {
    setError('');
    const res = await fetch('/api/admin/videos', platformAdminFetchInit);
    const data = (await res.json()) as Preset & { error?: string };
    if (!res.ok) throw new Error(data.error || 'Could not load the invoice screens');
    setTitle(data.title);
    setSubtitle(data.subtitle);
    setIntro(data.intro);
    setVoice(data.voice);
    setScenes(data.scenes.map((scene) => ({ ...scene })));
    setLog('Loaded the staging invoice screens. The spoken line is what the voice reads.');
  }

  useEffect(() => {
    void loadPreset().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not load the invoice screens');
    });
  }, []);

  function updateScene(index: number, field: 'caption' | 'voice', value: string) {
    setScenes((current) => current.map((scene, i) => (i === index ? { ...scene, [field]: value } : scene)));
  }

  async function renderVideo() {
    setBusy(true);
    setError('');
    setLog('Working. A voiceover takes a few minutes on this computer.');
    try {
      const res = await fetch('/api/admin/videos', {
        ...platformAdminFetchInit,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, subtitle, intro, voice, scenes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Render failed');
      setLog((data.logs || []).join('\n') || 'Done.');
      setVideoUrl(data.video);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Render failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="flex items-center gap-2 text-3xl font-bold text-gray-900">
        <Video className="h-8 w-8 text-primary-600" />
        Videos
      </h1>
      <p className="mt-2 max-w-2xl text-gray-600">
        The voice reads the spoken line under each scene, not the words on the invoice. Rendering uses Chrome, FFmpeg, and the speech model on the computer running this admin server.
      </p>

      <label className="mt-6 block text-sm font-semibold text-gray-700" htmlFor="video-title">Title</label>
      <input id="video-title" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" value={title} onChange={(e) => setTitle(e.target.value)} />

      <label className="mt-4 block text-sm font-semibold text-gray-700" htmlFor="video-subtitle">Subtitle</label>
      <input id="video-subtitle" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />

      <label className="mt-4 block text-sm font-semibold text-gray-700" htmlFor="video-intro">Opening line</label>
      <input id="video-intro" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" value={intro} onChange={(e) => setIntro(e.target.value)} />

      <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-gray-800">
        <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} />
        Speak the lines
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium" onClick={() => void loadPreset()}>
          Reload invoice screens
        </button>
        <button type="button" className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60" disabled={busy || scenes.length === 0} onClick={() => void renderVideo()}>
          {busy ? 'Making the video…' : 'Make the video'}
        </button>
      </div>

      <div className="mt-6 space-y-3">
        {scenes.map((scene, index) => (
          <article key={scene.image || index} className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-[160px_1fr]">
            {scene.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/admin/videos/shots/${scene.image}`} alt="" className="h-24 w-40 rounded-lg object-cover" />
            ) : null}
            <div>
              <label className="block text-xs font-semibold uppercase text-gray-500">On-screen caption</label>
              <textarea className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" rows={2} value={scene.caption} onChange={(e) => updateScene(index, 'caption', e.target.value)} />
              <label className="mt-3 block text-xs font-semibold uppercase text-gray-500">Spoken line</label>
              <textarea className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" rows={2} value={scene.voice} onChange={(e) => updateScene(index, 'voice', e.target.value)} />
            </div>
          </article>
        ))}
      </div>

      <pre className="mt-6 whitespace-pre-wrap rounded-xl bg-gray-900 p-4 text-sm text-gray-100">{log}</pre>
      {error ? <p className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}
      {videoUrl ? <video className="mt-4 w-full rounded-xl bg-black" controls src={videoUrl} /> : null}
    </div>
  );
}
