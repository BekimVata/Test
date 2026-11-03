// The marketing team (moved over from the Fiverr side on 3 Nov, until the Etsy shop is selling).
//   Besnik · campaign manager: picks which product to promote each day and schedules the pins
//   Ilir   · copywriter: headline, Pinterest title and description, TikTok/Instagram caption
//   Lule   · ad designer: a lifestyle photo of someone wearing the real product, and a Pinterest advert
//   Era    · video maker: a 5-second silent clip for TikTok / Reels (you add a trending sound in the app)
// The eagle checks every advert against the real product photo before it reaches you.
// Each advert: queued → awaiting_promo (you approve on Telegram) → approved_promo → scheduled.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const store = require('./store');
const claude = require('./anthropic');
const ideogram = require('./ideogram');
const printify = require('./printify');
const telegram = require('./telegram');
const preview = require('./preview');
const mock = require('./mock');
const { request } = require('./http');
const { BRAND, DIRECTIONS, colourway } = require('./briefs');

const productWord = k => k === 'hoodie' ? 'hoodie' : 'Christmas jumper';
const SLOTS = ['09:00', '12:30', '17:00', '19:30', '21:00']; // UK evening is Pinterest's busiest time
// Who wears it, in turn (3 Nov: Bekim asked for more men in the adverts). Mixed ages and backgrounds.
const MODELS = [
  'a stylish man in his late twenties',
  'a stylish woman in her thirties',
  'a bearded man in his thirties',
  'a couple, a man and a woman, both wearing the same design',
  'a man in his forties with a relaxed, confident look',
  'two male friends, one wearing the garment, laughing under the stars',
  'a young woman in her twenties',
  'a man in his twenties with an urban streetwear look'
];
const modelFor = it => MODELS[(it.id * 5 + (it.round || 1)) % MODELS.length];

function settings() {
  const c = config.load();
  return Object.assign({
    on: true,
    theme: 'Christmas, received from deep space: stars over snowy pine forests, quiet cosmic mystery, warm festive feeling. For people who love Christmas and sci-fi.',
    promosPerDay: 3, pinsPerDay: 5, videosPerWeek: 3,
    boards: { sweatshirt: 'Cosmic Christmas Jumpers', hoodie: 'Cosmic Christmas Hoodies', brand: 'Banians Cosmic Wonder' }
  }, c.marketing || {});
}

function kitFile(kind) {
  const kit = store.state.items.filter(i => i.kind === 'kit' && i.kit && i.kit.files).pop();
  const f = kit && kit.kit.files.find(x => new RegExp(kind, 'i').test(x.name));
  return f && fs.existsSync(path.join(config.DATA, 'files', f.file)) ? f.file : null;
}

const label = it => {
  const src = store.getItem(it.sourceId);
  if (!src) return 'your advert idea';
  const d = src && DIRECTIONS[src.direction];
  const c = src && colourway(src.colourway);
  return `${d ? d.name : 'product'}${c && src.colourway && src.colourway !== 'navy' ? ' (' + c.name + ')' : ''} ${productWord(it.productKind)} advert`;
};

// ---------- Besnik: one advert per live product, a few per day ----------
function planToday() {
  const s = settings();
  if (!s.on) return;
  const today = store.today();
  const made = store.state.items.filter(i => i.kind === 'promo' && i.planned === today).length;
  if (made >= s.promosPerDay) return;
  if (store.state.items.some(i => i.kind === 'promo' && ['queued', 'approved_promo'].includes(i.status))) return; // one at a time
  const live = [];
  for (const it of store.state.items) {
    if (it.kind !== 'design') continue;
    for (const m of it.printifyAll || []) if (m.published) live.push({ it, m });
  }
  if (!live.length) return;
  const count = (it, kind) => store.state.items.filter(p => p.kind === 'promo' && p.sourceId === it.id && p.productKind === kind && p.status !== 'failed').length;
  // Least-promoted first, newest designs breaking ties; at most 3 rounds of adverts per product.
  live.sort((a, b) => count(a.it, a.m.kind) - count(b.it, b.m.kind) || b.it.id - a.it.id);
  const pick = live.find(x => count(x.it, x.m.kind) < 3);
  if (!pick) return;
  const round = count(pick.it, pick.m.kind) + 1;
  const item = store.newItem({ kind: 'promo', sourceId: pick.it.id, productKind: pick.m.kind, round, planned: today, product: 'promo' });
  store.log('Besnik', `planned today's ${label(item)} (round ${round}). Ilir, Lule, over to you.`);
  return item;
}

