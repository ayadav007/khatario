import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'tools/video-studio/public');
const port = Number(process.env.VIDEO_STUDIO_PORT || 4317);
const ffmpegBin = process.env.FFMPEG_BIN
  || 'C:\\Users\\Abhishek\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.2-full_build\\bin';
const python = process.env.HYPERFRAMES_PYTHON
  || path.join(process.env.LOCALAPPDATA || '', 'Programs/Python/Python312/python.exe');
const chrome = process.env.HYPERFRAMES_BROWSER_PATH
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const invoiceShots = path.join(root, 'brag-output/invoice-how-to/shots');

export const preset = {
  title: 'How to create an invoice',
  subtitle: 'New tax invoice on staging',
  intro: "Here's how to create a tax invoice in Khatario.",
  voice: true,
  scenes: [
    { image: '01-new-invoice.png', caption: 'Open New Tax Invoice. Recent customers are listed.', voice: 'Open New Tax Invoice. Your recent customers are already listed.', transition: 'crossfade', transitionSeconds: 1 },
    { image: '02-customer-search.png', caption: 'Search the customer by name or phone.', voice: 'Search by name or phone, then pick the customer.', transition: 'slide', transitionSeconds: 1 },
    { image: '03-customer-selected.png', caption: 'They sit on Bill to. Ship to follows.', voice: 'They land on Bill to, and the ship-to address follows.', transition: 'cut', transitionSeconds: 1 },
    { image: '04-item-picker.png', caption: 'Add items. Pick from the catalog.', voice: 'Add items from the catalog. Each row shows stock, price, and GST.', transition: 'crossfade', transitionSeconds: 1 },
    { image: '06-line-on-bill.png', caption: 'HSN, GST, and the line amount fill in.', voice: 'The line picks up the HSN, the GST rate, and the amount.', transition: 'slide', transitionSeconds: 1 },
    { image: '07-totals-and-save.png', caption: 'Save draft, or save the invoice.', voice: 'Save a draft if you are not finished, or save the invoice.', transition: 'crossfade', transitionSeconds: 1 },
  ],
};

function send(res, status, body, type = 'application/json') {
  const payload = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function run(command, args, cwd, env, onLine) {
  const npxCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js');
  const bin = command === 'npx' ? process.execPath : command;
  const argv = command === 'npx' ? [npxCli, ...args] : args;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, argv, { cwd, env, shell: false, windowsHide: true });
    let text = '';
    const take = (buf) => {
      text += buf.toString();
      for (const line of buf.toString().split(/\r?\n/)) {
        if (line.trim()) onLine(line);
      }
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(text) : reject(new Error(text.slice(-1200) || `exit ${code}`))));
  });
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const bin = path.join(ffmpegBin, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const child = spawn(bin, args, { windowsHide: true });
    let text = '';
    child.stderr.on('data', (d) => { text += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(text) : reject(new Error(text.slice(-500) || `ffmpeg exit ${code}`))));
  });
}

async function boostVoice(file) {
  const report = await ffmpeg(['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const match = report.match(/max_volume:\s*(-?[\d.]+)\s*dB/);
  if (!match) return;
  const gain = Math.min(18, -1 - Number(match[1]));
  if (gain < 1) return;
  const louder = file.replace(/\.wav$/i, '.loud.wav');
  await ffmpeg(['-y', '-i', file, '-af', `volume=${gain.toFixed(1)}dB`, louder]);
  fs.renameSync(louder, file);
}

function ffprobe(file) {
  return new Promise((resolve, reject) => {
    const bin = path.join(ffmpegBin, 'ffprobe.exe');
    const child = spawn(bin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Number(out.trim())) : reject(new Error(out))));
  });
}

