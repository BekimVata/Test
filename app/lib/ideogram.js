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

module.exports = { generate, test };