async function fetchTo(url, name) {
  const buf = await request('Download', url, {}, { raw: true });
  fs.writeFileSync(path.join(config.DATA, 'files', name), buf);
  return name;
}

// Shrinks a PNG for the eagle (Claude accepts images up to about 5 MB).
function forCheck(file) {
  const full = path.join(config.DATA, 'files', file);
  if (/\.png$/i.test(file) && fs.statSync(full).size > 3.5 * 1024 * 1024) {
    const small = preview.onGarment(file, '#000000', 1024);
    if (small) return small;
  }
  return fs.statSync(full).size <= 3.7 * 1024 * 1024 ? file : null;
}
const sniff = b => b[0] === 0xFF && b[1] === 0xD8 ? 'image/jpeg' : b.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : 'image/png';
const imgBlock = f => { const b = fs.readFileSync(path.join(config.DATA, 'files', f)); return { type: 'image', source: { type: 'base64', media_type: sniff(b), data: b.toString('base64') } }; };

// ---------- Ilir, Lule, the eagle ----------
// Your own ideas (Telegram: /idea ...). Ilir picks the best live product for it and turns it into a scene and a motion.
function addIdea(text, preset = {}) {
  const item = store.newItem({ kind: 'promo', product: 'promo', round: 1, planned: null, idea: { text: String(text).slice(0, 800), ...preset.idea }, sourceId: preset.sourceId, productKind: preset.productKind });
  store.log('Besnik', `got your idea: "${String(text).slice(0, 120)}". Ilir and Lule are on it.`);
  return item;
}

async function shapeIdea(it) {
  const live = [];
  for (const x of store.state.items) if (x.kind === 'design') for (const m of x.printifyAll || []) if (m.published) {
    live.push({ id: x.id, kind: m.kind, name: `${DIRECTIONS[x.direction]?.name} in ${colourway(x.colourway).garment} (${productWord(m.kind)})` });
  }
  const r = await claude.askJSON({
    model: 'fast', agent: 'Ilir', what: 'advert idea', mockKind: 'idea', maxTokens: 700,
    content: `The shop owner has an idea for an advert photo and a 5 to 8 second video: "${it.idea.text}"
Live products (id, kind, name): ${live.map(l => `${l.id}|${l.kind}|${l.name}`).join('; ')}
Pick the product that fits the idea best (if the idea names hoodies or jumpers, pick that kind). Return JSON only:
{"sourceId": number, "productKind": "sweatshirt" or "hoodie", "model": "who wears it, from the idea", "scene": "the FIRST FRAME of the video as one rich sentence: the setting and pose, without anything that should only appear later in the video", "motion": "what happens during the video, in order, one or two sentences", "pinExtra": "one short sentence of what to add to the still advert so it shows the idea's key moment, or empty", "duration": 5 to 8}`
  });
  const pick = live.find(l => l.id === Number(r.sourceId) && l.kind === r.productKind) || live.find(l => l.id === Number(r.sourceId)) || live[0];
  if (!pick) throw new Error('No live products to advertise yet.');
  store.updateItem(it, { sourceId: pick.id, productKind: pick.kind, idea: { ...it.idea, model: r.model, scene: r.scene, motion: r.motion, pinExtra: r.pinExtra, duration: Math.max(5, Math.min(8, Number(r.duration) || 6)) } });
}

