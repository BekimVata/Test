// The office's work loop. Each item moves through these steps:
// queued → (Drita researches, Arben designs, the eagle checks) → awaiting_design (you approve)
// → approved_design → (Teuta writes, Gjergj builds the Printify product) → awaiting_publish (you approve)
// → approved_publish → published on Etsy.
// State is saved after every step, so a restart carries on where it left off.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const store = require('./store');
const claude = require('./anthropic');
const ideogram = require('./ideogram');
const printify = require('./printify');
const telegram = require('./telegram');
const { BRAND, COLLECTION, DIRECTIONS, COLOURWAYS, colourway, EMBLEM_PROMPT, designPrompt, shortTitle } = require('./briefs');
const preview = require('./preview');
const marketing = require('./marketing');
const stories = require('./stories');

const ACTIONABLE = ['queued', 'approved_design', 'approved_publish', 'approved_promo', 'approved_story'];
const EST = { queued: 0.12, approved_design: 0.02, approved_publish: 0, approved_promo: 0.35, approved_story: 1.0 }; // £ per step, for the cap
let busy = false;
let capNotedDay = '';

const gbp = n => '£' + (n / 100).toFixed(2);
const productName = p => p === 'sweatshirt' ? 'Christmas jumper' : p === 'hoodie' ? 'Christmas hoodie' : p;
const productsOf = it => it.products || [it.product];
const cwName = it => it.colourway && it.colourway !== 'navy' ? ` (${colourway(it.colourway).name})` : '';
const label = it => it.kind === 'story' ? require('./stories').label(it) : it.kind === 'promo' ? require('./marketing').label(it) : it.kind === 'kit' ? 'shop kit' : `${DIRECTIONS[it.direction]?.name || it.direction}${cwName(it)} ${productsOf(it).map(productName).join(' + ')}`;
const icon = it => it.product === 'mug' ? 'mug' : it.kind === 'kit' ? 'doc' : 'shirt';

function enqueueBatch(directions = Object.keys(DIRECTIONS), products = ['sweatshirt', 'hoodie'], colourways = ['navy']) {
  const made = [];
  for (const c of colourways) for (const d of directions) {
    const exists = store.state.items.find(i => i.kind === 'design' && i.direction === d && (i.colourway || 'navy') === c && !['rejected', 'failed'].includes(i.status));
    if (exists) continue;
    // One design, several products: the artwork is made once and reused on each product.
    made.push(store.newItem({ kind: 'design', direction: d, colourway: c, product: products[0], products }));
  }
  if (made.length) store.log('Shqiponja', `new batch: ${made.length} designs. Drita, Arben, to work!`);
  else store.log('Shqiponja', 'every design in that batch already exists or is in progress.');
  return made.length;
}

function enqueueKit() {
  store.newItem({ kind: 'kit', product: 'kit' });
  store.log('Shqiponja', 'shop kit ordered: logo, banner and shop texts.');
}

async function decide(id, stage, ok, by = 'office') {
  const it = store.getItem(id);
  if (!it) return false;
  if (stage === 'design' && it.status === 'awaiting_design') {
    store.updateItem(it, { status: ok ? 'approved_design' : 'rejected' });
    store.log('You', `${ok ? 'approved' : 'rejected'} the ${label(it)} design (${by}).`);
    if (!ok) store.act('arben', 'sad');
    return true;
  }
  if (stage === 'story' && it.kind === 'story') {
    const done = stories.decide(it, ok);
    if (done) store.log('You', `${ok ? 'approved the stills for' : 'rejected'} the ${stories.label(it)} (${by}).`);
    return done;
  }
  if (stage === 'promo' && it.kind === 'promo') {
    const done = marketing.decidePromo(it, ok);
    if (done) store.log('You', `${ok ? 'approved' : 'rejected'} ${marketing.label(it)} (${by}).`);
    return done;
  }
  if (stage === 'publish' && it.status === 'awaiting_publish') {
    store.updateItem(it, { status: ok ? 'approved_publish' : 'rejected' });
    store.log('You', `${ok ? 'said publish' : 'held back'} ${it.listing?.title ? '"' + it.listing.title.slice(0, 50) + '"' : label(it)} (${by}).`);
    if (!ok) store.log('Gjergj', 'left it as an unpublished draft in Printify. Nothing went to Etsy.');
    return true;
  }
  return false;
}

