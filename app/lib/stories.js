// Storyboard videos (approved by Bekim on 4 Nov): multi-shot TikTok / Reels videos built scene by scene.
// queued → (Lule makes the first-frame stills, the eagle checks each) → awaiting_story (you approve the stills)
// → approved_story → (Era films each shot, the eagle checks 6 frames per clip, the office edits) → delivered.
// Real product photos are used for every close-up, so the buyer sees exactly what they'd get.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const store = require('./store');
const claude = require('./anthropic');
const ideogram = require('./ideogram');
const printify = require('./printify');
const telegram = require('./telegram');
const video = require('./video');
const mock = require('./mock');
const { request } = require('./http');
const marketing = require('./marketing');

const F = n => path.join(config.DATA, 'files', n);
const sniff = b => b[0] === 0xFF && b[1] === 0xD8 ? 'image/jpeg' : b.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : 'image/png';
const img = f => { const b = fs.readFileSync(F(f)); return { type: 'image', source: { type: 'base64', media_type: sniff(b), data: b.toString('base64') } }; };
const REAL = 'Shot like a real fashion campaign on a full-frame camera with a 35mm lens: true-to-life body proportions, natural skin texture, relaxed hands with five fingers, real fabric weight with folds. It must look like a real photograph, not AI. No text, no logos, no watermark.';

const STORIES = {
  wear: {
    title: 'Wear the Universe',
    caption: 'The Star Map hoodie. Christmas, written in the stars. Search Banians on Etsy. #christmashoodie #space #stargazing #ukgifts',
    shots: [
      { type: 'photo', view: 'back', secs: 2, text: 'the star map you can wear' },
      { type: 'ai', id: 'rooftop', view: 'back', secs: 3,
        still: 'A stylish man in his late twenties seen from behind, standing on a city rooftop at night, the city softly lit below, a clear sky full of stars above. The big printed artwork on the back of his hoodie is fully visible, centred and sharp.',
        motion: 'He slowly tilts his head up to look at the stars while the camera drifts gently around him. Calm, cinematic.' },
      { type: 'ai', id: 'turn', view: 'front', secs: 3, samePersonAs: 'rooftop',
        still: 'The same man on the same rooftop at night, now facing the camera with a slight, relaxed smile, warm string lights softly out of focus behind him. The front of the hoodie shows only the small chest emblem.',
        motion: 'He turns naturally towards the camera and smiles slightly; gentle handheld drift. His face and the hoodie stay exactly the same.' },
      { type: 'photo', view: 'front', secs: 2, text: 'navy · back print · sizes S–3XL' },
      { type: 'card', secs: 2 }
    ]
  },
  lookup: {
    title: 'Look Up · episode 1',
    caption: 'Look closer. The Star Map hoodie. Search Banians on Etsy. #christmas #lookup #moon #santa',
    shots: [
      { type: 'ai', id: 'telescope', view: 'back', secs: 6, text: 'look at the moon', textUntil: 1.5,
        still: 'Night. A man in his late twenties STANDS upright on a snowy hilltop, his back squarely to the camera, so the big printed artwork on the back of his hoodie is flat, large, centred between his shoulders and fully readable. A brass telescope on a tall tripod stands just to his right; he leans slightly and looks through its eyepiece, which is at his eye height, aimed up towards the moon. Above dark pine-covered mountains hangs a huge, bright full moon in a sky full of stars. The moon is empty.',
        motion: 'He looks through the telescope; a small dark silhouette of Santa Claus in his sleigh pulled by reindeer flies slowly across the face of the full moon from left to right; stars twinkle and a little snow drifts down; the camera slowly pushes in. The man and his hoodie stay exactly the same.' },
      { type: 'photo', view: 'back', secs: 2, text: 'Star Map hoodie · search Banians on Etsy' }
    ]
  }
};

function create(key, sourceId) {
  const it = store.newItem({ kind: 'story', story: key, sourceId, productKind: 'hoodie', product: 'story', shots: {} });
  store.log('Besnik', `storyboard "${STORIES[key].title}" is in production. Lule starts with the stills.`);
  return it;
}
const label = it => `"${(STORIES[it.story] || {}).title || it.story}" video`;

