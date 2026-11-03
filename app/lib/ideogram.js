// Ideogram 4.5: makes the artwork. Product designs use a transparent background so they print cleanly.
const fs = require('fs');
const path = require('path');
const { request, ApiError } = require('./http');
const config = require('./config');
const store = require('./store');
const mock = require('./mock');

const URL = 'https://api.ideogram.ai/v2/image/generate/ideogram-4-5';

async function generate({ prompt, size = '2048x2048', background = 'transparent', seed, fileName, agent = 'Arben' }) {
  const cfg = config.load();
  let buf, meta;
  if (mock.on) {
    ({ buf, meta } = await mock.image(prompt));
  } else {
    if (!cfg.ideogramKey) throw new Error('Ideogram key is missing. Add it on the Settings page.');
    const send = async (sz) => {
      const fd = new FormData();
      fd.append('prompt', prompt);
      fd.append('size', sz);
      fd.append('background', background);
      fd.append('quality', 'high');
      fd.append('num_images', '1');
      fd.append('magic_prompt', 'off');
      fd.append('enable_copyright_detection', 'true');
      if (seed) fd.append('seed', String(seed));
      return request('Ideogram', URL, { method: 'POST', headers: { 'Api-Key': cfg.ideogramKey }, body: fd }, { retries: 2, timeoutMs: 180000 });
    };
    let res;
    try { res = await send(size); }
    catch (e) {
      if (e instanceof ApiError && e.status === 400 && size !== 'auto') res = await send('auto');
      else throw e;
    }
    store.spend(cfg.ideogramCostUSD * cfg.usdToGbp, 'Ideogram image', agent);
    const img = (res.data || [])[0];
    if (!img || !img.is_image_safe || !img.url) throw new Error('Ideogram flagged the image (safety or copyright check). Trying a different prompt helps.');
    buf = await request('Ideogram download', img.url, {}, { raw: true });
    meta = { url: img.url, seed: img.seed, resolution: img.resolution };
  }
  const name = fileName || `img-${Date.now()}.png`;
  fs.writeFileSync(path.join(config.DATA, 'files', name), buf);
  return { file: name, ...meta };
}

// Free price check: dry_run validates and quotes without generating or billing.
async function test() {
  const cfg = config.load();
  if (mock.on) return 'Connected (mock)';
  const fd = new FormData();
  fd.append('prompt', 'a small gold star');
  fd.append('background', 'transparent');
  const res = await request('Ideogram', URL + '?dry_run=true', { method: 'POST', headers: { 'Api-Key': cfg.ideogramKey }, body: fd }, { retries: 1 });
  const quote = JSON.stringify(res).slice(0, 160);
  return 'Connected · price quote ' + quote;
}

const sniff = b => b[0] === 0xFF && b[1] === 0xD8 ? 'image/jpeg' : b.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : 'image/png';

// Edits / composes with source images (marketing): images[0] is the photo being edited, the rest are references.
// Used for lifestyle photos and Pinterest adverts built around the real product mockup.
async function edit({ images, prompt, size = 'auto', quality = 'medium', fileName, agent = 'Lule', costUSD = 0.06 }) {
  const cfg = config.load();
  let buf, meta;
  if (mock.on) {
    ({ buf, meta } = await mock.image(prompt));
  } else {
    if (!cfg.ideogramKey) throw new Error('Ideogram key is missing. Add it on the Settings page.');
    const fd = new FormData();
    fd.append('prompt', prompt);
    fd.append('size', size);
    fd.append('background', 'opaque');
    fd.append('quality', quality);
    fd.append('num_images', '1');
    fd.append('enable_copyright_detection', 'true');
    for (const f of images) {
      const b = fs.readFileSync(path.join(config.DATA, 'files', f));
      fd.append('images', new Blob([b], { type: sniff(b) }), f);
    }
    const res = await request('Ideogram', URL, { method: 'POST', headers: { 'Api-Key': cfg.ideogramKey }, body: fd }, { retries: 2, timeoutMs: 240000 });
    store.spend(costUSD * cfg.usdToGbp, 'Ideogram advert image', agent);
    const img = (res.data || [])[0];
    if (!img || !img.is_image_safe || !img.url) throw new Error('Ideogram flagged the advert image (safety or copyright check).');
    buf = await request('Ideogram download', img.url, {}, { raw: true });
    meta = { url: img.url, seed: img.seed, resolution: img.resolution };
  }
  const name = fileName || `ad-${Date.now()}.png`;
  fs.writeFileSync(path.join(config.DATA, 'files', name), buf);
  return { file: name, ...meta };
}

// 5-second silent video from a first-frame image (Kling 3.0 Standard via Ideogram, about 42 credits).
// Silent on purpose: music is added in the TikTok / Instagram app, where trending sounds are licensed.
const VIDEO_URL = 'https://api.ideogram.ai/v2/video/generate/kling-3-standard-image-to-video';
async function video({ image, prompt, duration = 5, fileName, agent = 'Era', costUSD = 0.42 }) {
  const cfg = config.load();
  const name = fileName || `video-${Date.now()}.mp4`;
  if (mock.on) {
    fs.writeFileSync(path.join(config.DATA, 'files', name), Buffer.from('mock video'));
    return { file: name };
  }
  if (!cfg.ideogramKey) throw new Error('Ideogram key is missing. Add it on the Settings page.');
  const fd = new FormData();
  const b = fs.readFileSync(path.join(config.DATA, 'files', image));
  fd.append('image', new Blob([b], { type: sniff(b) }), image);
  fd.append('prompt', prompt);
  fd.append('negative_prompt', 'distorted text, changing the printed design, warped hands, extra limbs, logos, watermark');
  fd.append('duration', String(duration));
  fd.append('generate_audio', 'false');
  const acc = await request('Ideogram video', VIDEO_URL, { method: 'POST', headers: { 'Api-Key': cfg.ideogramKey }, body: fd }, { retries: 1, timeoutMs: 120000 });
  if (!acc.generation_id) throw new Error('Ideogram did not start the video: ' + JSON.stringify(acc).slice(0, 200));
  const until = Date.now() + 15 * 60 * 1000;
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, 10000));
    const g = await request('Ideogram video', `https://api.ideogram.ai/v2/generations/${encodeURIComponent(acc.generation_id)}`, { headers: { 'Api-Key': cfg.ideogramKey } }, { retries: 2 });
    if (g.status === 'failed') throw new Error('Ideogram video failed: ' + (g.failure_reason || 'unknown reason'));
    if (g.status === 'completed') {
      const usd = g.usage_cost_usd_micros ? g.usage_cost_usd_micros / 1e6 : costUSD;
      store.spend(usd * cfg.usdToGbp, 'Ideogram video (Kling)', agent);
      const v = (g.data || [])[0];
      if (!v || !v.url) throw new Error('Ideogram video finished without a file.');
      fs.writeFileSync(path.join(config.DATA, 'files', name), await request('Ideogram download', v.url, {}, { raw: true }));
      return { file: name, url: v.url };
    }
  }
  throw new Error('The video took longer than 15 minutes. It will be retried.');
}

module.exports = { generate, edit, video, test };
