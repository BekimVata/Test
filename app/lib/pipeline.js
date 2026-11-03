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
const { DIRECTIONS, designPrompt } = require('./briefs');

const ACTIONABLE = ['queued', 'approved_design', 'approved_publish'];
const EST = { queued: 0.12, approved_design: 0.02, approved_publish: 0 }; // £ per step, for the cap
let busy = false;
let capNotedDay = '';

const gbp = n => '£' + (n / 100).toFixed(2);
const productName = p => p === 'sweatshirt' ? 'Christmas jumper' : p === 'hoodie' ? 'Christmas hoodie' : p;
const productsOf = it => it.products || [it.product];
const label = it => it.kind === 'kit' ? 'shop kit' : `${DIRECTIONS[it.direction]?.name || it.direction} ${productsOf(it).map(productName).join(' + ')}`;
const icon = it => it.product === 'mug' ? 'mug' : it.kind === 'kit' ? 'doc' : 'shirt';

function enqueueBatch(directions = Object.keys(DIRECTIONS), products = ['sweatshirt', 'hoodie']) {
  const made = [];
  for (const d of directions) {
    const exists = store.state.items.find(i => i.kind === 'design' && i.direction === d && !['rejected', 'failed'].includes(i.status));
    if (exists) continue;
    // One design, several products: the artwork is made once and reused on each product.
    made.push(store.newItem({ kind: 'design', direction: d, product: products[0], products }));
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
  const rank = i => i.status === 'approved_publish' ? 0 : i.status === 'approved_design' ? 1 : i.kind === 'kit' ? 2 : 3;
  const it = store.state.items
    .filter(i => ACTIONABLE.includes(i.status) && (!i.retryAt || i.retryAt <= now))
    .sort((a, b) => rank(a) - rank(b) || a.id - b.id)[0];
  if (!it || capReached(it)) return;
  busy = true;
  try {
    if (it.kind === 'kit') await makeKit(it);
    else if (it.status === 'queued') await designStep(it);
    else if (it.status === 'approved_design') await productStep(it);
    else if (it.status === 'approved_publish') await publishStep(it);
    store.updateItem(it, { error: null, retryAt: null });
  } catch (e) {
    const tries = (it.errors || 0) + 1;
    const msg = e.message || String(e);
    store.updateItem(it, { errors: tries, error: msg, retryAt: Date.now() + 60000 * tries });
    store.log('Shqiponja', `problem with ${label(it)}: ${msg.slice(0, 160)}${tries < 4 ? ' Trying again shortly.' : ''}`);
    ['drita', 'arben', 'teuta', 'gjergj'].forEach(a => store.act(a, 'idle'));
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
      content: `You research Etsy buyers for a UK print-on-demand shop called ${cfg.shopName} (stylish, modern Christmas designs anyone can relate to, aimed mostly at men). The design is "${d.name}": ${d.look}, slogan "${d.text}", on a ${it.product}. Return JSON only: {"audience": "who buys this, one sentence", "angle": "the gift angle that sells it, one sentence", "keywords": ["8 Etsy search phrases buyers really type, each under 20 characters"]}`
    });
    store.updateItem(it, { research: r });
    store.act('drita', 'idle');
    store.log('Drita', `found the angle for ${label(it)}: ${r.angle}`);
    store.act('drita', 'handoff', { to: 'arben', icon: 'doc' });
  }

  store.act('arben', 'work', { label: 'Designing in Ideogram' });
  const img = await ideogram.generate({ prompt: designPrompt(it.direction, it.product, it.feedback), fileName: `design-${it.id}-${(it.attempts || 0) + 1}.png`, agent: 'Arben' });
  store.act('arben', 'idle');
  const files = (it.files || []).concat(img.file);
  store.updateItem(it, { files, design: img.file, designUrl: img.url, seed: img.seed, attempts: (it.attempts || 0) + 1 });
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
    itemId: it.id, stage: 'design', file: img.file,
    caption: `🎨 Design #${it.id}: ${d.name} · ${productName(it.product)}\nSlogan: ${d.text}\nEagle's score: ${check.score ?? '–'}/10${check.ok ? '' : ' ⚠️ ' + (check.problems || []).join('; ')}\n\nApprove to turn it into a product.`
  });
}

