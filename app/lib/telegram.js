// Telegram bot: your iPhone notifications, with Approve / Reject buttons.
// Only the chat that sends the pairing code from the Settings page can control the office.
const fs = require('fs');
const path = require('path');
const { request, sleep } = require('./http');
const config = require('./config');
const store = require('./store');
const mock = require('./mock');

let onDecision = null;     // (itemId, stage, ok) => void
let polling = false;

function api(method, params) {
  const cfg = config.load();
  return request('Telegram', `https://api.telegram.org/bot${cfg.telegramToken}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {})
  }, { retries: 2, timeoutMs: 70000 });
}

const ready = () => { const c = config.load(); return !mock.on && c.telegramToken && c.telegramChatId; };

function buttons(itemId, stage) {
  return { inline_keyboard: [[
    { text: stage === 'publish' ? '✅ Publish to Etsy' : '✅ Approve', callback_data: `d:${itemId}:${stage}:1` },
    { text: '❌ Reject', callback_data: `d:${itemId}:${stage}:0` }
  ]] };
}

async function sendText(text) {
  if (!ready()) return;
  try { await api('sendMessage', { chat_id: config.load().telegramChatId, text }); } catch (e) { console.error('telegram', e.message); }
}

// Sends a local image file (design) or a remote URL (Printify mockup) with approval buttons.
async function askApproval({ itemId, stage, caption, file, url }) {
  if (!ready()) return;
  const cfg = config.load();
  try {
    if (url) {
      await api('sendPhoto', { chat_id: cfg.telegramChatId, photo: url, caption: caption.slice(0, 1000), reply_markup: buttons(itemId, stage) });
    } else {
      const fd = new FormData();
      fd.append('chat_id', cfg.telegramChatId);
      fd.append('caption', caption.slice(0, 1000));
      fd.append('reply_markup', JSON.stringify(buttons(itemId, stage)));
      const buf = fs.readFileSync(path.join(config.DATA, 'files', file));
      fd.append('photo', new Blob([buf], { type: 'image/png' }), file);
      await request('Telegram', `https://api.telegram.org/bot${cfg.telegramToken}/sendPhoto`, { method: 'POST', body: fd }, { retries: 2 });
    }
  } catch (e) {
    console.error('telegram approval', e.message);
    await sendText(`${caption}\n\nOpen the office to approve (the picture couldn't be sent).`);
  }
}

async function sendDocument(file, caption) {
  if (!ready()) return;
  const cfg = config.load();
  const fd = new FormData();
  fd.append('chat_id', cfg.telegramChatId);
  fd.append('caption', (caption || '').slice(0, 1000));
  const buf = fs.readFileSync(path.join(config.DATA, 'files', file));
  fd.append('document', new Blob([buf]), file);
  try { await request('Telegram', `https://api.telegram.org/bot${cfg.telegramToken}/sendDocument`, { method: 'POST', body: fd }, { retries: 2 }); }
  catch (e) { console.error('telegram doc', e.message); }
}

async function handleUpdate(u) {
  const cfg = config.load();
  if (u.message) {
    const chatId = String(u.message.chat.id);
    const text = (u.message.text || '').trim();
    if (!cfg.telegramChatId) {
      if (text.includes(cfg.pairCode)) {
        config.update({ telegramChatId: chatId });
        await api('sendMessage', { chat_id: chatId, text: `Paired with the ${cfg.shopName} office. 🦅\nYou'll get designs to approve here.` });
        store.log('Shqiponja', 'paired with your Telegram. iPhone notifications are on.');
      } else {
        await api('sendMessage', { chat_id: chatId, text: 'Send the 6-digit pairing code from the office Settings page.' });
      }
    } else if (chatId === cfg.telegramChatId && /^\/status/.test(text)) {
      const s = store.summary();
      await api('sendMessage', { chat_id: chatId, text: `Today: £${s.todaySpend.toFixed(2)} AI spend\nWaiting for you: ${s.waiting}\nLive products: ${s.published}` });
    }
  }
  if (u.callback_query) {
    const q = u.callback_query;
    if (String(q.message?.chat?.id) !== cfg.telegramChatId) return;
    const m = /^d:(\d+):(\w+):([01])$/.exec(q.data || '');
    if (!m) return;
    const ok = m[3] === '1';
    const result = onDecision ? await onDecision(Number(m[1]), m[2], ok, 'Telegram') : false;
    await api('answerCallbackQuery', { callback_query_id: q.id, text: result ? (ok ? 'Approved' : 'Rejected') : 'Already handled' });
    try { await api('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: ok ? '✅ Approved' : '❌ Rejected', callback_data: 'x' }]] } }); } catch (e) { /* old message */ }
  }
}

async function poll() {
  if (polling) return;
  polling = true;
  let offset = 0;
  while (true) {
    const cfg = config.load();
    if (mock.on || !cfg.telegramToken) { await sleep(5000); continue; }
    try {
      const res = await request('Telegram', `https://api.telegram.org/bot${cfg.telegramToken}/getUpdates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offset, timeout: 50, allowed_updates: ['message', 'callback_query'] })
      }, { retries: 0, timeoutMs: 65000 });
      for (const u of res.result || []) { offset = u.update_id + 1; await handleUpdate(u).catch(e => console.error('tg update', e.message)); }
    } catch (e) {
      await sleep(5000);
    }
  }
}

async function test() {
  if (mock.on) return 'Connected (mock)';
  const me = await api('getMe');
  const cfg = config.load();
  return `Connected as @${me.result.username}${cfg.telegramChatId ? ' · paired' : ' · send the pairing code to the bot'}`;
}

module.exports = { poll, askApproval, sendText, sendDocument, test, setDecisionHandler: f => { onDecision = f; } };
