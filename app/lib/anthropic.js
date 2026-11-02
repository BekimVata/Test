// Claude: the agents' thinking. Fast model for writing, smart model for the eagle's checks.
const { request } = require('./http');
const config = require('./config');
const store = require('./store');
const mock = require('./mock');

async function ask({ model = 'fast', system, content, maxTokens = 1200, agent = 'Office', what = 'thinking', mockKind }) {
  const cfg = config.load();
  const modelId = cfg.models[model] || model;
  if (mock.on) return mock.claude({ mockKind, content });
  if (!cfg.anthropicKey) throw new Error('Anthropic key is missing. Add it on the Settings page.');
  const body = { model: modelId, max_tokens: maxTokens, messages: [{ role: 'user', content }] };
  if (system) body.system = system;
  const res = await request('Anthropic', 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': cfg.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = (res.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  const p = cfg.modelPricesUSD[modelId] || { in: 3, out: 15 };
  const usd = ((res.usage?.input_tokens || 0) * p.in + (res.usage?.output_tokens || 0) * p.out) / 1e6;
  store.spend(usd * cfg.usdToGbp, `${what} (${modelId})`, agent);
  return text;
}

// Ask for JSON and parse it, tolerating code fences or extra words around it.
async function askJSON(opts) {
  const text = await ask(opts);
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Claude did not return JSON: ' + text.slice(0, 200));
  return JSON.parse(text.slice(start, end + 1));
}

async function test() {
  const t = await ask({ model: 'fast', content: 'Reply with the single word: ready', maxTokens: 10, what: 'connection test' });
  return /ready/i.test(t) ? 'Connected' : 'Connected (unexpected reply)';
}

module.exports = { ask, askJSON, test };