async function mockups(it) {
  if (it.back) return;
  const src = store.getItem(it.sourceId);
  const m = (src.printifyAll || []).find(x => x.kind === it.productKind);
  if (mock.on) { store.updateItem(it, { back: src.design, front: src.design, etsyUrl: 'https://banians.etsy.com', price: m.price }); return; }
  const info = await printify.productInfo(m.shopId, m.id);
  const pick = re => info.images.find(i => re.test(i.position || '') && !/person|model|lifestyle/i.test(i.position || '')) || info.images.find(i => re.test(i.position || ''));
  const b = pick(/back/i), f = pick(/front/i);
  if (!b || !f) throw new Error('Printify has no front and back photos of this hoodie yet.');
  const save = async (u, n) => { fs.writeFileSync(F(n), await request('Download', u, {}, { raw: true })); return n; };
  store.updateItem(it, { back: await save(b.src, `story-${it.id}-back.jpg`), front: await save(f.src, `story-${it.id}-front.jpg`), etsyUrl: marketing.shareLink(info.etsyUrl), price: m.price });
}

async function check(content) {
  return claude.askJSON({ model: 'smart', agent: 'Shqiponja', what: 'storyboard check', mockKind: 'check', maxTokens: 700,
    system: 'You are the strict quality director of a premium clothing brand. Only realistic, flawless work goes out.', content });
}
const VERDICT = 'Return JSON only: {"ok": true or false, "score": 1-10, "problems": ["short problems, empty if none"], "fix": "one sentence for the next attempt"}. ok must be false if any check fails or the score is below 8.';

