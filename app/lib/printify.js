// Printify: turns an approved design into a real product and publishes it to the Etsy shop.
// Printify prints and ships each order, so no agent is needed when something sells.
const fs = require('fs');
const path = require('path');
const { request } = require('./http');
const config = require('./config');
const store = require('./store');
const mock = require('./mock');

const BASE = 'https://api.printify.com/v1';
const CACHE = path.join(config.DATA, 'printify-catalog.json');
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) { /* none yet */ }
const saveCache = () => fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));

function api(method, p, body) {
  const cfg = config.load();
  if (mock.on) return mock.printify(method, p, body);
  if (!cfg.printifyToken) throw new Error('Printify token is missing. Add it on the Settings page.');
  return request('Printify', BASE + p, {
    method,
    headers: { Authorization: `Bearer ${cfg.printifyToken}`, 'Content-Type': 'application/json', 'User-Agent': 'BaniansOffice/1.0' },
    body: body ? JSON.stringify(body) : undefined
  });
}
const strip = h => String(h || '').replace(/<\/(p|li|div)>|<br\s*\/?>/gi, '\n').replace(/<li>/gi, '• ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\n\s*\n+/g, '\n').trim().slice(0, 900);
const list = r => Array.isArray(r) ? r : (r && Array.isArray(r.data) ? r.data : []);

async function shops() { return list(await api('GET', '/shops.json')); }

// Picks the Printify shop that is connected to Etsy.
async function ensureShop() {
  const cfg = config.load();
  if (cfg.printifyShopId) return cfg.printifyShopId;
  const all = await shops();
  if (!all.length) throw new Error('No shops in Printify. In Printify, open My stores and connect Etsy.');
  const etsy = all.find(s => /etsy/i.test(s.sales_channel || '')) || all[0];
  config.update({ printifyShopId: String(etsy.id) });
  return String(etsy.id);
}

const PRODUCTS = {
  sweatshirt: {
    match: b => (/gildan/i.test(b.brand || '') && /18000/.test(b.model || '')) ? 3 : (/crewneck sweatshirt/i.test(b.title) ? 1 : 0),
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
    placement: { x: 0.5, y: 0.42, scale: 0.62, angle: 0 }
  },
  hoodie: {
    match: b => (/gildan/i.test(b.brand || '') && /18500/.test(b.model || '')) ? 3 : (/pullover hood/i.test(b.title) || /hooded sweatshirt/i.test(b.title) ? 1 : 0),
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
    placement: { x: 0.5, y: 0.38, scale: 0.55, angle: 0 }
  },
  mug: {
    match: b => (/mug/i.test(b.title) && /11\s?oz/i.test(b.title) && !/travel|enamel|color|accent|magic|latte/i.test(b.title)) ? 2 : 0,
    sizes: null,
    placement: { x: 0.5, y: 0.5, scale: 0.55, angle: 0 }
  }
};

const EU = ['GB', 'IE', 'DE', 'NL', 'FR', 'ES', 'IT', 'PL', 'CZ', 'LV', 'LT', 'BE', 'AT', 'SE', 'DK', 'PT'];

// Finds the product type and the print provider closest to the UK. Cached after the first run.
async function catalogFor(kind) {
  if (cache[kind]) return cache[kind];
  const spec = PRODUCTS[kind];
  const blueprints = list(await api('GET', '/catalog/blueprints.json'));
  const bp = blueprints.map(b => ({ b, s: spec.match(b) })).filter(x => x.s > 0).sort((a, z) => z.s - a.s)[0];
  if (!bp) throw new Error(`Could not find a ${kind} in the Printify catalog.`);
  const providers = list(await api('GET', `/catalog/blueprints/${bp.b.id}/print_providers.json`));
  if (!providers.length) throw new Error(`No print providers for ${bp.b.title}.`);
  const scored = [];
  for (const p of providers.slice(0, 15)) {
    let country = '';
    try { const d = await api('GET', `/catalog/print_providers/${p.id}.json`); country = d.location?.country || ''; } catch (e) { /* skip */ }
    scored.push({ p, country, s: country === 'GB' ? 3 : EU.includes(country) ? 2 : country === 'US' ? 1 : 0 });
  }
  scored.sort((a, z) => z.s - a.s);
  const pick = scored[0];
  const v = await api('GET', `/catalog/blueprints/${bp.b.id}/print_providers/${pick.p.id}/variants.json`);
  const variants = (v.variants || []).map(x => ({ id: x.id, title: x.title, color: x.options?.color || '', size: x.options?.size || '', placeholders: (x.placeholders || []).map(ph => ph.position) }));
  cache[kind] = { blueprintId: bp.b.id, blueprintTitle: bp.b.title, blueprintDescription: strip(bp.b.description), providerId: pick.p.id, providerTitle: pick.p.title, providerCountry: pick.country, variants };
  saveCache();
  store.log('Gjergj', `will make ${kind}s as "${bp.b.title}", printed by ${pick.p.title}${pick.country ? ' (' + pick.country + ')' : ''}.`);
  return cache[kind];
}

function chooseVariants(kind, cat, wantedColors) {
  const spec = PRODUCTS[kind];
  let vs = cat.variants;
  if (spec.sizes) vs = vs.filter(v => spec.sizes.includes(v.size));
  if (wantedColors && wantedColors.length) {
    for (const c of wantedColors) {
      const hit = vs.filter(v => v.color.toLowerCase() === c.toLowerCase());
      if (hit.length) return hit;
    }
    for (const c of wantedColors) {
      const hit = vs.filter(v => v.color.toLowerCase().includes(c.toLowerCase()));
      if (hit.length) return hit;
    }
  }
  if (kind === 'mug') {
    const white = vs.filter(v => /white/i.test(v.color) || !v.color);
    return (white.length ? white : vs).slice(0, 2);
  }
  return vs.slice(0, 6);
}

async function uploadImage(fileName) {
  const buf = fs.readFileSync(path.join(config.DATA, 'files', fileName));
  const res = await api('POST', '/uploads/images.json', { file_name: fileName, contents: buf.toString('base64') });
  return res.id;
}

// Creates the product as a draft in Printify (not yet on Etsy). Returns the product with mockup images.
async function createProduct({ kind, title, description, tags, imageFile, colors, background }) {
  const cfg = config.load();
  const shopId = await ensureShop();
  const cat = await catalogFor(kind);
  const variants = chooseVariants(kind, cat, colors);
  if (!variants.length) throw new Error(`No ${kind} variants available in those colours.`);
  const imageId = await uploadImage(imageFile);
  const position = variants[0].placeholders.includes('front') ? 'front' : (variants[0].placeholders[0] || 'front');
  const price = cfg.prices[kind];
  const printArea = {
    variant_ids: variants.map(v => v.id),
    placeholders: [{ position, images: [{ id: imageId, ...PRODUCTS[kind].placement }] }]
  };
  if (background) printArea.background = background;
  const product = await api('POST', `/shops/${shopId}/products.json`, {
    title, description,
    blueprint_id: cat.blueprintId,
    print_provider_id: cat.providerId,
    variants: variants.map(v => ({ id: v.id, price, is_enabled: true })),
    print_areas: [printArea]
  });
  if (tags && tags.length) {
    try { await api('PUT', `/shops/${shopId}/products/${product.id}.json`, { tags }); }
    catch (e) { store.log('Gjergj', `couldn't set tags through Printify, so you'll add them on Etsy: ${e.message.slice(0, 80)}`); }
  }
  const full = await api('GET', `/shops/${shopId}/products/${product.id}.json`);
  const costs = (full.variants || []).filter(v => v.is_enabled).map(v => v.cost).filter(Boolean);
  const minCost = costs.length ? Math.max(...costs) : null;
  const mockups = (full.images || []).filter(i => i.is_default || i.position === 'front').map(i => i.src).slice(0, 3);
  return { id: product.id, shopId, price, cost: minCost, mockups: mockups.length ? mockups : (full.images || []).slice(0, 2).map(i => i.src), variantCount: variants.length, provider: cat.providerTitle };
}

async function publish(shopId, productId) {
  return api('POST', `/shops/${shopId}/products/${productId}/publish.json`, {
    title: true, description: true, images: true, variants: true, tags: true, keyFeatures: true, shipping_template: true
  });
}

async function test() {
  const all = await shops();
  if (!all.length) return 'Connected, but no shop yet. Connect Etsy inside Printify.';
  const etsy = all.find(s => /etsy/i.test(s.sales_channel || ''));
  if (etsy) config.update({ printifyShopId: String(etsy.id) });
  return `Connected · ${etsy ? 'Etsy shop "' + etsy.title + '"' : all.length + ' shop(s), none on Etsy yet'}`;
}

module.exports = { createProduct, publish, test, ensureShop, catalogFor };