async function inspect(it, img) {
  const d = DIRECTIONS[it.direction];
  let source;
  if (img.url) source = { type: 'url', url: img.url };
  else {
    const buf = fs.readFileSync(path.join(config.DATA, 'files', img.file));
    if (buf.length > 4.5 * 1024 * 1024) return { ok: true, score: null, problems: [], note: 'too large to check' };
    source = { type: 'base64', media_type: 'image/png', data: buf.toString('base64') };
  }
  return claude.askJSON({
    model: 'smart', agent: 'Shqiponja', what: 'design inspection', mockKind: 'check', maxTokens: 600,
    system: 'You are the strict but fair art director of a print-on-demand shop. You only pass designs that are ready to print and sell.',
    content: [
      { type: 'image', source },
      { type: 'text', text: `Inspect this ${it.product} design. Brief: "${d.name}", palette ${d.palette}, look: ${d.look}. The ONLY text must read exactly: "${d.text}".
Check: 1) text spelled exactly right and nothing else written; 2) colours match the palette; 3) artwork is isolated, no shirt, mockup, frame or background scene; 4) no brand logos, trademarks or known characters; 5) printable: no hairlines too thin to print, nothing tiny or cut off; 6) does it look stylish and sellable.
Return JSON only: {"ok": true or false, "score": 1-10, "problems": ["short problems, empty if none"], "fix": "one sentence telling the designer exactly what to change"}. ok must be false if the text is wrong or score is below 7.` }
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
  const L = await claude.askJSON({
    model: 'fast', agent: 'Teuta', what: 'listing copy', mockKind: 'listing', maxTokens: 900,
    content: `Write an Etsy listing for ${cfg.shopName}, a UK shop. Product: ${pc.what}, with the "${d.name}" Christmas tree design (${d.look}), slogan "${d.text}". Buyer: ${it.research?.audience || 'gift buyers'}. Angle: ${it.research?.angle || ''}. Keywords: ${(it.research?.keywords || []).join(', ')}.
Rules: British spelling. Title under 140 characters, starting with "${pc.start}", then the strongest search phrases. Say honestly in the description that it is ${pc.honest}. No ALL CAPS, no emoji, no brand names. Description: 3 short paragraphs, warm and stylish, no claims about materials, sizing or care (product details are added separately). Exactly 13 tags, each under 20 characters, lowercase, no punctuation except spaces.
Return JSON only: {"title": "...", "description": "...", "tags": ["..."]}`
  });
  const tags = [...new Set((L.tags || []).map(t => String(t).toLowerCase().replace(/[^a-z0-9 '-]/g, '').trim().slice(0, 20)).filter(Boolean))].slice(0, 13);
  const disclosure = `\n\nAbout this design: created by ${cfg.shopName} using AI image tools from our own original concept, then reviewed and approved by hand. Made to order and shipped by our print partner.`;
  return { title: String(L.title || '').slice(0, 140), description: String(L.description || '') + disclosure, tags };
}

async function productStep(it) {
  const d = DIRECTIONS[it.direction];
  const cfg = config.load();
  const made = it.printifyAll || [];
  store.act('teuta', 'collect', { icon: icon(it) });
  for (const kind of productsOf(it)) {
    if (made.find(m => m.kind === kind)) continue; // already built (resumes after a restart)
    store.act('teuta', 'work', { label: `Writing the ${productName(kind)} listing` });
    const listing = await writeListing(it, kind);
    store.act('teuta', 'idle');
    store.log('Teuta', `wrote "${listing.title.slice(0, 70)}" with ${listing.tags.length} tags and the AI disclosure.`);
    store.act('teuta', 'handoff', { to: 'gjergj', icon: 'doc' });

    store.act('gjergj', 'work', { label: `Building the ${productName(kind)}` });
    const cat = await printify.catalogFor(kind);
    const details = cat.blueprintDescription ? `\n\nProduct details:\n${cat.blueprintDescription}` : '';
    const prod = await printify.createProduct({
      kind, title: listing.title, description: listing.description + details, tags: listing.tags,
      imageFile: it.design, colors: kind === 'mug' ? null : d.shirtColors,
      background: kind === 'mug' ? d.mugBackground : null
    });
    store.act('gjergj', 'idle');
    made.push({ kind, ...prod, listing });
    store.updateItem(it, { printifyAll: made });
    const margin = prod.cost ? prod.price - prod.cost : null;
    store.log('Gjergj', `built the ${productName(kind)} draft: ${prod.variantCount} variants at ${gbp(prod.price)}${prod.cost ? `, cost ${gbp(prod.cost)}, about ${gbp(margin)} before Etsy fees` : ''}.`);
    if (margin !== null && margin < 600) store.log('Agron', `warning: the margin on the ${productName(kind)} is thin. Consider raising its price in Settings.`);
  }
  store.updateItem(it, { printify: made[0], listing: made[0].listing, status: 'awaiting_publish' });
  store.act('gjergj', 'approval', { icon: icon(it) });
  const lines = made.map(m => `• ${productName(m.kind)}: ${gbp(m.price)}${m.cost ? ` (cost ${gbp(m.cost)}, ~${gbp(m.price - m.cost)} before Etsy fees)` : ''}`).join('\n');
  await telegram.askApproval({
    itemId: it.id, stage: 'publish', url: made[0].mockups[0], file: made[0].mockups[0] ? null : it.design,
    caption: `🛍️ Ready for Etsy: ${d.name}\n${lines}\n\nPublish ${made.length > 1 ? 'all ' + made.length : 'it'} to ${cfg.shopName}? Remember: Etsy needs a real photo of each item. Add yours once your samples arrive.`
  });
}

// ---------- Step 3: publish every product of the design ----------
async function publishStep(it) {
  const all = it.printifyAll || (it.printify ? [{ kind: it.product, ...it.printify, listing: it.listing }] : []);
  for (const m of all) {
    if (m.published) continue;
    store.act('gjergj', 'work', { label: `Publishing the ${productName(m.kind)}` });
    await printify.publish(m.shopId, m.id);
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
    prompt: `Logo for a modern Christmas and winter apparel brand called "${cfg.shopName}". A minimal emblem of a stylised pine tree made of three stacked triangles in antique gold (#C8A456) above the wordmark "${cfg.shopName.toUpperCase()}" in an elegant, widely letter-spaced geometric sans-serif, antique gold, on a solid deep evergreen (#1F3D2B) background. Flat vector, centered, premium, simple, no other text.`,
    size: '1024x1024', background: 'opaque', fileName: `kit-logo-${it.id}.png`, agent: 'Arben'
  });
  kit.files.push({ name: 'Shop logo (upload as your Etsy shop icon)', file: logo.file });
  store.act('arben', 'work', { label: 'Designing banner' });
  const banner = await ideogram.generate({
    prompt: `Wide website banner for the "${cfg.shopName}" Etsy shop. A calm minimal winter scene: a row of geometric pine trees made of stacked triangles in deep evergreen (#1F3D2B), pine (#2E5E43) and antique gold (#C8A456) outlines across a soft oatmeal (#E9E1D1) background, with small gold stars. Lots of empty space in the centre. No text. Flat vector, premium, modern.`,
    size: '2880x1440', background: 'opaque', fileName: `kit-banner-${it.id}.png`, agent: 'Arben'
  });
  kit.files.push({ name: 'Shop banner (Etsy cover photo)', file: banner.file });
  store.act('arben', 'idle');
  store.act('teuta', 'work', { label: 'Writing shop texts' });
  const t = await claude.askJSON({
    model: 'fast', agent: 'Teuta', what: 'shop texts', mockKind: 'kit', maxTokens: 1200,
    content: `Write Etsy shop texts for ${cfg.shopName}, a new UK shop selling stylish, modern Christmas and winter print-on-demand apparel and mugs, aimed mostly at men but for anyone. Designs are geometric pine trees in evergreen, cranberry and gold. Be honest: designs are created with AI tools from our own concepts and approved by hand, products are made to order by a print partner. British spelling, warm and confident, no emoji.
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

function start() {
  telegram.setDecisionHandler(decide);
  // Items that were mid-step when the server stopped simply carry on.
  setInterval(() => tick().catch(e => console.error('tick', e)), 3000);
}

module.exports = { start, enqueueBatch, enqueueKit, decide, tick };
