// Banians office server. Run: node app/server.js   (practice mode: MOCK=1 node app/server.js)
// Set the office password once: node app/server.js --set-password "your password"
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./lib/config');

if (process.argv[2] === '--set-password') {
  const pw = process.argv[3] || '';
  if (pw.length < 8) { console.error('Password must be at least 8 characters.'); process.exit(1); }
  config.load(); config.update({ passwordHash: config.hashPassword(pw) });
  console.log('Office password saved.');
  process.exit(0);
}

const store = require('./lib/store');
const pipeline = require('./lib/pipeline');
const telegram = require('./lib/telegram');
const mock = require('./lib/mock');
const { DIRECTIONS } = require('./lib/briefs');

const PORT = Number(process.env.PORT || 3000);
let VERSION = 'unknown';
try { VERSION = require('child_process').execSync('git -c safe.directory=* log -1 --format=%h', { cwd: path.join(__dirname, '..') }).toString().trim(); } catch (e) { /* not a git checkout */ }
const PUB = path.join(__dirname, 'public');
const cfg0 = config.load();
if (mock.on && !cfg0.passwordHash) config.update({ passwordHash: config.hashPassword('practice123') });

// ---------- sessions ----------
function sign(exp) { return crypto.createHmac('sha256', config.load().sessionSecret).update(String(exp)).digest('hex'); }
function makeCookie() {
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  const secure = process.env.INSECURE_COOKIE ? '' : '; Secure';
  return `office=${exp}.${sign(exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 3600}${secure}`;
}
function authed(req) {
  const m = /(?:^|;\s*)office=(\d+)\.([a-f0-9]+)/.exec(req.headers.cookie || '');
  if (!m || Number(m[1]) < Date.now()) return false;
  const want = sign(m[1]);
  return want.length === m[2].length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[2]));
}
const attempts = new Map(); // simple login rate limit per IP

// The Hetzner server number (shown in the Hetzner console as #123456789) lets the owner reset the password.
async function serverNumber() {
  const c = config.load();
  if (process.env.HETZNER_ID) return process.env.HETZNER_ID;
  if (c.hetznerId) return c.hetznerId;
  try {
    const r = await fetch('http://169.254.169.254/hetzner/v1/metadata/instance-id', { signal: AbortSignal.timeout(3000) });
    if (r.ok) { const id = (await r.text()).trim(); if (/^\d+$/.test(id)) { config.update({ hetznerId: id }); return id; } }
  } catch (e) { /* not on Hetzner */ }
  return '';
}
function limited(req) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const a = attempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60000) { a.n = 0; a.t = Date.now(); }
  attempts.set(ip, a);
  return a;
}

// ---------- helpers ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
function send(res, code, body, type = 'application/json', headers = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function file(res, p, type) {
  fs.readFile(p, (err, data) => err ? send(res, 404, { error: 'Not found' }) : send(res, 200, data, type || TYPES[path.extname(p)] || 'application/octet-stream'));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 1e6) { reject(new Error('Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      if ((req.headers['content-type'] || '').includes('application/json')) { try { resolve(JSON.parse(raw || '{}')); } catch (e) { reject(e); } }
      else resolve(Object.fromEntries(new URLSearchParams(raw)));
    });
  });
}

function publicItem(i) {
  return {
    id: i.id, kind: i.kind, direction: i.direction, directionName: DIRECTIONS[i.direction]?.name, colourway: i.colourway || 'navy', colourwayName: (pipeline.COLOURWAYS[i.colourway || 'navy'] || {}).name, product: i.product,
    status: i.status, attempts: i.attempts, design: i.design, preview: i.preview, files: i.files, check: i.check, listing: i.listing,
    mockups: i.printify?.mockups, price: i.printify?.price, cost: i.printify?.cost, products: i.products || [i.product], made: (i.printifyAll || []).map(m => ({ kind: m.kind, price: m.price, cost: m.cost, title: m.listing?.title })), error: i.error, created: i.created, updated: i.updated, kit: i.kit, story: i.kind === 'story' ? { label: require('./lib/stories').label(i), stills: Object.entries(i.shots || {}).map(([k, v]) => ({ id: k, file: v.still, score: v.check && v.check.score })), video: i.video } : undefined, promo: i.kind === 'promo' ? { label: require('./lib/marketing').label(i), pin: i.pin, lifestyle: i.lifestyle, video: i.video, copy: i.copy, etsyUrl: i.etsyUrl, productKind: i.productKind } : undefined
  };
}
function snapshot() {
  return {
    mock: mock.on,
    config: config.publicView(),
    summary: store.summary(),
    items: store.state.items.slice(-80).map(publicItem),
    log: store.state.log.slice(-80),
    ledger: store.state.ledger.slice(-50),
    marketing: { ...require('./lib/marketing').settings(), pinsQueued: (store.state.pins || []).filter(x => !x.uploaded).length, pinsTotal: (store.state.pins || []).length },
    directions: Object.fromEntries(Object.entries(DIRECTIONS).map(([k, d]) => [k, { name: d.name, text: d.text }]))
  };
}

