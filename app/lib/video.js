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
  if (!hasFfmpeg) { try { await run('ffmpeg', ['-version'], 10000); hasFfmpeg = true; } catch (e) { hasFfmpeg = false; } } // re-check until found (installed 4 Nov)
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
async function frames(name, n = 6, upTo) {
  if (mock.on) return [];
  let { duration } = await probe(name);
  if (upTo && upTo < duration) duration = upTo; // only the part of the clip that is actually used
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = Math.max(0, Math.min(duration - 0.05, (duration * (i + 0.5)) / n));
    const f = name.replace(/\.mp4$/, `-f${i + 1}.jpg`);
    await run('ffmpeg', ['-y', '-i', F(name), '-ss', t.toFixed(2), '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '3', F(f)], 60000);
    out.push(f);
  }
  return out;
}

// ---------- Editing (storyboard videos) ----------
// Every segment is 1080x1920, 30 fps, H.264, silent, so they join cleanly. Text sits between 18% and 82% of the
// height, clear of TikTok and Reels buttons. Fonts come with the server's ffmpeg install (DejaVu).
const FONT = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find(f => fs.existsSync(f)) || '';
const NAVY = '0x14213D';
const ENC = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '30', '-an'];
let textN = 0;
function textFilter(text, { y = 'h*0.18', size = 58, from = 0, until = null, font = FONT } = {}) {
  if (!text) return '';
  const tf = F(`txt-${Date.now()}-${++textN}.txt`);
  fs.writeFileSync(tf, text);
  const enable = until != null ? `:enable='between(t,${from},${until})'` : '';
  return `,drawtext=fontfile=${font}:textfile=${tf}:fontcolor=white:fontsize=${size}:x=(w-text_w)/2:y=${y}:shadowcolor=black@0.6:shadowx=2:shadowy=2${enable}`;
}

// A real product photo on midnight navy with a slow push-in.
async function photoSegment(img, secs, text, out) {
  if (mock.on) { fs.writeFileSync(F(out), 'mock'); return out; }
  const frames = Math.round(secs * 30);
  await run('ffmpeg', ['-y', '-loop', '1', '-i', F(img), '-vf',
    `scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,zoompan=z='min(1+0.0016*on,1.14)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1080:fps=30,pad=1080:1920:0:420:color=${NAVY},setsar=1` + textFilter(text, { y: 'h*0.12' }),
    '-frames:v', String(frames), ...ENC, F(out)]);
  return out;
}

// An eagle-approved AI clip, trimmed, with optional text for part of it.
async function clipSegment(clip, secs, text, out, { textUntil = null } = {}) {
  if (mock.on) { fs.writeFileSync(F(out), 'mock'); return out; }
  await run('ffmpeg', ['-y', '-i', F(clip), '-t', String(secs), '-vf',
    'scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1' + textFilter(text, { y: 'h*0.18', until: textUntil }),
    ...ENC, F(out)]);
  return out;
}

// End card: the logo (if the shop kit has one) and up to three lines of text on midnight navy.
async function endCard(lines, secs, out, logo) {
  if (mock.on) { fs.writeFileSync(F(out), 'mock'); return out; }
  const [a, b, c] = lines;
  const txt = textFilter(a, { y: 'h*0.56', size: 56 }) + textFilter(b, { y: 'h*0.62', size: 44 }) + textFilter(c, { y: 'h*0.67', size: 40 });
  const args = ['-y', '-f', 'lavfi', '-i', `color=c=${NAVY}:s=1080x1920:r=30:d=${secs}`];
  if (logo) {
    args.push('-loop', '1', '-i', F(logo), '-filter_complex',
      `[1:v]scale=520:520,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(pow(X-W/2,2)+pow(Y-H/2,2),pow(W/2-2,2)),255,0)'[l];[0:v][l]overlay=(W-w)/2:H*0.30:shortest=1,fade=t=in:st=0:d=0.4,setsar=1${txt}`);
  } else {
    args.push('-vf', `drawtext=fontfile=${FONT}:text='BANIANS':fontcolor=white:fontsize=120:x=(w-text_w)/2:y=h*0.40,fade=t=in:st=0:d=0.4,setsar=1${txt}`);
  }
  args.push('-t', String(secs), ...ENC, F(out));
  await run('ffmpeg', args);
  return out;
}

async function concat(segments, out) {
  if (mock.on) { fs.writeFileSync(F(out), 'mock video'); return out; }
  const list = F(out.replace(/\.mp4$/, '-list.txt'));
  fs.writeFileSync(list, segments.map(s => `file '${F(s)}'`).join('\n'));
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', '-an', F(out)]);
  return out;
}

module.exports = { available, probe, finish, frames, photoSegment, clipSegment, endCard, concat };
