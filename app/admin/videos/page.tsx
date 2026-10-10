'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Video } from 'lucide-react';
import { useAdmin } from '@/context/AdminContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';

type Scene = {
  image?: string;
  imageData?: string;
  videoData?: string;
  preview?: string;
  media?: 'image' | 'video';
  caption: string;
  voice: string;
  transition?: 'cut' | 'crossfade' | 'slide';
  transitionSeconds?: number;
  zoomOn?: boolean;
  zoomAt?: number;
  zoomHold?: number;
  zoomX?: number;
  zoomY?: number;
  markW?: number;
  markH?: number;
  shape?: 'circle' | 'rect' | 'none';
};

type Preset = {
  title: string;
  subtitle: string;
  intro: string;
  voice: boolean;
  scenes: Scene[];
};

function formatClock(seconds: number) {
  const total = Math.max(0, Math.round(seconds || 0));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

function parseClock(value: string) {
  const parts = value.trim().split(':').map((part) => Number(part));
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

function AimFrame({ scene, onPoint, onTime, onMark }: { scene: Scene; onPoint: (x: number, y: number) => void; onTime: (seconds: number) => void; onMark: (patch: Partial<Scene>) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLButtonElement>(null);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(scene.zoomAt || 0);
  const [duration, setDuration] = useState(0);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const src = scene.preview || (scene.image ? `/api/admin/videos/shots/${scene.image}` : '');
  const mark = box || {
    x: scene.zoomX ?? 50,
    y: scene.zoomY ?? 50,
    w: scene.markW ?? (scene.shape === 'rect' ? 28 : 18),
    h: scene.markH ?? 24,
  };

  function beginDrag(event: ReactPointerEvent, resizing: boolean) {
    event.preventDefault();
    event.stopPropagation();
    const bounds = frameRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...mark };
    const move = (ev: PointerEvent) => {
      const dx = ((ev.clientX - startX) / bounds.width) * 100;
      const dy = ((ev.clientY - startY) / bounds.height) * 100;
      const next = resizing
        ? {
            ...origin,
            w: Math.min(90, Math.max(4, origin.w + dx)),
            h: scene.shape === 'rect' ? Math.min(90, Math.max(4, origin.h + dy)) : origin.h,
          }
        : {
            ...origin,
            x: Math.min(100, Math.max(0, Math.round((origin.x + dx) * 10) / 10)),
            y: Math.min(100, Math.max(0, Math.round((origin.y + dy) * 10) / 10)),
          };
      setBox(next);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      setBox((current) => {
        if (current) onMark({ zoomX: current.x, zoomY: current.y, markW: current.w, markH: current.h });
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const reveal = () => video.play().then(() => video.pause()).catch(() => undefined);
    const seek = () => {
      const limit = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : scene.zoomAt || 0;
      const next = Math.min(scene.zoomAt || 0, limit);
      if (Math.abs(video.currentTime - next) > 0.05) video.currentTime = next;
    };
    const onData = () => {
      if ((scene.zoomAt || 0) > 0.05) {
        video.addEventListener('seeked', reveal, { once: true });
        seek();
      } else {
        reveal();
      }
    };
    video.addEventListener('loadeddata', onData);
    if (video.readyState >= 2) onData();
    return () => video.removeEventListener('loadeddata', onData);
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.paused) return;
    const limit = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : scene.zoomAt || 0;
    const next = Math.min(scene.zoomAt || 0, limit);
    if (Math.abs(video.currentTime - next) > 0.2) video.currentTime = next;
  }, [scene.zoomAt]);

  return (
    <div className="max-w-xl">
      <button
        ref={frameRef}
        type="button"
        className="relative block aspect-video w-full overflow-hidden rounded-lg bg-black"
        onClick={(event) => {
          const video = videoRef.current;
          if (video) video.pause();
          const box = event.currentTarget.getBoundingClientRect();
          const x = Math.round(((event.clientX - box.left) / box.width) * 1000) / 10;
          const y = Math.round(((event.clientY - box.top) / box.height) * 1000) / 10;
          onPoint(x, y);
          if (video) onTime(Math.round(video.currentTime * 10) / 10);
        }}
      >
        {scene.media === 'video' && scene.preview ? (
          <video
            ref={videoRef}
            src={scene.preview}
            muted
            playsInline
            preload="auto"
            className="h-full w-full object-cover"
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
            onTimeUpdate={(event) => setNow(event.currentTarget.currentTime || 0)}
            onPlay={() => setPlaying(true)}
            onPause={(event) => {
              setPlaying(false);
              onTime(Math.round(event.currentTarget.currentTime * 10) / 10);
            }}
          />
        ) : src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : null}
        {scene.zoomOn && scene.shape !== 'none' ? (
          <i
            className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-grab border-[3px] border-[#f58220] ${scene.shape === 'rect' ? 'rounded-lg' : 'aspect-square rounded-full'}`}
            style={{ left: `${mark.x}%`, top: `${mark.y}%`, width: `${mark.w}%`, height: scene.shape === 'rect' ? `${mark.h}%` : undefined }}
            onPointerDown={(event) => beginDrag(event, false)}
            onClick={(event) => event.stopPropagation()}
          >
            <b
              className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm bg-[#f58220]"
              onPointerDown={(event) => beginDrag(event, true)}
            />
          </i>
        ) : null}
      </button>
      {scene.media === 'video' && scene.preview ? (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium"
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              if (video.paused) {
                video.muted = false;
                void video.play();
              } else video.pause();
            }}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(now, duration || now)}
            className="min-w-0 flex-1"
            onChange={(event) => {
              const video = videoRef.current;
              const at = Number(event.target.value);
              if (video) {
                video.pause();
                video.currentTime = at;
              }
              setNow(at);
              onTime(Math.round(at * 10) / 10);
            }}
          />
          <span className="w-12 text-sm font-semibold tabular-nums text-gray-700">{formatClock(now)}</span>
        </div>
      ) : null}
    </div>
  );
}

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
  const [job, setJob] = useState('');
  const [saved, setSaved] = useState<{ stamp: string; bytes: number }[]>([]);

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
    void loadSaved();
  }, []);

  async function loadSaved() {
    const res = await fetch('/api/admin/videos?saved=1', platformAdminFetchInit);
    const data = await res.json();
    if (res.ok) setSaved(data.videos || []);
  }

  async function deleteSaved(stamp: string) {
    const res = await fetch(`/api/admin/videos/file/${stamp}`, { ...platformAdminFetchInit, method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not delete that video');
    if (job === stamp) {
      setVideoUrl('');
      setJob('');
    }
    await loadSaved();
  }

  function newProject() {
    setTitle('');
    setSubtitle('');
    setIntro('');
    setVoice(true);
    setScenes([]);
    setVideoUrl('');
    setError('');
    setLog('New project. Add a screenshot or an MP4, then write a spoken line for each scene.');
  }

  function addMedia(kind: 'image' | 'video') {
    const input = document.createElement('input');
    input.type = 'file';
    if (kind === 'image') input.setAttribute('multiple', '');
    input.accept = kind === 'video' ? 'video/mp4' : 'image/png,image/jpeg';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = () => {
      input.remove();
      const files = Array.from(input.files || []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      if (!files.length) return;
      Promise.all(files.map((file) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      }))).then((urls) => {
        setScenes((current) => [
          ...current,
          ...urls.map((url) => ({
            caption: '',
            voice: '',
            transition: 'crossfade' as const,
            transitionSeconds: 1,
            media: kind,
            preview: url,
            imageData: kind === 'image' ? url : '',
            videoData: kind === 'video' ? url : '',
          })),
        ]);
        setLog(files.length === 1
          ? 'Added 1 scene. Write a spoken line for it.'
          : `Added ${files.length} scenes, in filename order. Write a spoken line for each one.`);
      }).catch(() => setError('Could not read one of the selected files.'));
    };
    input.click();
  }

  function replaceMedia(index: number) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,video/mp4';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const kind = file.type.startsWith('video/') ? 'video' : 'image';
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result || '');
        updateScene(index, {
          media: kind,
          preview: url,
          image: '',
          imageData: kind === 'image' ? url : '',
          videoData: kind === 'video' ? url : '',
        });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  function updateScene(index: number, patch: Partial<Scene>) {
    setScenes((current) => current.map((scene, i) => (i === index ? { ...scene, ...patch } : scene)));
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
      setJob(data.job);
      setVideoUrl(data.video);
      await loadSaved();
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
        The voice reads the spoken line under each scene. Turn on Zoom, type a time such as 3:25, and click the face or button on that frame. The view moves in over 1 second, holds, then moves back in half a second.
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
        <button type="button" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium" onClick={newProject}>
          New project
        </button>
        <button type="button" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium" onClick={() => void loadPreset()}>
          Load invoice screens
        </button>
        <button type="button" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium" onClick={() => addMedia('image')}>
          Add screenshots
        </button>
        <button type="button" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium" onClick={() => addMedia('video')}>
          Add an MP4
        </button>
        <button type="button" className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60" disabled={busy || scenes.length === 0} onClick={() => void renderVideo()}>
          {busy ? 'Making the video…' : 'Make the video'}
        </button>
      </div>

      <div className="mt-6 space-y-3">
        {scenes.map((scene, index) => (
          <article key={`${scene.image || scene.media || 'scene'}-${index}`} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
            <AimFrame
              scene={scene}
              onPoint={(x, y) => updateScene(index, { zoomOn: true, zoomX: x, zoomY: y, shape: scene.shape || 'circle' })}
              onTime={(seconds) => updateScene(index, { zoomAt: seconds })}
              onMark={(patch) => updateScene(index, patch)}
            />
            <div>
              <label className="block text-xs font-semibold uppercase text-gray-500">On-screen caption</label>
              <textarea className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" rows={2} value={scene.caption} onChange={(e) => updateScene(index, { caption: e.target.value })} />
              <label className="mt-3 block text-xs font-semibold uppercase text-gray-500">Spoken line</label>
              <textarea className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" rows={2} value={scene.voice} onChange={(e) => updateScene(index, { voice: e.target.value })} />
              <div className="mt-3 flex flex-wrap gap-3">
                <label className="text-xs font-semibold uppercase text-gray-500">
                  Transition
                  <select
                    className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium normal-case text-gray-900"
                    value={scene.transition || 'crossfade'}
                    onChange={(e) => updateScene(index, { transition: e.target.value as Scene['transition'] })}
                  >
                    <option value="cut">Cut</option>
                    <option value="crossfade">Crossfade</option>
                    <option value="slide">Slide</option>
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase text-gray-500">
                  Seconds
                  <input
                    type="number"
                    min={0.2}
                    max={3}
                    step={0.1}
                    className="mt-1 block w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-900"
                    value={scene.transitionSeconds ?? 1}
                    disabled={(scene.transition || 'crossfade') === 'cut'}
                    onChange={(e) => updateScene(index, { transitionSeconds: Number(e.target.value) })}
                  />
                </label>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
                <input type="checkbox" checked={scene.zoomOn === true} onChange={(e) => updateScene(index, { zoomOn: e.target.checked, zoomX: scene.zoomX ?? 50, zoomY: scene.zoomY ?? 50, shape: scene.shape || 'circle' })} />
                Zoom into this frame
              </label>
              <div className="mt-3 flex flex-wrap gap-3">
                <label className="text-xs font-semibold uppercase text-gray-500">
                  Zoom at
                  <input className="mt-1 block w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium normal-case text-gray-900" defaultValue={formatClock(scene.zoomAt || 0)} key={`${index}-at-${scene.zoomAt || 0}`} onBlur={(e) => updateScene(index, { zoomAt: parseClock(e.target.value) })} />
                </label>
                <label className="text-xs font-semibold uppercase text-gray-500">
                  Hold for seconds
                  <input type="number" min={0.4} max={180} step={1} className="mt-1 block w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-900" value={scene.zoomHold ?? 30} onChange={(e) => updateScene(index, { zoomHold: Number(e.target.value) })} />
                </label>
                <label className="text-xs font-semibold uppercase text-gray-500">
                  Mark
                  <select className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium normal-case text-gray-900" value={scene.shape || 'circle'} onChange={(e) => updateScene(index, { shape: e.target.value as Scene['shape'] })}>
                    <option value="circle">Circle</option>
                    <option value="rect">Rectangle</option>
                    <option value="none">No mark</option>
                  </select>
                </label>
              </div>
              <p className="mt-2 text-sm text-gray-500">Drag the mark to move it. Drag the orange corner to resize it.</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button type="button" className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium" onClick={() => replaceMedia(index)}>
                  Change picture
                </button>
                <button type="button" className="text-sm font-medium text-red-700" onClick={() => setScenes((current) => current.filter((_, i) => i !== index))}>
                  Remove scene {index + 1}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      <pre className="mt-6 whitespace-pre-wrap rounded-xl bg-gray-900 p-4 text-sm text-gray-100">{log}</pre>
      {error ? <p className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}
      {videoUrl ? (
        <div className="mt-4">
          <video className="w-full rounded-xl bg-black" controls src={videoUrl} />
          <div className="mt-3 flex flex-wrap gap-2">
            <a className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium" href={`${videoUrl}?download=1`}>Download</a>
            <button type="button" className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700" onClick={() => void deleteSaved(job).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not delete that video'))}>Delete from server</button>
          </div>
        </div>
      ) : null}
      <h2 className="mt-8 text-xl font-bold text-gray-900">Saved videos</h2>
      <p className="mt-1 text-sm text-gray-600">These files are stored on the server that made them. Download a copy, then delete it so it does not keep using disk.</p>
      <div className="mt-3 space-y-2">
        {saved.length === 0 ? <p className="text-sm text-gray-500">No saved videos.</p> : null}
        {saved.map((video) => (
          <div key={video.stamp} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2">
            <span className="text-sm text-gray-800">{video.stamp} · {(video.bytes / (1024 * 1024)).toFixed(1)} MB</span>
            <a className="text-sm font-medium text-primary-700" href={`/api/admin/videos/file/${video.stamp}?download=1`}>Download</a>
            <button type="button" className="text-sm font-medium text-red-700" onClick={() => void deleteSaved(video.stamp).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not delete that video'))}>Delete from server</button>
          </div>
        ))}
      </div>
    </div>
  );
}