async function makeAdvert(it) {
  const s = settings();
  if (it.idea && (!it.sourceId || !it.idea.scene)) await shapeIdea(it);
  const src = store.getItem(it.sourceId);
  const m = (src.printifyAll || []).find(x => x.kind === it.productKind);
  const d = DIRECTIONS[src.direction];
  const c = colourway(src.colourway);

  // The real product: Etsy link and the front-of-garment mockup the buyer will see.
  if (!it.mockup) {
    store.act('besnik', 'work', { label: 'Fetching the product photo' });
    let etsyUrl = '', mockup = null;
    if (mock.on) { etsyUrl = 'https://www.etsy.com/listing/0/mock'; mockup = src.design; }
    else {
      const info = await printify.productInfo(m.shopId, m.id);
      etsyUrl = info.etsyUrl;
      const imgs = info.images.length ? info.images : (m.mockups || []).map(src => ({ src }));
      const want = it.productKind === 'hoodie' ? /back/i : /front/i;
      const best = imgs.find(i => i.isDefault) || imgs.find(i => want.test(i.position || '')) || imgs[0];
      if (!best) throw new Error('No product photo in Printify yet.');
      mockup = await fetchTo(best.src, `promo-${it.id}-product.jpg`);
    }
    if (!etsyUrl) throw new Error('The Etsy link for this product isn\'t ready yet (Printify is still syncing). Trying again later.');
    store.updateItem(it, { mockup, etsyUrl });
    store.act('besnik', 'idle');
  }

  if (!it.copy) {
    store.act('ilir', 'work', { label: 'Writing the advert' });
    const copy = await claude.askJSON({
      model: 'fast', agent: 'Ilir', what: 'advert copy', mockKind: 'promo', maxTokens: 900,
      content: `You write adverts for ${config.load().shopName}. ${BRAND}
Campaign theme from the owner: ${s.theme}${it.idea ? `
This advert is the owner's own idea, so the headline and captions should fit it: "${it.idea.text}"` : ''}
Product: a ${c.garment} ${productWord(it.productKind)} with the "${d.name}" design (${d.look}); its slogan: ${d.text}. Price includes free UK delivery. This is advert round ${it.round}, so choose a fresh angle and a different scene from earlier rounds.
Audience: people in the UK who love Christmas and also love sci-fi, space and the night sky; gift buyers for them. Inclusive: never aim at one gender.
Rules: British spelling, no emoji in titles, no ALL CAPS, never mention AI, no claims about materials. The headline must be short and printable on the image.
Return JSON only:
{"headline": "2 to 5 words for the image, e.g. 'Christmas, From Deep Space'",
 "pinTitle": "Pinterest title under 90 characters, with what it is and the key search words",
 "pinDescription": "Pinterest description, 250 to 450 characters, natural sentences with search phrases people use for Christmas jumpers and sci-fi gifts, ending with 'Free UK delivery.'",
 "keywords": ["6 Pinterest search phrases"],
 "caption": "TikTok and Instagram caption under 220 characters plus 6 to 8 relevant hashtags at the end",
 "scene": "one sentence: the setting for a lifestyle photo of ${modelFor(it)} wearing the ${productWord(it.productKind)} (keep exactly that person), in the Banians world of starry skies meeting nature (snowy pines, mountains, frozen lakes, aurora, a cosy cabin at night)",
 "motion": "one sentence: a slow, subtle camera move or natural motion for a 5-second clip of that photo (snow falling, stars twinkling, a slow push-in)"}`
    });
    if (it.idea) { copy.scene = it.idea.scene; copy.motion = it.idea.motion; }
    store.updateItem(it, { copy });
    store.act('ilir', 'idle');
    store.log('Ilir', `wrote ${label(it)}: "${copy.headline}".`);
    store.act('ilir', 'handoff', { to: 'lule', icon: 'doc' });
  }

  if (!it.model) store.updateItem(it, { model: (it.idea && it.idea.model) || modelFor(it) });
  const banner = kitFile('banner'), logo = kitFile('logo');
  const attempt = (it.attempts || 0) + 1;
  const fix = it.feedback ? ` Important fix from review: ${it.feedback}` : '';
  const sideNote = it.productKind === 'hoodie' ? 'The big artwork is printed on the back of the hoodie, so show the person from behind or three-quarter back so the artwork is clearly visible.' : 'Show the printed artwork on the chest clearly, facing the camera.';

  store.act('lule', 'work', { label: 'Lifestyle photo' });
  const lifestyle = await ideogram.edit({
    images: banner ? [it.mockup, banner] : [it.mockup],
    size: '1152x2048', quality: 'medium', fileName: `promo-${it.id}-life-${attempt}.png`, agent: 'Lule',
    prompt: `Image 1 is the exact product: a ${c.garment} ${productWord(it.productKind)} with a printed design. Create a premium, realistic fashion photograph of ${it.model || modelFor(it)} wearing exactly this garment. Keep the garment colour and the printed artwork exactly as in image 1: same shapes, same colours, same lettering, not redrawn, not mirrored, not distorted. ${sideNote} Setting: ${it.copy.scene}${banner ? ' Use image 2 only for mood and colour (midnight-blue cosmic sky meeting dark pine nature); do not copy any text from it.' : ''} Cinematic night light, natural skin and hands, shallow depth of field. No text, no logos, no watermark.${fix}`
  });
  store.act('lule', 'work', { label: 'Pinterest advert' });
  const pin = await ideogram.edit({
    images: logo ? [lifestyle.file, logo] : [lifestyle.file],
    size: '1024x1536', quality: 'medium', fileName: `promo-${it.id}-pin-${attempt}.png`, agent: 'Lule',
    prompt: `Turn image 1 into a tall, premium Pinterest advert. Keep the person and the garment from image 1 exactly as they are, including the printed artwork. Add the headline "${it.copy.headline}" in bold, clean, futuristic white lettering near the top, and the small line "Free UK delivery" near the bottom.${logo ? ' Place the logo from image 2 small and tidy in a bottom corner.' : ''} ${it.idea && it.idea.pinExtra ? ' ' + it.idea.pinExtra : ''} Minimal and elegant with breathing room, midnight-blue cosmic mood. No other text.${fix}`
  });
  store.act('lule', 'idle');
  store.updateItem(it, { lifestyle: lifestyle.file, pin: pin.file, attempts: attempt });
  store.log('Lule', `made the lifestyle photo and the Pinterest advert for ${label(it)} (try ${attempt}).`);

  // The eagle compares the advert with the real product.
  const a = forCheck(it.mockup), b = forCheck(lifestyle.file), p2 = forCheck(pin.file);
  let check = { ok: true, score: null, problems: ['not checked by the eagle (images too large)'] };
  if (a && b && p2) {
    check = await claude.askJSON({
      model: 'smart', agent: 'Shqiponja', what: 'advert inspection', mockKind: 'check', maxTokens: 700,
      system: 'You are the strict but fair brand director of a clothing shop. Adverts must show the real product honestly and look premium.',
      content: [imgBlock(a), imgBlock(b), imgBlock(p2), { type: 'text', text: `Image 1 is the real product photo. Image 2 is a lifestyle photo made for an advert, image 3 is the Pinterest advert made from it.
Check: 1) in images 2 and 3 the garment colour and the printed artwork match image 1 closely (same design, not redrawn into something different, readable where the original has text); a buyer must not feel misled; 2) image 3 headline reads exactly "${it.copy.headline}" and "Free UK delivery", spelled right, and there is no other stray text; 3) no warped faces, hands or extra limbs; 4) no third-party logos or brands; 5) premium, on-brand look (cosmic night sky meets nature, midnight blue).
Return JSON only: {"ok": true or false, "score": 1-10, "problems": ["short problems, empty if none"], "fix": "one sentence for the designer"}. ok must be false if check 1 or 2 fails or score is below 7.` }]
    });
  }
  store.act('master', 'inspect', { agent: 'lule', ok: check.ok, reason: check.ok ? '' : (check.problems || [])[0] });
  if (!check.ok && attempt < 2) {
    store.updateItem(it, { feedback: check.fix || (check.problems || []).join('; '), check });
    store.log('Shqiponja', `sent ${label(it)} back to Lule: ${(check.problems || [check.fix]).join('; ').slice(0, 160)}`);
    return;
  }
  store.updateItem(it, { status: 'awaiting_promo', check });
  store.log('Shqiponja', check.ok ? `passed ${label(it)} (${check.score}/10). Over to you.` : `${label(it)} still has issues after 2 tries. Sending it to you with my notes.`);
  store.act('lule', 'approval', { icon: 'doc' });
  await telegram.askApproval({
    itemId: it.id, stage: 'promo', file: pin.file,
    caption: `📣 Advert #${it.id}: ${label(it)}\nHeadline: ${it.copy.headline}\nPinterest: ${it.copy.pinTitle}\nTikTok/Reels: ${it.copy.caption}\nEagle: ${check.score ?? '–'}/10${check.ok ? '' : ' ⚠️ ' + (check.problems || []).join('; ')}\n\nApprove to schedule it on Pinterest${it.idea || videoDue() ? ' and make the video' : ''}.`
  });
}