function capReached(it) {
  const cfg = config.load();
  const est = EST[it.status] || 0;
  if (store.todaySpend() + est <= cfg.dailyCapGBP) return false;
  if (capNotedDay !== store.today()) {
    capNotedDay = store.today();
    store.log('Shqiponja', `today's AI cap of £${cfg.dailyCapGBP.toFixed(2)} is reached. Work pauses until tomorrow.`);
    telegram.sendText(`🦅 Daily AI cap of £${cfg.dailyCapGBP.toFixed(2)} reached. The office continues tomorrow. You can raise the cap in Settings.`);
  }
  return true;
}

async function tick() {
  if (busy) return;
  const cfg = config.load();
  if (cfg.paused) return;
  const now = Date.now();
  // Your decisions move first, then the shop kit, then new designs.
  const rank = i => i.status === 'approved_publish' ? 0 : i.status === 'approved_design' ? 1 : i.status === 'approved_promo' || i.status === 'approved_story' ? 2 : i.kind === 'story' ? 4 : i.kind === 'kit' ? 3 : i.kind === 'promo' ? 5 : 4;
  // The marketing team plans its adverts when no design work is waiting.
  if (!store.state.items.some(i => i.kind === 'design' && ACTIONABLE.includes(i.status))) { try { marketing.planToday(); } catch (e) { console.error('plan', e); } }
  const it = store.state.items
    .filter(i => ACTIONABLE.includes(i.status) && (!i.retryAt || i.retryAt <= now))
    .sort((a, b) => rank(a) - rank(b) || a.id - b.id)[0];
  if (!it || capReached(it)) return;
  busy = true;
  try {
    if (it.kind === 'kit') await makeKit(it);
    else if (it.kind === 'story') { if (it.status === 'queued') await stories.makeStills(it); else await stories.filmAndEdit(it); }
    else if (it.kind === 'promo') { if (it.status === 'queued') await marketing.makeAdvert(it); else await marketing.scheduleAdvert(it); }
    else if (it.status === 'queued') await designStep(it);
    else if (it.status === 'approved_design') await productStep(it);
    else if (it.status === 'approved_publish') await publishStep(it);
    store.updateItem(it, { error: null, retryAt: null });
  } catch (e) {
    const tries = (it.errors || 0) + 1;
    const msg = e.message || String(e);
    store.updateItem(it, { errors: tries, error: msg, retryAt: Date.now() + 60000 * tries });
    store.log('Shqiponja', `problem with ${label(it)}: ${msg.slice(0, 160)}${tries < 4 ? ' Trying again shortly.' : ''}`);
    ['drita', 'arben', 'teuta', 'gjergj', 'besnik', 'lule', 'ilir', 'era'].forEach(a => store.act(a, 'idle'));
    if (tries >= 4) {
      store.updateItem(it, { status: 'failed' });
      telegram.sendText(`🦅 ${label(it)} failed after 4 tries: ${msg.slice(0, 300)}`);
    }
  } finally {
    busy = false;
  }
}

