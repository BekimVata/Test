// Video finishing and checks (added 4 Nov, after the telescope clip's proportions drifted).
// Needs ffmpeg on the server: apt-get install -y ffmpeg. Without it, the office makes no videos.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('./config');
const mock = require('./mock');

const run = (cmd, args, timeout = 180000) => new Promise((resolve, reject) =>
  execFile(cmd, args, { timeout, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => err ? reject(new Error(`${cmd} failed: ${(stderr || err.message).slice(-300)}`)) : resolve(stdout)));
const F = name => path.join(config.DATA, 'files', name);

let hasFfmpeg = null;
async function available() {
  if (mock.on) return true;
  if (hasFfmpeg === null) { try { await run('ffmpeg', ['-version'], 10000); hasFfmpeg = true; } catch (e) { hasFfmpeg = false; } }
  return hasFfmpeg;
}

async function probe(name) {
  if (mock.on) return { width: 1080, height: 1920, duration: 8 };
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', F(name)], 30000);
  const j = JSON.parse(out);
  return { width: j.streams?.[0]?.width || 0, height: j.streams?.[0]?.height || 0, duration: Number(j.format?.duration) || 0 };
}

// Exactly 1080x1920 (9:16), H.264 high quality, starts playing instantly, no audio (sounds are added in the app).
async function finish(src, out) {
  if (mock.on) { fs.copyFileSync(F(src), F(out)); return out; }
  await run('ffmpeg', ['-y', '-i', F(src), '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', '-an', F(out)]);
  return out;
}

// Stills spread through the clip, for the eagle to compare frame by frame.
async function frames(name, n = 6) {
  if (mock.on) return [];
  const { duration } = await probe(name);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = Math.max(0, Math.min(duration - 0.05, (duration * (i + 0.5)) / n));
    const f = name.replace(/\.mp4$/, `-f${i + 1}.jpg`);
    await run('ffmpeg', ['-y', '-ss', t.toFixed(2), '-i', F(name), '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '3', F(f)], 60000);
    out.push(f);
  }
  return out;
}

module.exports = { available, probe, finish, frames };
