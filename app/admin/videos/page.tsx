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
  highlights?: Highlight[];
  zoomOn?: boolean;
  zoomAt?: number;
  zoomHold?: number;
  zoomX?: number;
  zoomY?: number;
  markW?: number;
  markH?: number;
  shape?: 'circle' | 'rect' | 'none';
};

type Highlight = {
  phrase: string;
  at: number;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: 'circle' | 'rect' | 'none';
  zoom: number;
  hold: number;
};

type Preset = {
  title: string;
  subtitle: string;
  intro: string;
  voice: boolean;
  scenes: Scene[];
};

function formatTime(seconds: number) {
  const tenths = Math.max(0, Math.round((seconds || 0) * 10));
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths % 600) / 10;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

function parseClock(value: string) {
  const parts = value.trim().split(':').map((part) => Number(part));
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

function words(text: string) {
  return text.toLowerCase().split(/\s+/).map((word) => word.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
}

/** Mirrors the server: exact phrase, else the first word as a prefix, else not found. */
function phraseMatch(voice: string, phrase: string): 'exact' | 'word' | 'missing' {
  const want = words(phrase);
  const have = words(voice);
  if (!want.length) return 'missing';
  for (let i = 0; i + want.length <= have.length; i += 1) {
    if (want.every((token, j) => have[i + j] === token)) return 'exact';
  }
  return have.some((token) => token.startsWith(want[0])) ? 'word' : 'missing';
}

function highlightsOf(scene: Scene): Highlight[] {
  if (scene.highlights) return scene.highlights;
  if (!scene.zoomOn) return [];
  const shape = scene.shape || 'circle';
  return [{
    phrase: '',
    at: scene.zoomAt || 0,
    x: scene.zoomX ?? 50,
    y: scene.zoomY ?? 50,
    w: scene.markW ?? (shape === 'rect' ? 28 : 14),
    h: scene.markH ?? 16,
    shape,
    zoom: 2,
    hold: Math.min(scene.zoomHold ?? 2, 30),
  }];
}

const fieldClass = 'mt-1 block rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-medium normal-case text-gray-900';

function SceneCard({ scene, index, voiceOn, onChange, onReplace, onRemove }: {
  scene: Scene;
  index: number;
  voiceOn: boolean;
  onChange: (patch: Partial<Scene>) => void;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const voiceRef = useRef<HTMLTextAreaElement>(null);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [duration, setDuration] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [picked, setPicked] = useState('');
  const [drag, setDrag] = useState<{ i: number; x: number; y: number; w: number; h: number } | null>(null);
  const list = highlightsOf(scene);
  const isVideo = scene.media === 'video' && Boolean(scene.preview);
  const src = scene.preview || (scene.image ? `/api/admin/videos/shots/${scene.image}` : '');

  function save(next: Highlight[]) {
    onChange({ highlights: next, zoomOn: false });
  }

  function update(i: number, patch: Partial<Highlight>) {
    save(list.map((item, n) => (n === i ? { ...item, ...patch } : item)));
  }

  function add(patch: Partial<Highlight>) {
    const time = videoRef.current ? Math.round(videoRef.current.currentTime * 10) / 10 : 1;
    save([...list, { phrase: '', at: time, x: 50, y: 50, w: 14, h: 16, shape: 'circle', zoom: 1.5, hold: 2, ...patch }]);
    setSelected(list.length);
  }

  function remove(i: number) {
    save(list.filter((_, n) => n !== i));
    setSelected(null);
  }

  function select(i: number) {
    setSelected(i);
    const video = videoRef.current;
    const item = list[i];
    if (video && video.paused && item && !(voiceOn && phraseMatch(scene.voice, item.phrase) !== 'missing')) {
      video.currentTime = Math.min(item.at, Math.max(0, (video.duration || item.at) - 0.05));
    }
  }

  function beginDrag(event: ReactPointerEvent, i: number, resizing: boolean) {
    event.preventDefault();
    event.stopPropagation();
    setSelected(i);
    const bounds = frameRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = list[i];
    const rect = origin.shape === 'rect';
    const move = (ev: PointerEvent) => {
      const dx = ((ev.clientX - startX) / bounds.width) * 100;
      const dy = ((ev.clientY - startY) / bounds.height) * 100;
      setDrag(resizing
        ? { i, x: origin.x, y: origin.y, w: Math.min(90, Math.max(3, origin.w + dx)), h: rect ? Math.min(90, Math.max(3, origin.h + dy)) : origin.h }
        : { i, x: Math.min(100, Math.max(0, Math.round((origin.x + dx) * 10) / 10)), y: Math.min(100, Math.max(0, Math.round((origin.y + dy) * 10) / 10)), w: origin.w, h: origin.h });
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      setDrag((current) => {
        if (current) update(current.i, { x: current.x, y: current.y, w: Math.round(current.w * 10) / 10, h: Math.round(current.h * 10) / 10 });
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
    video.addEventListener('loadeddata', reveal, { once: true });
    if (video.readyState >= 2) void reveal();
    return () => video.removeEventListener('loadeddata', reveal);
  }, [src]);

  function readPick() {
    const box = voiceRef.current;
    if (!box) return;
    setPicked(box.value.slice(box.selectionStart, box.selectionEnd).trim().slice(0, 80));
  }

  return (
    <article className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="max-w-xl">
        <div
          ref={frameRef}
          className="relative block aspect-video w-full cursor-crosshair overflow-hidden rounded-lg bg-black"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const x = Math.round(((event.clientX - box.left) / box.width) * 1000) / 10;
            const y = Math.round(((event.clientY - box.top) / box.height) * 1000) / 10;
            const video = videoRef.current;
            const time = video ? { at: Math.round(video.currentTime * 10) / 10 } : {};
            if (selected !== null && list[selected]) update(selected, { x, y, ...time });
            else add({ x, y });
          }}
        >
          {isVideo ? (
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
              onPause={() => setPlaying(false)}
            />
          ) : src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="h-full w-full object-cover" />
          ) : null}
          {list.map((item, i) => {
            const live = drag && drag.i === i ? drag : item;
            const active = selected === i;
            const shape = item.shape === 'none' ? 'rect' : item.shape;
            return (
              <i
                key={i}
                className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-grab border-[#f58220] ${active ? 'border-[3px]' : 'border-2 opacity-60'} ${item.shape === 'none' ? 'border-dashed' : ''} ${shape === 'rect' ? 'rounded-lg' : 'aspect-square rounded-full'}`}
                style={{ left: `${live.x}%`, top: `${live.y}%`, width: `${live.w}%`, height: shape === 'rect' ? `${live.h}%` : undefined }}
                onPointerDown={(event) => beginDrag(event, i, false)}
                onClick={(event) => event.stopPropagation()}
              >
                <span className="absolute -left-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#f58220] text-[11px] font-bold not-italic text-white">{i + 1}</span>
                {active ? (
                  <b className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm bg-[#f58220]" onPointerDown={(event) => beginDrag(event, i, true)} />
                ) : null}
              </i>
            );
          })}
        </div>
        {isVideo ? (
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium"
              onClick={() => {
                const video = videoRef.current;
                if (!video) return;
                if (video.paused) void video.play();
                else video.pause();
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
                if (video) video.currentTime = at;
                setNow(at);
              }}
            />
            <span className="w-14 text-sm font-semibold tabular-nums text-gray-700">{formatTime(now)}</span>
          </div>
        ) : null}
        <p className="mt-2 text-sm text-gray-500">
          {selected !== null && list[selected]
            ? `Click the picture to move highlight ${selected + 1}${isVideo ? ' (it keeps playing)' : ''}. Drag the corner to resize.`
            : 'Click the picture to add a highlight there.'}
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase text-gray-500">On-screen caption</label>
        <textarea className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" rows={2} value={scene.caption} onChange={(e) => onChange({ caption: e.target.value })} />
        <label className="mt-3 block text-xs font-semibold uppercase text-gray-500">Spoken line</label>
        <textarea
          ref={voiceRef}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
          rows={2}
          value={scene.voice}
          onChange={(e) => onChange({ voice: e.target.value })}
          onSelect={readPick}
          onKeyUp={readPick}
          onMouseUp={readPick}
        />
        {picked && voiceOn ? (
          <button
            type="button"
            className="mt-1 rounded-lg bg-[#f58220] px-3 py-1.5 text-sm font-semibold text-white"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              add({ phrase: picked });
              const box = voiceRef.current;
              if (box) box.setSelectionRange(box.selectionEnd, box.selectionEnd);
              setPicked('');
            }}
          >
            Highlight “{picked}” when it is said
          </button>
        ) : (
          <p className="mt-1 text-sm text-gray-500">Select words in the spoken line, such as “New invoice”, to highlight that spot when the voice says them.</p>
        )}

        <div className="mt-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">Highlights</h3>
          <button type="button" className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium" onClick={() => add({})}>
            Add highlight
          </button>
        </div>
        {list.length === 0 ? <p className="mt-1 text-sm text-gray-500">None yet.</p> : null}
        <div className="mt-2 space-y-2">
          {list.map((item, i) => {
            const match = voiceOn ? phraseMatch(scene.voice, item.phrase) : 'missing';
            const usesTime = match === 'missing';
            return (
              <div
                key={i}
                className={`rounded-lg border p-3 ${selected === i ? 'border-[#f58220] bg-orange-50' : 'border-gray-200'}`}
                onClick={() => select(i)}
              >
                <div className="flex flex-wrap items-end gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f58220] text-xs font-bold text-white">{i + 1}</span>
                  <label className="min-w-[12rem] flex-1 text-xs font-semibold uppercase text-gray-500">
                    When the voice says
                    <input className={`${fieldClass} w-full`} value={item.phrase} placeholder="e.g. New invoice" onChange={(e) => update(i, { phrase: e.target.value })} />
                  </label>
                  <label className="text-xs font-semibold uppercase text-gray-500">
                    Mark
                    <select className={fieldClass} value={item.shape} onChange={(e) => update(i, { shape: e.target.value as Highlight['shape'] })}>
                      <option value="circle">Circle</option>
                      <option value="rect">Rectangle</option>
                      <option value="none">Zoom only</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase text-gray-500">
                    Zoom
                    <select className={fieldClass} value={String(item.zoom)} onChange={(e) => update(i, { zoom: Number(e.target.value) })}>
                      <option value="1">None</option>
                      <option value="1.5">1.5×</option>
                      <option value="2">2×</option>
                      <option value="2.5">2.5×</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase text-gray-500">
                    Seconds
                    <input type="number" min={0.5} max={30} step={0.5} className={`${fieldClass} w-20`} value={item.hold} onChange={(e) => update(i, { hold: Number(e.target.value) })} />
                  </label>
                  {usesTime ? (
                    <label className="text-xs font-semibold uppercase text-gray-500">
                      {isVideo ? 'At video time' : 'After the scene starts'}
                      <input
                        className={`${fieldClass} w-24`}
                        defaultValue={formatTime(item.at)}
                        key={`${i}-${item.at}`}
                        onBlur={(e) => update(i, { at: parseClock(e.target.value) })}
                      />
                    </label>
                  ) : null}
                  <button type="button" className="pb-1.5 text-sm font-medium text-red-700" onClick={(event) => { event.stopPropagation(); remove(i); }}>
                    Remove
                  </button>
                </div>
                <p className={`mt-1 text-xs ${match === 'exact' ? 'text-green-700' : 'text-gray-500'}`}>
                  {!voiceOn
                    ? 'The voice is off, so this shows at the time you set.'
                    : match === 'exact'
                      ? 'Shows when the voice says these words.'
                      : match === 'word'
                        ? `Only “${words(item.phrase)[0]}” matches the spoken line, so it shows on that word.`
                        : item.phrase
                          ? 'These words are not in the spoken line, so it shows at the time you set.'
                          : 'No words picked, so it shows at the time you set.'}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <label className="text-xs font-semibold uppercase text-gray-500">
            Transition
            <select
              className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium normal-case text-gray-900"
              value={scene.transition || 'crossfade'}
              onChange={(e) => onChange({ transition: e.target.value as Scene['transition'] })}
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
              onChange={(e) => onChange({ transitionSeconds: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium" onClick={onReplace}>
            Change picture
          </button>
          <button type="button" className="text-sm font-medium text-red-700" onClick={onRemove}>
            Remove scene {index + 1}
          </button>
        </div>
      </div>
    </article>
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
        The voice reads the spoken line under each scene. To point at something, select words in the spoken line, such as “New invoice”, press Highlight, then click that button on the picture. The circle or rectangle, and the zoom if you pick one, appears exactly when those words are said. Videos keep playing the whole time.
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
          <SceneCard
            key={`${scene.image || scene.media || 'scene'}-${index}`}
            scene={scene}
            index={index}
            voiceOn={voice}
            onChange={(patch) => updateScene(index, patch)}
            onReplace={() => replaceMedia(index)}
            onRemove={() => setScenes((current) => current.filter((_, i) => i !== index))}
          />
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