function compositionHtml({ title, subtitle, scenes }) {
  const clips = [];
  const tweens = [
    'tl.fromTo("#title-inner", { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, 0.2);',
  ];
  const titleDur = scenes.titleDuration;
  clips.push(`
      <section id="title" class="clip" data-start="0" data-duration="${titleDur.toFixed(2)}" data-track-index="0">
        <div class="title-stage" id="title-inner">
          <p class="eyebrow">Khatario</p>
          <h1>${escapeHtml(title)}</h1>
          <p class="sub">${escapeHtml(subtitle || '')}</p>
        </div>
      </section>`);
  scenes.items.forEach((scene, index) => {
    const id = `s${index + 1}`;
    const start = scene.start.toFixed(2);
    const duration = scene.duration.toFixed(2);
    const frameId = `f${index + 1}`;
    const mark = scene.zoom > 1 && scene.shape
      ? `<div id="m${index + 1}" class="mark ${scene.shape}" style="left:${scene.zoomX}%;top:${scene.zoomY}%;width:${scene.markW}%;${scene.shape === 'rect' ? `height:${scene.markH}%;` : ''}"></div>`
      : '';
    const caption = scene.caption
      ? (scene.media === 'video'
        ? `<p class="cap clip" data-start="${start}" data-duration="${duration}" data-track-index="${40 + index}">${escapeHtml(scene.caption)}</p>`
        : `<p class="cap">${escapeHtml(scene.caption)}</p>`)
      : '';
    const picture = scene.media === 'video'
      ? `<div class="frame" id="${frameId}"><video id="v${index + 1}" class="clip" src="assets/shots/${scene.file}" muted playsinline data-start="${start}" data-duration="${duration}" data-track-index="${index + 1}"></video></div>`
      : `<div class="frame" id="${frameId}"><img src="assets/shots/${scene.file}" alt="" /></div>`;
    const shot = `<div class="shot" id="${id}">${picture}${caption}${mark}</div>`;
    if (scene.media === 'video') {
      clips.push(shot);
    } else {
      clips.push(`
      <section id="scene-${index + 1}" class="clip" data-start="${start}" data-duration="${duration}" data-track-index="${index + 1}">
        ${shot}
      </section>`);
    }
    const at = scene.start.toFixed(2);
    if (scene.transition === 'crossfade' && scene.transitionSeconds > 0) {
      tweens.push(`tl.fromTo("#${id}", { opacity: 0 }, { opacity: 1, duration: ${scene.transitionSeconds}, ease: "power1.inOut" }, ${at});`);
      const previous = index === 0 ? '#title-inner' : `#s${index}`;
      tweens.push(`tl.to("${previous}", { opacity: 0, duration: ${scene.transitionSeconds}, ease: "power1.inOut" }, ${at});`);
    } else if (scene.transition === 'slide' && scene.transitionSeconds > 0) {
      tweens.push(`tl.fromTo("#${id}", { x: 1920 }, { x: 0, duration: ${scene.transitionSeconds}, ease: "power2.inOut" }, ${at});`);
    }
    if (scene.zoom > 1) {
      const zoomAt = (scene.start + scene.zoomAt).toFixed(2);
      const zoomBack = (scene.start + scene.zoomAt + 1 + scene.zoomHold).toFixed(2);
      tweens.push(`tl.set("#${frameId}", { transformOrigin: "${scene.zoomX}% ${scene.zoomY}%" }, 0);`);
      tweens.push(`tl.fromTo("#${frameId}", { scale: 1 }, { scale: ${scene.zoom}, duration: 1, ease: "power2.inOut" }, ${zoomAt});`);
      tweens.push(`tl.to("#${frameId}", { scale: 1, duration: 0.5, ease: "power2.inOut" }, ${zoomBack});`);
      if (scene.shape) {
        tweens.push(`tl.fromTo("#m${index + 1}", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" }, ${zoomAt});`);
        tweens.push(`tl.to("#m${index + 1}", { opacity: 0, duration: 0.3, ease: "power1.in" }, ${zoomBack});`);
      }
    }
  });
  const last = scenes.items[scenes.items.length - 1];
  const total = last ? last.start + last.duration : titleDur;
  const bed = scenes.voices.length ? 0.35 : 0.7;
  const voices = scenes.voices.map((voice) => `
      <audio id="${voice.id}" src="assets/voice/${voice.file}" data-start="${voice.start}" data-track-index="${voice.track}" data-volume="1"></audio>`).join('');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(title)}</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      body { margin: 0; background: #f8f3e9; color: #063f35; font-family: system-ui, sans-serif; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: #063f35; }
      .clip { position: absolute; inset: 0; overflow: hidden; }
      .shot { position: absolute; inset: 0; overflow: hidden; }
      .frame { position: absolute; inset: 0; }
      .shot img, .shot video { width: 100%; height: 100%; object-fit: cover; display: block; background: #000; }
      .mark { position: absolute; transform: translate(-50%, -50%); border: 8px solid #f58220; box-shadow: 0 0 0 4px rgba(6, 63, 53, 0.35); opacity: 0; }
      .mark.circle { height: auto; aspect-ratio: 1; border-radius: 999px; }
      .mark.rect { border-radius: 18px; }
      .cap { position: absolute; left: 40px; top: 28px; max-width: 1400px; margin: 0; padding: 18px 28px; border-radius: 16px; background: #063f35; color: #f8f3e9; font-size: 36px; font-weight: 700; line-height: 1.2; }
      .cap.clip { inset: auto; width: auto; height: auto; overflow: visible; }
      .title-stage { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; padding: 0 120px; background: #f8f3e9; }
      .eyebrow { margin: 0 0 20px; color: #d7721c; font-size: 28px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; }
      h1 { margin: 0; max-width: 1500px; color: #063f35; font-size: 84px; line-height: 1.05; letter-spacing: -0.03em; }
      .sub { margin: 28px 0 0; color: #3d5c56; font-size: 36px; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="${total.toFixed(2)}">
      ${clips.join('')}
      <audio id="music" src="assets/music/bed.mp3" data-start="0" data-duration="${total.toFixed(2)}" data-track-index="20" data-volume="1"
        data-automation='{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":0},{"t":0.6,"v":${bed}},{"t":${Math.max(0, total - 1.5).toFixed(2)},"v":${bed}},{"t":${total.toFixed(2)},"v":0}]}]}'></audio>
      ${voices}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      ${tweens.join('\n      ')}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>`;
}

function writeDataFile(dest, dataUrl) {
  const b64 = String(dataUrl).split(',')[1] || '';
  const bytes = Buffer.from(b64, 'base64');
  if (!bytes.length) throw new Error('That file was empty.');
  if (bytes.length > 80 * 1024 * 1024) throw new Error('That file is over 80 MB. Use a shorter clip.');
  fs.writeFileSync(dest, bytes);
}

function clockSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  const parts = String(value || '').trim().split(':').map((part) => Number(part));
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function shotFile(name) {
  if (!/^[\w.-]+\.png$/.test(String(name || ''))) return null;
  const file = path.join(invoiceShots, name);
  return fs.existsSync(file) ? file : null;
}

export function videoFile(stamp) {
  if (!/^[\dT-]+$/.test(String(stamp || ''))) return null;
  const file = path.join(root, 'brag-output/studio', stamp, 'video.mp4');
  return fs.existsSync(file) ? file : null;
}

export function listVideos() {
  const dir = path.join(root, 'brag-output/studio');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((stamp) => /^[\dT-]+$/.test(stamp) && fs.existsSync(path.join(dir, stamp, 'video.mp4')))
    .map((stamp) => {
      const stat = fs.statSync(path.join(dir, stamp, 'video.mp4'));
      return { stamp, bytes: stat.size, created: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.created.localeCompare(a.created));
}

export function deleteVideo(stamp) {
  if (!/^[\dT-]+$/.test(String(stamp || ''))) return false;
  const studioDir = path.resolve(root, 'brag-output/studio');
  const dir = path.resolve(studioDir, stamp);
  if (dir !== path.join(studioDir, stamp)) return false;
  if (!fs.existsSync(path.join(dir, 'video.mp4'))) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export async function renderJob(body, log) {
  const title = String(body.title || 'Khatario').slice(0, 80);
  const subtitle = String(body.subtitle || '').slice(0, 120);
  const voiceOn = body.voice !== false;
  const intro = String(body.intro || `Here is ${title}.`).slice(0, 240);
  const scenes = Array.isArray(body.scenes) ? body.scenes.slice(0, 12) : [];
  if (!scenes.length) throw new Error('Add at least one scene.');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const job = path.join(root, 'brag-output/studio', stamp);
  const composition = path.join(job, 'composition');
  fs.mkdirSync(path.join(composition, 'assets/shots'), { recursive: true });
  fs.mkdirSync(path.join(composition, 'assets/voice'), { recursive: true });
  fs.mkdirSync(path.join(composition, 'assets/music'), { recursive: true });
  const musicSrc = path.join(root, 'tools/video-studio/assets/bed.mp3');
  fs.copyFileSync(musicSrc, path.join(composition, 'assets/music/bed.mp3'));

  const items = [];
  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i];
    const videoData = String(scene.videoData || '');
    const imageData = String(scene.imageData || '');
    const isVideo = videoData.startsWith('data:video/mp4');
    const isJpeg = imageData.startsWith('data:image/jpeg');
    const file = `scene-${String(i + 1).padStart(2, '0')}.${isVideo ? 'mp4' : isJpeg ? 'jpg' : 'png'}`;
    const dest = path.join(composition, 'assets/shots', file);
    if (isVideo) {
      writeDataFile(dest, videoData);
    } else if (imageData.startsWith('data:image/')) {
      writeDataFile(dest, imageData);
    } else if (scene.image && /^[\w.-]+\.png$/.test(scene.image)) {
      const src = path.join(invoiceShots, scene.image);
      if (!fs.existsSync(src)) throw new Error(`Missing screenshot ${scene.image}`);
      fs.copyFileSync(src, dest);
    } else {
      throw new Error(`Scene ${i + 1} needs a screenshot or an MP4.`);
    }
    const kind = ['cut', 'crossfade', 'slide'].includes(scene.transition) ? scene.transition : 'crossfade';
    const seconds = Math.min(3, Math.max(0.2, Number(scene.transitionSeconds) || 1));
    const mediaDuration = isVideo ? await ffprobe(dest) : 0;
    const zoomOn = scene.zoomOn === true;
    const shape = scene.shape === 'rect' ? 'rect' : scene.shape === 'none' ? '' : 'circle';
    let zoomAt = zoomOn ? clockSeconds(scene.zoomAt) : 0;
    if (zoomOn && mediaDuration > 0) zoomAt = Math.min(zoomAt, Math.max(0, mediaDuration - 0.2));
    items.push({
      file,
      media: isVideo ? 'video' : 'image',
      mediaDuration,
      caption: String(scene.caption || '').slice(0, 140),
      voice: String(scene.voice || scene.caption || '').slice(0, 240),
      transition: kind,
      transitionSeconds: kind === 'cut' ? 0 : seconds,
      zoom: zoomOn ? Math.min(3, Math.max(1.2, Number(scene.zoomScale) || 2)) : 1,
      zoomAt,
      zoomHold: zoomOn ? Math.min(180, Math.max(0.4, Number(scene.zoomHold) || 30)) : 0,
      zoomX: Math.min(100, Math.max(0, Number(scene.zoomX ?? 50))),
      zoomY: Math.min(100, Math.max(0, Number(scene.zoomY ?? 50))),
      markW: Math.min(90, Math.max(4, Number(scene.markW) || (shape === 'rect' ? 28 : 18))),
      markH: Math.min(90, Math.max(4, Number(scene.markH) || 24)),
      shape: zoomOn ? shape : '',
      duration: 6,
      start: 0,
    });
  }

  const env = {
    ...process.env,
    PATH: `${ffmpegBin};${process.env.PATH || ''}`,
    HYPERFRAMES_PYTHON: python,
    HYPERFRAMES_BROWSER_PATH: chrome,
  };
  const voices = [];

  async function speak(text, file) {
    log(`Voice: ${text.slice(0, 80)}`);
    await run('npx', ['--yes', 'hyperframes', 'tts', text, '--voice', 'af_nova', '--output', `assets/voice/${file}`], composition, env, (line) => {
      if (/Generated|failed|Error/i.test(line)) log(line.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 180));
    });
    const voiceFile = path.join(composition, 'assets/voice', file);
    await boostVoice(voiceFile);
    return ffprobe(voiceFile);
  }

  const firstEnter = items[0] ? items[0].transitionSeconds : 0;
  let titleDuration = 5;
  if (voiceOn) {
    const dur = await speak(intro, '00.wav');
    titleDuration = Math.max(5, 0.4 + dur + 0.8 + firstEnter);
    voices.push({ id: 'vo-00', file: '00.wav', start: 0.4, track: 30 });
  } else {
    titleDuration = Math.max(5, 4 + firstEnter);
  }
  let handoff = titleDuration;
  for (let i = 0; i < items.length; i += 1) {
    const enter = items[i].transitionSeconds;
    const nextEnter = items[i + 1] ? items[i + 1].transitionSeconds : 0;
    let spoken = 0;
    if (voiceOn) {
      spoken = await speak(items[i].voice, `${String(i + 1).padStart(2, '0')}.wav`);
      voices.push({
        id: `vo-${i + 1}`,
        file: `${String(i + 1).padStart(2, '0')}.wav`,
        start: Number(handoff.toFixed(2)),
        track: 31 + i,
      });
    }
    const spokenHold = voiceOn ? spoken + 1.2 : 5;
    const zoomNeed = items[i].zoom > 1 ? items[i].zoomAt + 1 + items[i].zoomHold + 0.5 : 0;
    const settled = Math.max(spokenHold, items[i].mediaDuration || 0, zoomNeed) + nextEnter;
    items[i].start = handoff - enter;
    items[i].duration = enter + settled + (i === items.length - 1 ? 0.4 : 0);
    handoff += settled;
  }

  fs.writeFileSync(path.join(composition, 'index.html'), compositionHtml({
    title,
    subtitle,
    scenes: { titleDuration, items, voices },
  }));
  log('Rendering the video');
  await run('npx', ['--yes', 'hyperframes', 'render', '--quality', 'high', '--output', '../video.mp4', '--workers', '2'], composition, env, (line) => {
    if (/Render complete|%|error|Error|Chrome cannot/i.test(line)) log(line.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 180));
  });
  return { job: stamp, video: `/videos/${stamp}/video.mp4` };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, fs.readFileSync(path.join(publicDir, 'index.html')), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/preset') {
      return send(res, 200, preset);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/shots/')) {
      const name = path.basename(url.pathname);
      const file = path.join(invoiceShots, name);
      if (!file.startsWith(invoiceShots) || !fs.existsSync(file)) return send(res, 404, { error: 'Not found' });
      return send(res, 200, fs.readFileSync(file), 'image/png');
    }
    if (req.method === 'GET' && url.pathname.startsWith('/videos/')) {
      const parts = url.pathname.split('/').filter(Boolean);
      const stamp = parts[1] || '';
      if (!/^[\dT-]+$/.test(stamp)) return send(res, 400, { error: 'Bad video id' });
      const file = path.join(root, 'brag-output/studio', stamp, 'video.mp4');
      if (!fs.existsSync(file)) return send(res, 404, { error: 'Not ready' });
      const headers = { 'Content-Type': 'video/mp4' };
      if (url.searchParams.get('download') === '1') headers['Content-Disposition'] = `attachment; filename="khatario-${stamp}.mp4"`;
      res.writeHead(200, headers);
      fs.createReadStream(file).pipe(res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/videos') {
      return send(res, 200, { videos: listVideos() });
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/videos/')) {
      const stamp = path.basename(url.pathname);
      if (!deleteVideo(stamp)) return send(res, 404, { error: 'Not found' });
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/render') {
      const body = await readBody(req);
      const logs = [];
      const result = await renderJob(body, (line) => logs.push(line));
      return send(res, 200, { ...result, logs });
    }
    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    return send(res, 500, { error: error instanceof Error ? error.message : 'Render failed' });
  }
});

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  server.listen(port, '127.0.0.1', () => {
    console.log(`Video studio http://127.0.0.1:${port}`);
  });
}
