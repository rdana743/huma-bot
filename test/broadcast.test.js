// Рассылка без сети: сайт и Telegram имитируются
const assert = require('node:assert');
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'huma-bc-'));
process.env.SITE_URL = 'https://site.test';
process.env.BOT_EVENTS_SECRET = 's';
process.env.MINI_APP_URL = 'https://app.test/';
const { createTgBot, tgSender } = require('../src/tg-bot');
const broadcast = require('../src/broadcast');

const reports = [];
broadcast.setFetch(async (url, init) => {
  const body = JSON.parse(init.body);
  if (url.endsWith('/claim')) {
    const items = [1, 2, 3].map((n) => ({ rid: n, externalId: String(100 + n), broadcast: { id: 7, text: '**Новость** [сайт](https://huma.marketing)', buttonType: 'app', buttonText: 'Открыть' } }));
    return new Response(JSON.stringify({ items }), { status: 200 });
  }
  reports.push(...body.results);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});

const sent = [];
const bot = createTgBot('1:t', { botInfo: { id: 1, is_bot: true, first_name: 'H', username: 'h' } });
bot.api.config.use(async (prev, method, p) => {
  if (String(p.chat_id) === '102') return { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' };
  sent.push(p);
  return { ok: true, result: { message_id: 1, date: 0, chat: { id: p.chat_id, type: 'private' } } };
});

(async () => {
  const n = await broadcast.createBroadcaster('tg', tgSender(bot), { pauseMs: 0 }).tick();
  assert.equal(n, 3);
  assert.equal(sent.length, 2);
  assert.match(sent[0].text, /<b>Новость<\/b> <a href="https:\/\/huma.marketing">сайт<\/a>\n\nОтписаться от рассылки — \/stop$/);
  assert.equal(sent[0].reply_markup.inline_keyboard[0][0].web_app.url, 'https://app.test/');
  assert.deepEqual(reports.map((r) => r.status), ['sent', 'blocked', 'sent']);
  console.log('✓ рассылка: отправка, кнопка приложения, блокировка бота');
  console.log('\nВсе проверки рассылок пройдены');
})().catch((e) => { console.error(e); process.exit(1); });