// ---------- Step 1: research, design, inspection ----------
async function designStep(it) {
  const d = DIRECTIONS[it.direction];
  const cfg = config.load();

  if (!it.research) {
    store.act('drita', 'work', { label: 'Researching buyers' });
    const r = await claude.askJSON({
      model: 'fast', agent: 'Drita', what: 'trend research', mockKind: 'research', maxTokens: 500,
      content: `You research Etsy buyers for a UK print-on-demand shop. ${BRAND} Current collection: ${COLLECTION.name}. The design is "${d.name}": ${d.look}, slogan "${d.text}", printed on a ${colourway(it.colourway).garment} ${it.product}. Return JSON only: {"audience": "who buys this, one sentence, inclusive, not limited to one gender", "angle": "the gift angle that sells it, one sentence", "keywords": ["8 Etsy search phrases buyers really type, each under 20 characters"]}`
    });
    store.updateItem(it, { research: r });
    store.act('drita', 'idle');
    store.log('Drita', `found the angle for ${label(it)}: ${r.angle}`);
    store.act('drita', 'handoff', { to: 'arben', icon: 'doc' });
  }

  store.act('arben', 'work', { label: 'Designing in Ideogram' });
  const img = await ideogram.generate({ prompt: designPrompt(it.direction, it.product, it.feedback, it.colourway), fileName: `design-${it.id}-${(it.attempts || 0) + 1}.png`, agent: 'Arben' });
  store.act('arben', 'idle');
  const files = (it.files || []).concat(img.file);
  const prev = preview.onGarment(img.file, colourway(it.colourway).hex);
  store.updateItem(it, { files, design: img.file, preview: prev, designUrl: img.url, seed: img.seed, attempts: (it.attempts || 0) + 1 });
  store.log('Arben', `finished design ${it.attempts} for ${label(it)}.`);

  // The eagle inspects.
  const check = await inspect(it, img);
  store.act('master', 'inspect', { agent: 'arben', ok: check.ok, reason: check.ok ? '' : (check.problems || [])[0] });
  if (!check.ok && it.attempts < 3) {
    store.updateItem(it, { feedback: check.fix || (check.problems || []).join('; '), check });
    store.log('Shqiponja', `sent ${label(it)} back to Arben: ${(check.problems || [check.fix]).join('; ').slice(0, 160)}`);
    return; // stays queued, next tick redesigns
  }
  store.updateItem(it, { status: 'awaiting_design', check });
  store.log('Shqiponja', check.ok ? `approved ${label(it)} (${check.score}/10). Over to you.` : `${label(it)} still isn't perfect after 3 tries. Sending it to you with my notes.`);
  store.act('arben', 'approval', { icon: icon(it) });
  await telegram.askApproval({
    itemId: it.id, stage: 'design', file: it.preview || img.file,
    caption: `🎨 Design #${it.id}: ${d.name}${cwName(it)} · on ${colourway(it.colourway).garment}\nSlogan: ${d.text}\nEagle's score: ${check.score ?? '–'}/10${check.ok ? '' : ' ⚠️ ' + (check.problems || []).join('; ')}\n\nApprove to turn it into a product.`
  });
}

async function inspect(it, img) {
  const d = DIRECTIONS[it.direction];
  const c = colourway(it.colourway);
  // Send the file itself (Ideogram's image links can't be opened by Claude).
  // The eagle looks at the navy preview, exactly as the design will look on the garment.
  const buf = fs.readFileSync(path.join(config.DATA, 'files', it.preview || img.file || it.design));
  if (buf.length > 3.7 * 1024 * 1024) {
    store.log('Shqiponja', `${label(it)} is too large for me to inspect, so it goes to you unchecked.`);
    return { ok: true, score: null, problems: ['not checked by the eagle (file too large)'], fix: '' };
  }
  const source = { type: 'base64', media_type: 'image/png', data: buf.toString('base64') };
  return claude.askJSON({
    model: 'smart', agent: 'Shqiponja', what: 'design inspection', mockKind: 'check', maxTokens: 600,
    system: 'You are the strict but fair art director of a print-on-demand shop. You only pass designs that are ready to print and sell.',
    content: [
      { type: 'image', source },
      { type: 'text', text: `Inspect this design for a ${productsOf(it).map(productName).join(' and ')}. IMPORTANT: the artwork is shown here on a ${c.garment} background, exactly as it will look printed on a ${c.garment} garment. ${c.light ? 'The garment is light, so the ink must be dark: flag anything pale or white that would vanish.' : 'Pale and white elements are intentional: judge contrast against the ' + c.garment + ' background, never against white.'} Brief: "${d.name}", colourway "${c.name}", palette ${c.palette}, look: ${d.look}. Text rule: ${d.textRule || 'The only text must read exactly: "' + d.text + '".'}
Check: 1) the text rule above is met and every word is spelled right; 2) colours match the palette; 3) artwork is isolated, no shirt, mockup, frame or background scene; 4) no brand logos, trademarks or known characters; 5) printable: no hairlines too thin to print, nothing tiny or cut off; 6) does it look stylish and sellable.
Return JSON only: {"ok": true or false, "score": 1-10, "problems": ["short problems, empty if none"], "fix": "one sentence telling the designer exactly what to change"}. ok must be false if the text rule fails or score is below 7.` }
    ]
  });
}