function videoDue() {
  const s = settings();
  const weekAgo = Date.now() - 7 * 864e5;
  return (store.state.videos || []).filter(t => t > weekAgo).length < s.videosPerWeek;
}

// ---------- Besnik schedules, Era films ----------
function nextSlots(n) {
  const s = settings();
  const queue = store.state.pins || [];
  const taken = new Set(queue.map(p => p.at));
  const out = [];
  const perDay = Math.max(1, Math.min(SLOTS.length, s.pinsPerDay));
  for (let day = 0; out.length < n && day < 120; day++) {
    const d = new Date(Date.now() + day * 864e5);
    const ymd = d.toISOString().slice(0, 10);
    for (const t of SLOTS.slice(0, perDay)) {
      const at = `${ymd}T${t}:00`;
      if (!taken.has(at) && new Date(at + 'Z').getTime() > Date.now() + 30 * 60 * 1000) { out.push(at); taken.add(at); }
      if (out.length >= n) break;
    }
  }
  return out;
}

async function scheduleAdvert(it) {
  const s = settings();
  store.state.pins = store.state.pins || [];
  if (!it.pinned) {
    const [a, b] = nextSlots(2);
    const board = s.boards[it.productKind] || s.boards.brand;
    const base = { link: it.etsyUrl, description: it.copy.pinDescription, keywords: (it.copy.keywords || []).join(', '), promoId: it.id };
    store.state.pins.push({ ...base, at: a, file: it.pin, title: it.copy.pinTitle.slice(0, 100), board, uploaded: false });
    store.state.pins.push({ ...base, at: b, file: it.lifestyle, title: `${it.copy.headline} · ${it.copy.pinTitle}`.slice(0, 100), board: s.boards.brand, uploaded: false });
    store.save();
    store.updateItem(it, { pinned: true });
    store.log('Besnik', `scheduled 2 Pinterest pins for ${label(it)}: ${a.replace('T', ' ').slice(0, 16)} and ${b.replace('T', ' ').slice(0, 16)}.`);
  }
  if (it.wantVideo && !it.video) {
    store.act('era', 'work', { label: 'Filming the clip' });
    const secs = (it.idea && it.idea.duration) || 5;
    const v = await ideogram.video({ image: it.lifestyle, duration: secs, costUSD: 0.084 * secs, prompt: `${it.copy.motion} Keep the person, the garment and its printed artwork unchanged and steady. Calm, cinematic, premium.`, fileName: `promo-${it.id}-clip.mp4`, agent: 'Era' });
    store.act('era', 'idle');
    store.state.videos = (store.state.videos || []).concat(Date.now());
    store.updateItem(it, { video: v.file });
    store.log('Era', `filmed a ${(it.idea && it.idea.duration) || 5}-second clip for ${label(it)}. It's on your Telegram, ready to post.`);
    await telegram.sendVideo(v.file, `🎬 Ready for TikTok and Instagram Reels:\n\n${it.copy.caption}\n\nLink in bio: ${it.etsyUrl}\n\nTip: add a trending sound in the app before posting.`);
  }
  store.updateItem(it, { status: 'scheduled' });
  store.act('besnik', 'shelf', { icon: 'doc' });
}

