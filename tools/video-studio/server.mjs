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
    { image: '01-new-invoice.png', caption: 'Open New Tax Invoice. Recent customers are listed.', voice: 'Open New Tax Invoice. Your recent customers are already listed.' },
    { image: '02-customer-search.png', caption: 'Search the customer by name or phone.', voice: 'Search by name or phone, then pick the customer.' },
    { image: '03-customer-selected.png', caption: 'They sit on Bill to. Ship to follows.', voice: 'They land on Bill to, and the ship-to address follows.' },
    { image: '04-item-picker.png', caption: 'Add items. Pick from the catalog.', voice: 'Add items from the catalog. Each row shows stock, price, and GST.' },
    { image: '06-line-on-bill.png', caption: 'HSN, GST, and the line amount fill in.', voice: 'The line picks up the HSN, the GST rate, and the amount.' },
    { image: '07-totals-and-save.png', caption: 'Save draft, or save the invoice.', voice: 'Save a draft if you are not finished, or save the invoice.' },
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
  const bin = command === 'npx' && process.platform === 'win32' ? 'npx.cmd' : command;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, shell: false, windowsHide: true });
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
  let t = 0;
  const titleDur = scenes.titleDuration;
  clips.push(`
      <section id="title" class="clip" data-start="0" data-duration="${titleDur}" data-track-index="0">
        <div class="title-stage" id="title-inner">
          <p class="eyebrow">Khatario</p>
          <h1>${escapeHtml(title)}</h1>
          <p class="sub">${escapeHtml(subtitle || '')}</p>
        </div>
      </section>`);
  t = titleDur;
  scenes.items.forEach((scene, index) => {
    clips.push(`
      <section id="scene-${index + 1}" class="clip" data-start="${t.toFixed(2)}" data-duration="${scene.duration}" data-track-index="${index + 1}">
        <div class="shot" id="s${index + 1}">
          <img src="assets/shots/${scene.file}" alt="" />
          <p class="cap">${escapeHtml(scene.caption)}</p>
        </div>
      </section>`);
    t += scene.duration;
  });
  const total = t;
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
      .clip { position: absolute; inset: 0; }
      .shot { position: absolute; inset: 0; }
      .shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .cap { position: absolute; left: 40px; top: 28px; max-width: 1400px; margin: 0; padding: 18px 28px; border-radius: 16px; background: #063f35; color: #f8f3e9; font-size: 36px; font-weight: 700; line-height: 1.2; }
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
        data-automation='{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":0},{"t":0.6,"v":0.07},{"t":${Math.max(0, total - 1.5).toFixed(2)},"v":0.07},{"t":${total.toFixed(2)},"v":0}]}]}'></audio>
      ${voices}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#title-inner", { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, 0.2);
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>`;
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
    const file = `scene-${String(i + 1).padStart(2, '0')}.png`;
    const dest = path.join(composition, 'assets/shots', file);
    if (scene.imageData && String(scene.imageData).startsWith('data:image/')) {
      const b64 = String(scene.imageData).split(',')[1] || '';
      fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
    } else if (scene.image && /^[\w.-]+\.png$/.test(scene.image)) {
      const src = path.join(invoiceShots, scene.image);
      if (!fs.existsSync(src)) throw new Error(`Missing screenshot ${scene.image}`);
      fs.copyFileSync(src, dest);
    } else {
      throw new Error(`Scene ${i + 1} needs a screenshot.`);
    }
    items.push({
      file,
      caption: String(scene.caption || '').slice(0, 140),
      voice: String(scene.voice || scene.caption || '').slice(0, 240),
      duration: 6,
    });
  }

  const env = {
    ...process.env,
    PATH: `${ffmpegBin};${process.env.PATH || ''}`,
    HYPERFRAMES_PYTHON: python,
    HYPERFRAMES_BROWSER_PATH: chrome,
  };
  const voices = [];
  let cursor = 0;

  async function speak(text, file) {
    log(`Voice: ${text.slice(0, 80)}`);
    await run('npx', ['--yes', 'hyperframes', 'tts', text, '--voice', 'af_nova', '--output', `assets/voice/${file}`], composition, env, (line) => {
      if (/Generated|failed|Error/i.test(line)) log(line.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 180));
    });
    return ffprobe(path.join(composition, 'assets/voice', file));
  }

  let titleDuration = 5;
  if (voiceOn) {
    const dur = await speak(intro, '00.wav');
    titleDuration = Math.max(5, dur + 1.2);
    voices.push({ id: 'vo-00', file: '00.wav', start: 0.4, track: 30 });
  }
  cursor = titleDuration;
  if (voiceOn) {
    for (let i = 0; i < items.length; i += 1) {
      const dur = await speak(items[i].voice, `${String(i + 1).padStart(2, '0')}.wav`);
      items[i].duration = Math.max(6, dur + 1.4);
      voices.push({
        id: `vo-${i + 1}`,
        file: `${String(i + 1).padStart(2, '0')}.wav`,
        start: Number((cursor + 0.3).toFixed(2)),
        track: 31 + i,
      });
      cursor += items[i].duration;
    }
  } else {
    cursor += items.reduce((sum, item) => sum + item.duration, 0);
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
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      fs.createReadStream(file).pipe(res);
      return;
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
