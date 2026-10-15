#!/usr/bin/env node
/**
 * Downloads the Khatario Staff face models (YuNet MIT, SFace Apache-2.0) into models/face
 * (or FACE_MODEL_DIR) and checks their sha256. Skips files that are already correct.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(root, 'models/face/manifest.json'), 'utf8'));
const dir = process.env.FACE_MODEL_DIR || path.join(root, 'models/face');
mkdirSync(dir, { recursive: true });

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

let failed = false;
for (const [name, m] of Object.entries(manifest)) {
  const target = path.join(dir, m.file);
  if (existsSync(target) && sha256(readFileSync(target)) === m.sha256) {
    console.log(`ok   ${name}: ${m.file}`);
    continue;
  }
  console.log(`get  ${name}: ${m.url}`);
  const res = await fetch(m.url);
  if (!res.ok) {
    console.error(`fail ${name}: HTTP ${res.status}`);
    failed = true;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== m.sha256) {
    console.error(`fail ${name}: sha256 does not match manifest.json`);
    failed = true;
    continue;
  }
  writeFileSync(`${target}.part`, buf);
  renameSync(`${target}.part`, target);
  console.log(`ok   ${name}: ${m.file} (${m.license})`);
}
process.exit(failed ? 1 : 0);