function decidePromo(it, ok) {
  if (it.status !== 'awaiting_promo') return false;
  store.updateItem(it, { status: ok ? 'approved_promo' : 'rejected', wantVideo: ok && (!!it.idea || videoDue()) }); // your own ideas always get their video
  return true;
}

// ---------- Pinterest: a spreadsheet for Pinterest's free "Bulk create Pins" tool ----------
// Pinterest schedules each pin at its publish date. Media links are the office's private share links.
function pinterestCsv(baseUrl, { all = false } = {}) {
  const token = config.load().shareToken;
  const rows = (store.state.pins || []).filter(p => all || !p.uploaded);
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Title', 'Media URL', 'Pinterest board', 'Thumbnail', 'Description', 'Link', 'Publish date', 'Keywords'].join(',')];
  for (const p of rows) lines.push([p.title, `${baseUrl}/share/${token}/${p.file}`, p.board, '', p.description, p.link, p.at, p.keywords].map(q).join(','));
  return { csv: lines.join('\n') + '\n', count: rows.length };
}
function markUploaded() {
  let n = 0;
  for (const p of store.state.pins || []) if (!p.uploaded) { p.uploaded = true; n++; }
  store.save();
  if (n) store.log('Besnik', `${n} pins handed to Pinterest. They publish on their scheduled dates.`);
  return n;
}

module.exports = { addIdea, settings, planToday, makeAdvert, scheduleAdvert, decidePromo, pinterestCsv, markUploaded, label };