// ---------- Stills ----------
async function makeStills(it) {
  const s = STORIES[it.story];
  await mockups(it);
  const banner = (() => { const k = store.state.items.filter(i => i.kind === 'kit' && i.kit && i.kit.files).pop(); const f = k && k.kit.files.find(x => /banner/i.test(x.name)); return f ? f.file : null; })();
  const shots = { ...(it.shots || {}) };
  for (const sh of s.shots.filter(x => x.type === 'ai')) {
    const cur = shots[sh.id] || {};
    if (cur.still && cur.stillOk) continue;
    const tries = (cur.tries || 0) + 1;
    const garment = sh.view === 'back' ? it.back : it.front;
    const other = sh.view === 'back' ? it.front : it.back;
    const prev = sh.samePersonAs && shots[sh.samePersonAs] && shots[sh.samePersonAs].still;
    const images = [garment, other, prev, banner].filter(Boolean);
    const n = i => i + 1;
    store.act('lule', 'work', { label: `Still: ${sh.id}` });
    const out = await ideogram.edit({
      images, size: '1152x2048', quality: 'high', costUSD: 0.10, agent: 'Lule', fileName: `story-${it.id}-${sh.id}-${tries}.png`,
      prompt: `Image 1 is the exact ${sh.view === 'back' ? 'BACK' : 'FRONT'} of a navy hoodie; image 2 is the ${sh.view === 'back' ? 'front' : 'back'} of the same hoodie (the big artwork is on the back, only a small emblem on the front).${prev ? ` Image ${n(images.indexOf(prev))} shows the man: keep exactly the same person, face, hair, build and clothing.` : ''} ${sh.still} Keep the hoodie colour and every printed design exactly as in the reference images: not redrawn, not mirrored, not distorted. ${REAL}${banner ? ` Use image ${n(images.indexOf(banner))} only for mood and colour; copy no text from it.` : ''}${cur.fix ? ' Important fix from review: ' + cur.fix : ''}`
    });
    store.act('lule', 'idle');
    const c = await check([img(garment), img(other), ...(prev ? [img(marketing.forCheck(prev))] : []), img(marketing.forCheck(out.file)), { type: 'text', text:
      `Image 1 is the real ${sh.view} of the hoodie, image 2 the real ${sh.view === 'back' ? 'front' : 'back'}.${prev ? ' Image 3 is the earlier still of the same man.' : ''} The last image is a new still for a video. Brief: ${sh.still}
Must pass: A) the hoodie colour and print match the real product (big artwork on the back, large and readable when the back is shown; only the small emblem on the front); B) it looks like a real photograph: natural proportions, face, hands and fabric, nothing AI-looking; C) the main action and setting of the brief are there (e.g. standing at the telescope, on a rooftop)${prev ? ', and it is clearly the same man' : ''}; D) no text, logos or watermarks.
Small differences in secondary details (exact lighting, background decorations, the precise pose) are NOT failures: mention them in problems but do not lower the score below 8 for them alone. Score the overall quality as a premium fashion photograph.
Return JSON only: {"ok": true or false, "score": 1-10, "problems": ["short problems, empty if none"], "fix": "one sentence for the next attempt"}. ok must be false if A, B, C or D fails, or the overall quality is below 8.` }]);
    shots[sh.id] = { ...cur, still: out.file, tries, check: c, stillOk: !!c.ok, fix: c.fix };
    store.updateItem(it, { shots });
    store.act('master', 'inspect', { agent: 'lule', ok: c.ok, reason: c.ok ? '' : (c.problems || [])[0] });
    if (!c.ok) {
      if (tries < 3) { store.log('Shqiponja', `sent the ${sh.id} still for ${label(it)} back to Lule: ${(c.problems || []).join('; ').slice(0, 150)}`); return; }
      store.updateItem(it, { status: 'rejected', dropped: true });
      store.log('Shqiponja', `stopped ${label(it)}: the ${sh.id} still didn't reach 8/10 after 3 tries.`);
      telegram.sendText(`🦅 I couldn't get the "${sh.id}" still for ${label(it)} to my quality bar after 3 tries (${(c.problems || []).slice(0, 2).join('; ')}). Nothing was filmed.`);
      return;
    }
    store.log('Shqiponja', `passed the ${sh.id} still for ${label(it)} (${c.score}/10).`);
  }
  // All stills passed: show them to you.
  store.updateItem(it, { status: 'awaiting_story' });
  const ai = s.shots.filter(x => x.type === 'ai');
  for (const [i, sh] of ai.entries()) {
    const st = shots[sh.id];
    if (i < ai.length - 1) await telegram.sendPhotoFile(st.still, `🎬 ${s.title} · still ${i + 1} of ${ai.length}: ${sh.id} (eagle ${st.check.score}/10)`);
  }
  const last = shots[ai[ai.length - 1].id];
  await telegram.askApproval({ itemId: it.id, stage: 'story', file: last.still,
    caption: `🎬 ${s.title} · still ${ai.length} of ${ai.length}: ${ai[ai.length - 1].id} (eagle ${last.check.score}/10)\n\nApprove the stills to film the video (about £${(ai.reduce((a, x) => a + x.secs, 0) * 0.084 * config.load().usdToGbp + 0.05).toFixed(2)}).` });
}