// ---------- Step 2: listings and Printify products (one per product type, same artwork) ----------
const PRODUCT_COPY = {
  sweatshirt: { what: 'Christmas jumper (a printed unisex crewneck sweatshirt, not knitted; free UK delivery included in the price)', start: 'Christmas Jumper', honest: 'a printed crewneck sweatshirt and not knitted' },
  hoodie: { what: 'Christmas hoodie (a printed unisex pullover hoodie; free UK delivery included in the price)', start: 'Christmas Hoodie', honest: 'a printed pullover hoodie' },
  mug: { what: '11oz ceramic Christmas mug', start: 'Christmas Mug', honest: 'a printed ceramic mug' }
};

async function writeListing(it, kind) {
  const d = DIRECTIONS[it.direction];
  const cfg = config.load();
  const pc = PRODUCT_COPY[kind] || { what: kind, start: '', honest: 'printed' };
  const c = colourway(it.colourway);
  const L = await claude.askJSON({
    model: 'fast', agent: 'Teuta', what: 'listing copy', mockKind: 'listing', maxTokens: 900,
    content: `Write an Etsy listing for ${cfg.shopName}. ${BRAND} This item is from the ${COLLECTION.name} collection. Product: ${pc.what}, in ${c.garment} with the "${d.name}" Christmas tree design (${d.look}) printed in ${c.palette.replace(/\s*\(#[0-9A-Fa-f]{6}\)/g, '')}, slogan "${d.text}". Buyer: ${it.research?.audience || 'gift buyers'}. Angle: ${it.research?.angle || ''}. Keywords: ${(it.research?.keywords || []).join(', ')}.
Rules: British spelling. The title is fixed: "${shortTitle(it.direction, kind, it.colourway)}" (return it unchanged). Put the other search phrases in the tags instead, and include the colour "${c.titleColour.toLowerCase()}" in at least two tags. Say honestly in the description that it is ${pc.honest}. No ALL CAPS, no emoji, no brand names, and never say it is for men, women or any one group. Description: 3 short paragraphs, warm and stylish, no claims about materials, sizing or care (product details are added separately). Exactly 13 tags, each under 20 characters, lowercase, no punctuation except spaces.
Return JSON only: {"title": "...", "description": "...", "tags": ["..."]}`
  });
  const tags = [...new Set((L.tags || []).map(t => String(t).toLowerCase().replace(/[^a-z0-9 '-]/g, '').trim().slice(0, 20)).filter(Boolean))].slice(0, 13);
  const disclosure = `\n\nAbout this design: created by ${cfg.shopName} using AI image tools from our own original concept, then reviewed and approved by hand. Made to order and shipped by our print partner.`;
  return { title: shortTitle(it.direction, kind, it.colourway), description: String(L.description || '') + disclosure, tags };
}

async function ensureEmblem(key = 'navy') {
  if (key === 'navy' && store.state.emblem) return store.state.emblem;
  store.state.emblems = store.state.emblems || {};
  if (key !== 'navy' && store.state.emblems[key]) return store.state.emblems[key];
  const c = colourway(key);
  store.act('arben', 'work', { label: `Designing the ${c.name} chest emblem` });
  const img = await ideogram.generate({ prompt: EMBLEM_PROMPT(key), fileName: key === 'navy' ? 'emblem.png' : `emblem-${key}.png`, agent: 'Arben' });
  store.act('arben', 'idle');
  if (key === 'navy') store.state.emblem = img.file; else store.state.emblems[key] = img.file;
  store.save();
  store.log('Arben', `designed the ${c.name} chest emblem for the front of the ${c.garment} hoodies.`);
  return img.file;
}

async function productStep(it) {
  const d = DIRECTIONS[it.direction];
  const cfg = config.load();
  const made = it.printifyAll || [];
  store.act('teuta', 'collect', { icon: icon(it) });
  for (const kind of productsOf(it)) {
    if (made.find(m => m.kind === kind)) continue; // already built (resumes after a restart)
    store.act('teuta', 'work', { label: `Writing the ${productName(kind)} listing` });
    const kept = (it.keepListings || {})[kind];
    const listing = kept || await writeListing(it, kind);
    store.act('teuta', 'idle');
    if (!kept) store.log('Teuta', `wrote "${listing.title.slice(0, 70)}" with ${listing.tags.length} tags and the AI disclosure.`);
    store.act('teuta', 'handoff', { to: 'gjergj', icon: 'doc' });

    let emblemFile = null;
    if (kind === 'hoodie') emblemFile = await ensureEmblem(it.colourway || 'navy');
    store.act('gjergj', 'work', { label: `Building the ${productName(kind)}` });
    const cat = await printify.catalogFor(kind);
    const details = cat.blueprintDescription ? `\n\nProduct details:\n${cat.blueprintDescription}` : '';
    const prod = await printify.createProduct({
      kind, title: listing.title, description: listing.description + details, tags: listing.tags,
      imageFile: it.design, emblemFile, colors: kind === 'mug' ? null : colourway(it.colourway).colors,
      background: kind === 'mug' ? d.mugBackground : null
    });
    store.act('gjergj', 'idle');
    made.push({ kind, ...prod, listing });
    store.updateItem(it, { printifyAll: made });
    const margin = prod.cost ? prod.price - prod.cost : null;
    store.log('Gjergj', `built the ${productName(kind)} draft: ${prod.variantCount} variants at ${gbp(prod.price)}${prod.cost ? `, cost ${gbp(prod.cost)}, about ${gbp(margin)} before Etsy fees` : ''}.`);
    if (margin !== null && margin < 600) store.log('Agron', `warning: the margin on the ${productName(kind)} is thin. Consider raising its price in Settings.`);
  }
  if (it.autoPublish) {
    // You already approved these exact products; they were only rebuilt in the Etsy-connected store.
    store.updateItem(it, { printify: made[0], listing: made[0].listing, status: 'approved_publish', pricingV2: true, autoPublish: false, keepListings: null });
    store.log('Gjergj', `rebuilt ${label(it)} in the Etsy-connected Printify store. Publishing now, as you approved.`);
    return;
  }
  store.updateItem(it, { printify: made[0], listing: made[0].listing, status: 'awaiting_publish', pricingV2: true });
  store.act('gjergj', 'approval', { icon: icon(it) });
  const lines = made.map(m => `• ${productName(m.kind)}: from ${gbp(m.price)}${m.cost ? ` (making it costs about ${gbp(m.cost)}; bigger sizes priced up to match)` : ''}`).join('\n');
  await telegram.askApproval({
    itemId: it.id, stage: 'publish', url: made[0].mockups[0], file: made[0].mockups[0] ? null : it.design,
    caption: `🛍️ Ready for Etsy: ${d.name}${cwName(it)}\n${lines}\n\nPublish ${made.length > 1 ? 'all ' + made.length : 'it'} to ${cfg.shopName}? Printify's product photos are allowed on Etsy; your own photos from a sample can be added later.`
  });
}

// ---------- Step 3: publish every product of the design ----------
async function publishStep(it) {
  const all = it.printifyAll || (it.printify ? [{ kind: it.product, ...it.printify, listing: it.listing }] : []);
  for (const m of all) {
    if (m.published) continue;
    store.act('gjergj', 'work', { label: `Publishing the ${productName(m.kind)}` });
    try { await printify.publish(m.shopId, m.id); }
    catch (e) {
      if (!printify.isNotConnected(e)) throw e;
      // The product sits in a Printify store that isn't linked to Etsy. Rebuild it in the one that is,
      // keeping the same listing text and your approval.
      store.act('gjergj', 'idle');
      await printify.ensureShop({ force: true });
      const keepListings = {};
      for (const x of all) if (x.listing) keepListings[x.kind] = x.listing;
      store.updateItem(it, { status: 'approved_design', printifyAll: [], printify: null, keepListings, autoPublish: true, errors: 0, retryAt: null, error: null });
      store.log('Gjergj', `${label(it)} was in a Printify store that isn't linked to Etsy. Rebuilding it in the Etsy-connected store, then publishing.`);
      return;
    }
    m.published = true;
    store.updateItem(it, { printifyAll: all });
    store.act('gjergj', 'idle');
    store.act('gjergj', 'shelf', { icon: m.kind === 'mug' ? 'mug' : 'shirt' });
    store.log('Gjergj', `published "${(m.listing?.title || label(it)).slice(0, 60)}" to Etsy through Printify. It takes a few minutes to appear.`);
  }
  store.updateItem(it, { status: 'published', publishedAt: Date.now() });
  telegram.sendText(`✅ Live on Etsy: ${all.map(m => m.listing?.title || productName(m.kind)).join(' | ')}`);
}

// ---------- Shop kit: logo, banner, texts ----------
async function makeKit(it) {
  const cfg = config.load();
  const kit = { files: [] };
  store.act('arben', 'work', { label: 'Designing logo' });
  const logo = await ideogram.generate({
    prompt: `Logo for "${cfg.shopName.toUpperCase()}", a premium year-round brand blending cosmic wonder with the beauty of nature. The full word "${cfg.shopName.toUpperCase()}" in bold, distinctive, sophisticated futuristic lettering in brilliant white, with a subtle celestial glow or a few tiny stars integrated into the letters, slightly extraterrestrial but clean and readable. Background: deep midnight blue (#0B1530) fading into cosmic black with a faint scattering of stars. Mysterious, modern, premium, not cartoonish. Centred, square composition, works as a small shop icon. No other text.`,
    size: '1024x1024', background: 'opaque', fileName: `kit-logo-${it.id}.png`, agent: 'Arben'
  });
  kit.files.push({ name: 'Shop logo (upload as your Etsy shop icon)', file: logo.file });
  store.act('arben', 'work', { label: 'Designing banner' });
  const banner = await ideogram.generate({
    prompt: `Wide banner for the "${cfg.shopName.toUpperCase()}" streetwear shop. A beautiful midnight-blue universe meeting nature: deep navy and cosmic black sky with subtle stars and a faint distant galaxy, above the dark silhouette of a mountain ridge and pine forest, soft atmospheric light giving depth and mystery. In the centre, the name "${cfg.shopName.toUpperCase()}" in bold futuristic brilliant-white lettering with a subtle celestial glow, the clear centrepiece. Premium, timeless, not seasonal. No other text.`,
    size: '2880x1440', background: 'opaque', fileName: `kit-banner-${it.id}.png`, agent: 'Arben'
  });
  kit.files.push({ name: 'Shop banner (Etsy cover photo)', file: banner.file });
  store.act('arben', 'idle');
  store.act('teuta', 'work', { label: 'Writing shop texts' });
  const t = await claude.askJSON({
    model: 'fast', agent: 'Teuta', what: 'shop texts', mockKind: 'kit', maxTokens: 1200,
    content: `Write Etsy shop texts for ${cfg.shopName}. ${BRAND} The current collection is ${COLLECTION.name}; mention it only as the latest collection. Be honest: designs are our own concepts, created with AI image tools and approved by hand; items are made to order by a print partner, with free UK delivery. British spelling, warm and confident, no emoji.
Return JSON only: {"shopTitle": "under 55 characters", "announcement": "2-3 sentences", "about": "a short About section, 2 paragraphs", "faq": ["3 short Q&A strings about delivery times, returns of made-to-order items, and sizing"]}`
  });
  kit.texts = t;
  store.act('teuta', 'idle');
  store.state.kits.push({ id: it.id, t: Date.now(), ...kit });
  store.updateItem(it, { status: 'delivered', kit });
  store.act('arben', 'shelf', { icon: 'doc' });
  store.log('Teuta', 'the shop kit is ready: logo, banner, title, announcement, About and FAQ.');
  for (const f of kit.files) await telegram.sendDocument(f.file, f.name);
  await telegram.sendText(`📝 Shop texts for ${cfg.shopName}\n\nTitle: ${t.shopTitle}\n\nAnnouncement: ${t.announcement}\n\nAbout:\n${t.about}\n\nFAQ:\n${(t.faq || []).join('\n')}`);
}

async function retitleAll() {
  let n = 0, skipped = 0;
  for (const it of store.state.items) {
    const all = it.printifyAll || [];
    for (const m of all) {
      const title = shortTitle(it.direction, m.kind, it.colourway);
      if (!m.id || (m.listing && m.listing.title === title)) continue;
      try { await printify.setTitle(m.shopId, m.id, title, !!m.published); }
      catch (e) { if (/8252|disabled for editing/i.test(e.message)) { skipped++; continue; } throw e; } // still publishing: try later
      if (m.listing) m.listing.title = title;
      n++;
    }
    if (all.length) store.updateItem(it, { printifyAll: all, listing: all[0].listing, printify: all[0] });
  }
  if (!skipped) { store.state.shortTitlesV1 = true; store.save(); }
  else setTimeout(() => retitleAll().catch(() => {}), 10 * 60 * 1000); // Printify locks products while publishing
  if (n) store.log('Teuta', `shortened ${n} listing titles, e.g. "${shortTitle('signal', 'sweatshirt', 'navy')}". Live ones update on Etsy within a few minutes.`);
}

function start() {
  telegram.setDecisionHandler(decide);
  telegram.setIdeaHandler(text => marketing.addIdea(text));
  marketing.migrateShareLinks();
  // Hoodie adverts made before 3 Nov 18:45 used the front photo (small emblem) instead of the back print: redo those not yet approved.
  if (!store.state.hoodieBackV1) {
    store.state.hoodieBackV1 = true; store.save();
    for (const it of store.state.items) {
      if (it.kind === 'promo' && it.productKind === 'hoodie' && ['queued', 'awaiting_promo'].includes(it.status)) {
        store.updateItem(it, { status: 'queued', mockup: null, mockupFront: null, lifestyle: null, pin: null, attempts: 0, check: null, feedback: null, errors: 0, retryAt: null, error: null });
        store.log('Shqiponja', `redoing ${marketing.label(it)} with the hoodie's back print. My first version used the wrong product photo.`);
        if (it.idea) telegram.sendText('🦅 Redoing your telescope advert: the first version used the front photo of the hoodie, so the back print was made up. The corrected one comes to you here shortly. Ignore the earlier one.');
      }
    }
  }
  // The two approved storyboards (4 Nov), both on the navy Star Map hoodie.
  if (!store.state.storyboardsV1) {
    const sm = store.state.items.find(i => i.kind === 'design' && i.direction === 'starmap' && (i.colourway || 'navy') === 'navy' && (i.printifyAll || []).some(m => m.kind === 'hoodie' && m.published));
    if (sm) { store.state.storyboardsV1 = true; store.save(); stories.create('lookup', sm.id); stories.create('wear', sm.id); }
  }
  // Bekim's telescope idea (3 Nov), on the Star Map hoodie in midnight navy: the constellation design suits a stargazer.
  if (!store.state.ideaTelescope) {
    store.state.ideaTelescope = true; store.save();
    const sm = store.state.items.find(i => i.kind === 'design' && i.direction === 'starmap' && (i.colourway || 'navy') === 'navy' && (i.printifyAll || []).some(m => m.kind === 'hoodie' && m.published));
    marketing.addIdea('A guy wearing one of the hoodies looks into a telescope at the night sky and the stars. As he looks, Santa Claus and his reindeer fly across the moon.', sm ? {
      sourceId: sm.id, productKind: 'hoodie',
      idea: {
        model: 'a man in his late twenties',
        scene: 'Night, seen from behind and slightly to the side: the man stands on a snowy hilltop beside a brass telescope on a tripod, leaning in to look through it, the big printed artwork on the back of his hoodie clearly visible; above the dark pine-covered mountains hangs a huge, bright full moon in a sky full of stars. The moon is empty.',
        motion: 'He looks through the telescope; a small dark silhouette of Santa Claus in his sleigh pulled by reindeer flies slowly across the face of the full moon from left to right; stars twinkle and a little snow drifts down. The camera slowly pushes in.',
        pinExtra: 'Add a small, crisp dark silhouette of Santa Claus in his sleigh with reindeer flying across the face of the moon.',
        duration: 8
      }
    } : {});
  }
  // Rebuild products made before the provider and pricing changes (3 Nov): new provider, pounds, size-based prices.
  for (const it of store.state.items) {
    const notLive = (it.printifyAll || []).every(m => !m.published);
    if (['awaiting_publish', 'approved_design', 'approved_publish'].includes(it.status) && (it.printifyAll || []).length && notLive && !it.pricingV2) {
      store.updateItem(it, { status: 'approved_design', printifyAll: [], printify: null, pricingV2: true });
      store.log('Gjergj', `rebuilding ${label(it)} with the cheaper print provider and size-based prices. The old drafts stay unpublished in Printify; you can ignore or delete them.`);
    }
  }
  // Clear review notes written when the eagle wrongly judged white artwork on a white background (fixed 3 Nov).
  for (const it of store.state.items) {
    if (it.status === 'queued' && /white background|white-on-white|near-white/i.test(it.feedback || '')) {
      store.updateItem(it, { feedback: null });
    }
  }
  // Retry items that failed because Claude's replies were cut short (fixed 3 Nov).
  for (const it of store.state.items) {
    if (it.status === 'failed' && /did not return JSON/.test(it.error || '')) {
      store.updateItem(it, { status: it.printifyAll && it.printifyAll.length ? 'approved_design' : 'queued', errors: 0, retryAt: null, error: null });
      store.log('Shqiponja', `retrying ${label(it)} now that the reply-length problem is fixed.`);
    }
  }
  // Retry publishes that failed because the Printify store wasn't linked to Etsy (fixed 3 Nov).
  for (const it of store.state.items) {
    if (['failed', 'approved_publish'].includes(it.status) && /8254|not connected to sales channel/i.test(it.error || '')) {
      store.updateItem(it, { status: 'approved_publish', errors: 0, retryAt: null, error: null });
    }
  }
  // Shorten the titles of products already made (agreed 3 Nov). Live listings update on Etsy too.
  if (!store.state.shortTitlesV1) retitleAll().catch(e => store.log('Shqiponja', `could not shorten every title yet: ${e.message.slice(0, 160)}`));
  // Queue the four new colourways of the three live designs once (asked for on 3 Nov).
  if (!store.state.colourwaysQueued) {
    store.state.colourwaysQueued = true; store.save();
    const n = enqueueBatch(['signal', 'starmap', 'transmission'], ['sweatshirt', 'hoodie'], ['pine', 'aurora', 'moonlight', 'redplanet']);
    if (n) telegram.sendText(`🦅 New colourways ordered: ${n} designs (The Signal, Star Map 2026 and Transmission in Pine & Starlight, Aurora, Moonlight and Red Planet). They'll come to you here for approval one by one.`);
  }
  // Items that were mid-step when the server stopped simply carry on.
  setInterval(() => tick().catch(e => console.error('tick', e)), 3000);
}

module.exports = { start, enqueueBatch, enqueueKit, decide, tick, COLOURWAYS };
