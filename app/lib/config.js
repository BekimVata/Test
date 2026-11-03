// Settings and secrets. Stored in data/config.json, readable only by the app user.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(path.join(DATA, 'files'), { recursive: true });
const FILE = path.join(DATA, 'config.json');

const DEFAULTS = {
  shopName: 'Banians',
  dailyCapGBP: 3,
  usdToGbp: 0.79,
  // Prices in pence, in your Printify/Etsy shop currency.
  prices: { sweatshirt: 3999, hoodie: 4499, mug: 1999 },
  ideogramCostUSD: 0.10,            // estimate per image, used for the spend cap
  models: { smart: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5' },
  modelPricesUSD: {                 // per million tokens, conservative estimates
    'claude-sonnet-5-5': { in: 3, out: 15 },
    'claude-haiku-5-5': { in: 1, out: 5 }
  },
  anthropicKey: '',
  ideogramKey: '',
  printifyToken: '',
  printifyShopId: '',
  telegramToken: '',
  telegramChatId: '',
  pairCode: '',
  passwordHash: '',
  sessionSecret: '',
  paused: false
};

let cfg = null;

function load() {
  if (cfg) return cfg;
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* first run */ }
  cfg = Object.assign({}, DEFAULTS, saved);
  cfg.prices = Object.assign({}, DEFAULTS.prices, saved.prices || {});
  cfg.models = Object.assign({}, DEFAULTS.models, saved.models || {});
  cfg.modelPricesUSD = Object.assign({}, DEFAULTS.modelPricesUSD, saved.modelPricesUSD || {});
  if (!cfg.sessionSecret) cfg.sessionSecret = crypto.randomBytes(32).toString('hex');
  if (!cfg.pairCode) cfg.pairCode = String(crypto.randomInt(100000, 999999));
  if (!cfg.shareToken) cfg.shareToken = crypto.randomBytes(16).toString('hex');
  save();
  return cfg;
}

function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

function update(patch) {
  load();
  Object.assign(cfg, patch);
  save();
  return cfg;
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(pw) {
  load();
  if (!cfg.passwordHash || !pw) return false;
  const [salt, hash] = cfg.passwordHash.split(':');
  const test = crypto.scryptSync(pw, salt, 64);
  const want = Buffer.from(hash, 'hex');
  return test.length === want.length && crypto.timingSafeEqual(test, want);
}

// What the browser is allowed to see: never the keys themselves.
function publicView() {
  load();
  const mask = v => (v ? '••••' + String(v).slice(-4) : '');
  return {
    shopName: cfg.shopName,
    dailyCapGBP: cfg.dailyCapGBP,
    prices: cfg.prices,
    ideogramCostUSD: cfg.ideogramCostUSD,
    paused: cfg.paused,
    pairCode: cfg.pairCode,
    telegramPaired: !!cfg.telegramChatId,
    keys: {
      anthropic: mask(cfg.anthropicKey),
      ideogram: mask(cfg.ideogramKey),
      printify: mask(cfg.printifyToken),
      telegram: mask(cfg.telegramToken)
    },
    printifyShopId: cfg.printifyShopId,
    shareToken: cfg.shareToken
  };
}

module.exports = { load, save, update, hashPassword, verifyPassword, publicView, DATA };