// ---------- Filming and editing ----------
async function filmAndEdit(it) {
  const s = STORIES[it.story];
  const shots = { ...(it.shots || {}) };
  for (const sh of s.shots.filter(x => x.type === 'ai')) {
    const cur = shots[sh.id];
    if (cur.clipOk) continue;
    const take = (cur.takes || 0) + 1;
    store.act('era', 'work', { label: `Filming ${sh.id}, take ${take}` });
    const raw = await ideogram.video({ image: cur.still, duration: sh.secs, costUSD: 0.084 * sh.secs, agent: 'Era', fileName: `story-${it.id}-${sh.id}-raw${take}.mp4`,
      prompt: `${sh.motion} Realistic live-action footage. The person keeps exactly the same face, body proportions and height in every frame; limbs and hands move naturally and never stretch. The hoodie and its printed artwork never change.${cur.clipFix ? ' Important fix from review: ' + cur.clipFix : ''}` });
    const fin = await video.finish(raw.file, `story-${it.id}-${sh.id}-take${take}.mp4`);
    const stills = await video.frames(fin, 6);
    store.act('era', 'idle');
    let c = { ok: true, score: null, problems: [] };
    if (stills.length) c = await check([img(marketing.forCheck(cur.still)), img(sh.view === 'back' ? it.back : it.front), ...stills.map(img), { type: 'text', text:
      `Image 1 is the approved first frame, image 2 the real product. The other ${stills.length} images are frames, in order, from the finished ${sh.secs}-second clip. Intended action: ${sh.motion}
Check every frame: 1) the person's face, proportions, height and build stay consistent and natural (no stretching, shrinking, extra or bent limbs, melting hands); 2) the hoodie and its print stay the same as the first frame and the real product; 3) the intended action happens and is physically believable; 4) it looks like real filmed footage. ${VERDICT}` }]);
    shots[sh.id] = { ...cur, takes: take, clip: fin, clipCheck: c, clipOk: !!c.ok, clipFix: c.fix };
    store.updateItem(it, { shots });
    if (!c.ok) {
      if (take < 2) { store.log('Shqiponja', `sent the ${sh.id} clip for ${label(it)} back to Era: ${(c.problems || []).join('; ').slice(0, 150)}`); throw new Error(`The ${sh.id} clip didn't pass; filming take 2.`); }
      store.updateItem(it, { status: 'rejected', dropped: true });
      store.log('Shqiponja', `dropped ${label(it)}: the ${sh.id} clip failed my check twice (${(c.problems || []).join('; ').slice(0, 140)}).`);
      telegram.sendText(`🦅 ${label(it)}: the "${sh.id}" clip failed my frame check twice (${(c.problems || []).slice(0, 2).join('; ')}), so I haven't sent it. Nothing else is affected.`);
      return;
    }
    store.log('Shqiponja', `passed the ${sh.id} clip for ${label(it)} (${c.score ?? '–'}/10).`);
  }
  // Edit: real photos, approved clips, text, end card.
  store.act('era', 'work', { label: 'Editing' });
  const logo = (() => { const k = store.state.items.filter(i => i.kind === 'kit' && i.kit && i.kit.files).pop(); const f = k && k.kit.files.find(x => /logo/i.test(x.name)); return f ? f.file : null; })();
  const price = '£' + ((it.price || config.load().prices.hoodie) / 100).toFixed(2);
  const segs = [];
  for (const [i, sh] of s.shots.entries()) {
    const out = `story-${it.id}-seg${i + 1}.mp4`;
    if (sh.type === 'photo') segs.push(await video.photoSegment(sh.view === 'back' ? it.back : it.front, sh.secs, sh.text, out));
    else if (sh.type === 'ai') segs.push(await video.clipSegment(shots[sh.id].clip, sh.secs, sh.text, out, { textUntil: sh.textUntil }));
    else segs.push(await video.endCard([`Star Map hoodie · ${price}`, 'Free UK delivery', 'search Banians on Etsy'], sh.secs, out, logo));
  }
  const final = await video.concat(segs, `story-${it.id}-final.mp4`);
  const info = await video.probe(final);
  store.act('era', 'idle');
  if (info.width !== 1080 || info.height !== 1920) throw new Error(`The edit came out ${info.width}x${info.height}, not 1080x1920.`);
  store.updateItem(it, { status: 'delivered', video: final, duration: info.duration });
  store.log('Era', `finished ${label(it)}: ${info.duration.toFixed(1)} seconds, 1080x1920. It's on your Telegram.`);
  await telegram.sendVideo(final, `🎬 ${s.title} is ready (1080×1920, ${info.duration.toFixed(0)}s, every clip passed the eagle).\n\nCaption to paste:\n${s.caption}\n\nInstagram Reel: same video; add a Story link sticker to ${it.etsyUrl}\n\nAdd a trending sound in the app before posting.`);
}

function decide(it, ok) {
  if (it.status !== 'awaiting_story') return false;
  store.updateItem(it, { status: ok ? 'approved_story' : 'rejected' });
  return true;
}

module.exports = { STORIES, create, makeStills, filmAndEdit, decide, label };
