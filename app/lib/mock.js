// Practice mode (MOCK=1): fake Claude, Ideogram and Printify so the office can be tested for free.
const zlib = require('zlib');
const on = process.env.MOCK === '1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Tiny PNG encoder for placeholder artwork.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

async function image(prompt) {
  await sleep(2500);
  const colors = (prompt.match(/#[0-9A-Fa-f]{6}/g) || ['#C8A456']).map(hex);
  const S = 256;
  const tiers = [[0.18, 0.40, 0.16], [0.30, 0.56, 0.24], [0.44, 0.74, 0.32]];
  const buf = png(S, S, (x, y) => {
    const u = x / S, v = y / S;
    for (let i = 0; i < tiers.length; i++) {
      const [top, bot, half] = tiers[i];
      if (v >= top && v <= bot) {
        const k = (v - top) / (bot - top), hw = half * k;
        if (Math.abs(u - 0.5) <= hw) return [...colors[i % colors.length], 255];
      }
    }
    if (v > 0.74 && v < 0.8 && Math.abs(u - 0.5) < 0.03) return [...colors[0], 255];
    if (v > 0.84 && v < 0.87 && Math.abs(u - 0.5) < 0.22) return [...colors[colors.length - 1], 255];
    return [0, 0, 0, 0];
  });
  return { buf, meta: { url: null, seed: Math.floor(Math.random() * 1e6), resolution: `${S}x${S}` } };
}

async function claude({ mockKind }) {
  await sleep(1800);
  if (mockKind === 'research') return JSON.stringify({ audience: 'Partners and friends buying a stylish Christmas gift for a man who hates novelty jumpers.', angle: 'A Christmas jumper he will actually wear.', keywords: ['mens christmas jumper', 'minimal xmas sweatshirt', 'christmas gift for him', 'tree sweatshirt', 'festive crewneck', 'xmas mug', 'gold tree mug', 'winter sweatshirt'] });
  if (mockKind === 'check') {
    const ok = Math.random() > 0.3;
    return JSON.stringify(ok ? { ok: true, score: 8, problems: [], fix: '' } : { ok: false, score: 5, problems: ['slogan letters are slightly uneven'], fix: 'Make the slogan letter spacing even and the star a little larger.' });
  }
  if (mockKind === 'idea') return JSON.stringify({ sourceId: 1, productKind: 'hoodie', model: 'a man', scene: 'A man from behind at a telescope on a snowy hill under a huge full moon.', motion: 'Santa and his reindeer glide across the moon.', pinExtra: 'Add Santa\'s sleigh crossing the moon.', duration: 7 });
  if (mockKind === 'promo') return JSON.stringify({ headline: 'Christmas, From Deep Space', pinTitle: 'Alien Christmas Jumper, Navy Space Sweatshirt, Sci Fi Xmas Gift', pinDescription: 'A Christmas jumper for stargazers and sci-fi fans. Free UK delivery.', keywords: ['sci fi christmas jumper', 'space christmas jumper'], caption: 'Christmas, received from deep space. #christmasjumper #scifi #space', scene: 'A snowy pine forest at night under a sky full of stars.', motion: 'Snow falls gently as the camera slowly pushes in.' });
  if (mockKind === 'listing') return JSON.stringify({ title: 'Minimal Christmas Tree Sweatshirt, Mens Festive Crewneck, Gold Pine Tree Jumper, Stylish Christmas Gift for Him', description: 'A Christmas jumper he will actually want to wear.\n\nThree clean tiers of pine, finished with a small star.\n\nWrapped up in minutes, worn all winter.', tags: ['mens christmas jumper', 'minimal christmas', 'christmas gift him', 'pine tree sweatshirt', 'festive crewneck', 'gold christmas tree', 'winter sweatshirt', 'xmas jumper', 'christmas sweater', 'modern christmas', 'evergreen', 'holiday sweatshirt', 'gift for boyfriend'] });
  if (mockKind === 'kit') return JSON.stringify({ shopTitle: 'Modern Christmas apparel and gifts', announcement: 'Welcome to Banians. Stylish Christmas designs, made to order.', about: 'Banians makes Christmas clothing you will actually wear.\n\nEvery design starts as our own idea.', faq: ['Delivery: usually 5-8 working days in the UK.', 'Returns: made to order, so we replace faulty items.', 'Sizing: unisex fit, size down for a slimmer look.'] });
  return 'ready';
}

let n = 0;
let lastUpload = null;
let lastVariants = 6;
async function printify(method, p, body) {
  await sleep(700);
  if (p === '/shops.json') return [{ id: 101, title: 'Banians', sales_channel: 'etsy' }];
  if (p === '/catalog/blueprints.json') return [
    { id: 49, title: 'Unisex Heavy Blend™ Crewneck Sweatshirt', brand: 'Gildan', model: '18000', description: '<p>A sturdy and warm sweatshirt.</p><ul><li>50% cotton, 50% polyester</li><li>Medium-heavy fabric</li></ul>' },
    { id: 77, title: 'Unisex Heavy Blend™ Hooded Sweatshirt', brand: 'Gildan', model: '18500', description: '<p>Warm pullover hoodie.</p>' },
    { id: 68, title: 'Ceramic Mug 11oz', brand: 'Generic', model: 'Mug', description: '<p>White ceramic mug, 11oz.</p>' }
  ];
  if (/print_providers\.json$/.test(p)) return [{ id: 6, title: 'T Shirt and Sons' }, { id: 29, title: 'Monster Digital' }];
  if (/^\/catalog\/print_providers\/(\d+)\.json$/.test(p)) return { location: { country: p.includes('/6.') ? 'GB' : 'US' } };
  if (/variants\.json$/.test(p)) {
    if (p.includes('/49/') || p.includes('/77/')) {
      const colors = ['Black', 'Forest Green', 'Maroon', 'Sand', 'Charcoal'];
      const sizes = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'];
      const variants = []; let id = 1000;
      for (const c of colors) for (const s of sizes) variants.push({ id: id++, title: `${c} / ${s}`, options: { color: c, size: s }, placeholders: [{ position: 'front' }, { position: 'back' }] });
      return { variants };
    }
    return { variants: [{ id: 2000, title: '11oz / White', options: { color: 'White', size: '11oz' }, placeholders: [{ position: 'front' }] }] };
  }
  if (p === '/uploads/images.json') { lastUpload = body.file_name; return { id: 'up' + (++n) }; }
  if (method === 'POST' && /\/products\.json$/.test(p)) { lastVariants = body.variants.length; } if (method === 'POST' && /\/products\.json$/.test(p)) return { id: 'prod' + (++n), _img: lastUpload };
  if (method === 'GET' && /\/products\/[^/]+\.json$/.test(p)) return { variants: [{ is_enabled: true, cost: lastVariants > 2 ? 2150 : 650 }], images: [{ src: '/files/' + lastUpload, is_default: true, position: 'front' }] };
  return {};
}

module.exports = { on, image, claude, printify };
