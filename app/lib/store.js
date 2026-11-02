// Office state: items in the pipeline, the money ledger and the office log.
// Every change is broadcast to the open office pages (Server-Sent Events).
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { DATA } = require('./config');

const FILE = path.join(DATA, 'state.json');
const bus = new EventEmitter();
bus.setMaxListeners(50);

let state = { items: [], ledger: [], log: [], spendByDay: {}, nextId: 1, kits: [] };
try { state = Object.assign(state, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { /* new office */ }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, FILE);
  }, 300);
}

const today = () => new Date().toISOString().slice(0, 10);

function emit(evt) { bus.emit('event', evt); }

function log(agent, msg) {
  const line = { t: Date.now(), agent, msg };
  state.log.push(line);
  if (state.log.length > 400) state.log = state.log.slice(-400);
  save();
  emit({ type: 'log', ...line });
  console.log(`[${new Date().toISOString()}] ${agent}: ${msg}`);
}

// Animation cue for the pixel office.
function act(agent, action, extra = {}) { emit({ type: 'act', agent, act: action, ...extra }); }

function spend(gbp, what, agent) {
  if (!gbp) return;
  const d = today();
  state.spendByDay[d] = (state.spendByDay[d] || 0) + gbp;
  state.ledger.push({ t: Date.now(), kind: 'cost', gbp: +gbp.toFixed(4), what, agent });
  save();
  emit({ type: 'money' });
}

function income(gbp, what) {
  state.ledger.push({ t: Date.now(), kind: 'income', gbp: +gbp.toFixed(2), what });
  save();
  emit({ type: 'money' });
}

function todaySpend() { return state.spendByDay[today()] || 0; }

function newItem(fields) {
  const item = Object.assign({ id: state.nextId++, created: Date.now(), status: 'queued', attempts: 0, files: [], notes: [] }, fields);
  state.items.push(item);
  save();
  emit({ type: 'item', item });
  return item;
}

function updateItem(item, patch) {
  Object.assign(item, patch, { updated: Date.now() });
  save();
  emit({ type: 'item', item });
  return item;
}

function getItem(id) { return state.items.find(i => i.id === Number(id)); }

function summary() {
  const items = state.items;
  const costs = state.ledger.filter(l => l.kind === 'cost').reduce((s, l) => s + l.gbp, 0);
  const income = state.ledger.filter(l => l.kind === 'income').reduce((s, l) => s + l.gbp, 0);
  return {
    todaySpend: todaySpend(),
    totalSpend: costs,
    totalIncome: income,
    published: items.filter(i => i.status === 'published').length,
    waiting: items.filter(i => i.status === 'awaiting_design' || i.status === 'awaiting_publish').length,
    inProgress: items.filter(i => !['published', 'rejected', 'failed', 'awaiting_design', 'awaiting_publish'].includes(i.status)).length
  };
}

module.exports = { state, bus, save, log, act, spend, income, todaySpend, newItem, updateItem, getItem, summary, emit, today };