const sseClients = new Set();
store.bus.on('event', evt => {
  const msg = `data: ${JSON.stringify(evt.type === 'item' ? { type: 'item', item: publicItem(evt.item) } : evt)}\n\n`;
  for (const c of sseClients) c.write(msg);
});
setInterval(() => { for (const c of sseClients) c.write(': ping\n\n'); }, 25000);

async function testAll() {
  const out = {};
  const run = async (k, fn) => { try { out[k] = { ok: true, msg: await fn() }; } catch (e) { out[k] = { ok: false, msg: e.message.slice(0, 200) }; } };
  const c = config.load();
  await Promise.all([
    run('anthropic', () => c.anthropicKey || mock.on ? require('./lib/anthropic').test() : Promise.reject(new Error('Not added yet'))),
    run('ideogram', () => c.ideogramKey || mock.on ? require('./lib/ideogram').test() : Promise.reject(new Error('Not added yet'))),
    run('printify', () => c.printifyToken || mock.on ? require('./lib/printify').test() : Promise.reject(new Error('Not added yet'))),
    run('telegram', () => c.telegramToken || mock.on ? telegram.test() : Promise.reject(new Error('Not added yet')))
  ]);
  return out;
}

// ---------- routes ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/health') return send(res, 200, { ok: true, version: VERSION });
    // Private share links for finished images (logo, banner, designs) so other sites, like Etsy, can fetch them.
    // Also serves advert images and clips, so Pinterest can fetch the pins it schedules.
    const sm = /^\/share\/([a-f0-9]{32})\/([\w.-]+\.(png|jpe?g|mp4))$/.exec(p);
    if (sm) {
      if (sm[1] !== config.load().shareToken) return send(res, 404, { error: 'Not found' });
      const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', mp4: 'video/mp4' }[sm[3]];
      return fs.readFile(path.join(config.DATA, 'files', path.basename(sm[2])), (err, data) => err ? send(res, 404, { error: 'Not found' })
        : send(res, 200, data, type, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400' }));
    }
    if (p === '/login' && req.method === 'GET') return file(res, path.join(PUB, 'login.html'));
    if (p === '/login' && req.method === 'POST') {
      const a = limited(req);
      if (a.n >= 8) return send(res, 429, 'Too many tries. Wait 15 minutes.', 'text/plain');
      const body = await readBody(req);
      if (config.verifyPassword(body.password)) {
        a.n = 0;
        return send(res, 303, '', 'text/plain', { Location: '/', 'Set-Cookie': makeCookie() });
      }
      a.n++;
      return send(res, 303, '', 'text/plain', { Location: '/login?wrong=1' });
    }
    if (p === '/login-info') return send(res, 200, { passwordSet: !!config.load().passwordHash, canReset: !!(await serverNumber()) });
    if (p === '/reset' && req.method === 'POST') {
      const a = limited(req);
      if (a.n >= 8) return send(res, 429, 'Too many tries. Wait 15 minutes.', 'text/plain');
      const body = await readBody(req);
      const want = await serverNumber();
      const given = String(body.server || '').replace(/\D/g, '');
      if (!want || given !== want) { a.n++; return send(res, 303, '', 'text/plain', { Location: '/login?badserver=1' }); }
      const pw = String(body.newPassword || '');
      if (pw.length < 8) return send(res, 303, '', 'text/plain', { Location: '/login?short=1' });
      config.update({ passwordHash: config.hashPassword(pw) });
      a.n = 0;
      store.log('Shqiponja', 'office password was reset with the server number.');
      return send(res, 303, '', 'text/plain', { Location: '/', 'Set-Cookie': makeCookie() });
    }
    if (!authed(req)) {
      if (p.startsWith('/api/')) return send(res, 401, { error: 'Log in first' });
      return send(res, 303, '', 'text/plain', { Location: '/login' });
    }

    if (p === '/' || p === '/office') return file(res, path.join(PUB, 'office.html'));
    if (p === '/setup') return file(res, path.join(PUB, 'setup.html'));
    if (p.startsWith('/files/')) {
      const name = path.basename(p);
      return file(res, path.join(config.DATA, 'files', name));
    }
    if (p === '/api/state') return send(res, 200, snapshot());
    if (p === '/api/colours') {
      // Garment colours each print provider stocks, so colourways can be matched to real names.
      const pf = require('./lib/printify'); const out = {};
      for (const k of ['sweatshirt', 'hoodie']) { try { out[k] = await pf.colours(k); } catch (e) { out[k] = { error: e.message }; } }
      return send(res, 200, out);
    }
    if (p === '/api/pinterest.csv') {
      const base = `https://${req.headers.host}`;
      const { csv, count } = require('./lib/marketing').pinterestCsv(base, { all: url.searchParams.get('all') === '1', minScore: Number(url.searchParams.get('minScore')) || 0 });
      return send(res, 200, csv, 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="banians-pins-${store.today()}.csv"`, 'X-Pin-Count': String(count) });
    }
    if (p === '/api/share') return send(res, 200, { base: `/share/${config.load().shareToken}/` });
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (req.method !== 'POST') return send(res, 404, { error: 'Not found' });
    if (!(req.headers['content-type'] || '').includes('application/json')) return send(res, 415, { error: 'JSON only' });
    const body = await readBody(req);

    if (p === '/api/settings') {
      const patch = {};
      const keyFields = { anthropicKey: 'anthropicKey', ideogramKey: 'ideogramKey', printifyToken: 'printifyToken', telegramToken: 'telegramToken' };
      for (const [k, f] of Object.entries(keyFields)) if (typeof body[k] === 'string' && body[k].trim()) patch[f] = body[k].trim();
      if (body.telegramToken && body.telegramToken.trim() !== config.load().telegramToken) patch.telegramChatId = '';
      if (body.marketing && typeof body.marketing === 'object') {
        const cur = require('./lib/marketing').settings(), b = body.marketing;
        const num = (v, lo, hi, d) => Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) ? Math.round(Number(v)) : d));
        patch.marketing = { ...cur,
          on: b.on === undefined ? cur.on : !!b.on,
          theme: typeof b.theme === 'string' && b.theme.trim() ? b.theme.trim().slice(0, 600) : cur.theme,
          promosPerDay: num(b.promosPerDay, 0, 10, cur.promosPerDay), pinsPerDay: num(b.pinsPerDay, 1, 5, cur.pinsPerDay), videosPerWeek: num(b.videosPerWeek, 0, 14, cur.videosPerWeek) };
      }
      if (body.dailyCapGBP !== undefined) patch.dailyCapGBP = Math.max(0.5, Math.min(50, Number(body.dailyCapGBP) || 3));
      if (body.priceSweatshirt || body.priceHoodie || body.priceMug) {
        const c = config.load();
        const pick = (v, cur) => Math.round(Number(v || cur / 100) * 100);
        patch.prices = { ...c.prices, sweatshirt: pick(body.priceSweatshirt, c.prices.sweatshirt), hoodie: pick(body.priceHoodie, c.prices.hoodie), mug: pick(body.priceMug, c.prices.mug) };
      }
      if (body.newPassword) {
        if (String(body.newPassword).length < 8) return send(res, 400, { error: 'Password must be at least 8 characters.' });
        patch.passwordHash = config.hashPassword(String(body.newPassword));
      }
      config.update(patch);
      store.log('Shqiponja', 'settings saved.');
      return send(res, 200, { ok: true, config: config.publicView() });
    }
    if (p === '/api/test') return send(res, 200, await testAll());
    if (p === '/api/batch') {
      const dirs = Array.isArray(body.directions) && body.directions.length ? body.directions.filter(d => DIRECTIONS[d]) : undefined;
      const prods = Array.isArray(body.products) && body.products.length ? body.products.filter(x => ['sweatshirt', 'hoodie', 'mug'].includes(x)) : undefined;
      const cws = Array.isArray(body.colourways) && body.colourways.length ? body.colourways.filter(c => pipeline.COLOURWAYS[c]) : undefined;
      return send(res, 200, { ok: true, added: pipeline.enqueueBatch(dirs, prods, cws) });
    }
    if (p === '/api/pinterest-uploaded') return send(res, 200, { ok: true, marked: require('./lib/marketing').markUploaded(Array.isArray(body.files) ? body.files.map(String) : undefined) });
    if (p === '/api/kit') { pipeline.enqueueKit(); return send(res, 200, { ok: true }); }
    if (p === '/api/decide') return send(res, 200, { ok: await pipeline.decide(body.id, body.stage, !!body.ok, 'office') });
    if (p === '/api/pause') {
      config.update({ paused: !!body.paused });
      store.log('Shqiponja', body.paused ? 'office paused. Nobody starts new work.' : 'office back on. To work!');
      return send(res, 200, { ok: true });
    }
    if (p === '/api/retry') {
      const it = store.getItem(body.id);
      if (it && it.status === 'failed') { store.updateItem(it, { status: it.printify ? 'approved_design' : 'queued', errors: 0, retryAt: null, error: null }); }
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Banians office running on http://127.0.0.1:${PORT}${mock.on ? ' (practice mode, password practice123)' : ''}`);
  pipeline.start();
  telegram.poll();
});
