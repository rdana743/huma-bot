// Выдача после оплаты без сети: сайт и Telegram имитируются
const assert = require('node:assert');
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'huma-dl-'));
process.env.SITE_URL = 'https://site.test';
process.env.BOT_EVENTS_SECRET = 's';
process.env.TG_CLUB_CHAT_ID = '-1001234567890';
const { createTgBot, tgHandlers } = require('../src/tg-bot');
const deliveries = require('../src/deliveries');

const reports = [];
const items = [
  { id: 1, externalId: '501', kind: 'text', payload: { text: '✅ **Оплата прошла**', buttonType: 'app', buttonText: 'Мой кабинет' } },
  { id: 2, externalId: '501', kind: 'club_invite', payload: { until: '2027-01-01T00:00:00Z' } },
  { id: 3, externalId: '501', kind: 'file', payload: { title: 'Шаблон медиаплана', url: 'https://huma.marketing/api/bot/files/abc' } },
  { id: 4, externalId: '502', kind: 'club_remove', payload: {} },
  { id: 5, externalId: '503', kind: 'text', payload: { text: 'Вы начали оформлять заказ', buttonType: 'none', automation: 'abandoned_checkout' } },
  { id: 6, externalId: '504', kind: 'text', payload: { text: 'Сеть моргнула', buttonType: 'none' } },
  { id: 7, externalId: '505', kind: 'text', payload: { text: 'Сеть лежит', buttonType: 'none' } },
];
let flaky = 0;
let claimBody = null;
deliveries.setFetch(async (url, init) => {
  if (url.endsWith('/claim')) { claimBody = JSON.parse(init.body); return new Response(JSON.stringify({ items }), { status: 200 }); }
  reports.push(...JSON.parse(init.body).results);
  return new Response('{"ok":true}', { status: 200 });
});

const calls = [];
const bot = createTgBot('1:t', { botInfo: { id: 1, is_bot: true, first_name: 'H', username: 'h' } });
bot.api.config.use(async (prev, method, p) => {
  calls.push({ method, p });
  if (String(p.chat_id) === '503') return { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' };
  // 504: первая попытка — сетевая ошибка, вторая успешна; 505 — сеть лежит всё время
  if (String(p.chat_id) === '504' && flaky++ === 0) throw new Error('fetch failed');
  if (String(p.chat_id) === '505') throw new Error('fetch failed');
  if (method === 'createChatInviteLink') return { ok: true, result: { invite_link: 'https://t.me/+personalLINK', creator: {}, creates_join_request: false, is_primary: false, is_revoked: false } };
  return { ok: true, result: method.startsWith('send') ? { message_id: 1, date: 0, chat: { id: p.chat_id, type: 'private' } } : true };
});

(async () => {
  const n = await deliveries.createDeliverer('tg', tgHandlers(bot), { pauseMs: 0, retryPauseMs: 0, health: { get: () => ({ ok: false, since: '2026-11-01T10:00:00Z', error: 'fetch failed' }) } }).tick();
  assert.equal(n, 7);
  const m = (name) => calls.filter((c) => c.method === name);
  assert.match(m('sendMessage')[0].p.text, /<b>Оплата прошла<\/b>$/, 'у сообщения об оплате нет подписи про отписку');
  const inv = m('createChatInviteLink')[0].p;
  assert.equal(inv.chat_id, '-1001234567890');
  assert.equal(inv.member_limit, 1);
  assert.equal(m('sendMessage')[1].p.reply_markup.inline_keyboard[0][0].url, 'https://t.me/+personalLINK');
  assert.equal(m('sendDocument')[0].p.document, 'https://huma.marketing/api/bot/files/abc');
  assert.deepEqual(m('banChatMember')[0].p, { chat_id: '-1001234567890', user_id: 502 });
  assert.equal(m('unbanChatMember')[0].p.only_if_banned, true);
  assert.deepEqual(claimBody.health, { ok: false, since: '2026-11-01T10:00:00Z', error: 'fetch failed' }, 'состояние связи уходит на сайт');
  assert.deepEqual(reports.map((r) => r.status), ['done', 'done', 'done', 'done', 'blocked', 'done', 'retry']);
  assert.match(reports[6].error, /fetch failed/);
  console.log('✓ выдача: сообщение об оплате, личное приглашение в клуб, файл, удаление из канала, блокировка, повтор при сбое сети');
  console.log('\nВсе проверки выдачи пройдены');
})().catch((e) => { console.error(e); process.exit(1); });
