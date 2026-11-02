// Прогон сценариев Telegram-бота без сети: запросы к Bot API перехватываются.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'huma-tg-test-'));
process.env.TG_ADMIN_IDS = '777';
process.env.MINI_APP_URL = 'https://example.org/app/';

const { createTgBot } = require('../src/tg-bot');
// Какой источник бот отдаёт сайту в событии start
const analytics = require('../src/analytics');
const tracked = [];
analytics.track = (platform, user, event, props) => tracked.push({ platform, user, event, props });
const lastStart = () => tracked.filter((t) => t.event === 'start').pop().props.source;

const calls = [];
const bot = createTgBot('123:test', { botInfo: { id: 1, is_bot: true, first_name: 'HUMA', username: 'huma_tg_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } });
bot.api.config.use(async (prev, method, payload) => {
  calls.push({ method, payload });
  const result = method === 'sendMessage' || method === 'editMessageText'
    ? { message_id: calls.length, date: 0, chat: { id: payload.chat_id || 42, type: 'private' }, text: payload.text }
    : true;
  return { ok: true, result };
});
bot.catch((e) => { throw e.error || e; });

const from = { id: 42, is_bot: false, first_name: 'Иван', username: 'ivan' };
let n = 1;
const msg = (text, extra = {}) => ({
  update_id: n++,
  message: { message_id: n, date: 0, chat: { id: 42, type: 'private' }, from, text, ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}), ...extra },
});
const press = (data) => ({
  update_id: n++,
  callback_query: { id: 'cb' + n, from, chat_instance: 'x', data, message: { message_id: 5, date: 0, chat: { id: 42, type: 'private' }, text: 'old' } },
});
const sent = () => calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText');
const last = () => sent().pop().payload;

(async () => {
  await bot.handleUpdate(msg('/start post1'));
  assert.match(last().text, /^Привет, Иван! Используй наше приложение/);
  assert.deepEqual(last().reply_markup.inline_keyboard[0][0].web_app, { url: 'https://example.org/app/' });
  console.log('✓ приветствие с кнопкой мини-приложения');

  await bot.handleUpdate(msg('/menu'));
  await bot.handleUpdate(press('calc'));
  assert.equal(calls.at(-1).method, 'editMessageText');
  await bot.handleUpdate(msg('200'));
  await bot.handleUpdate(msg('90'));
  await bot.handleUpdate(msg('25 000'));
  assert.match(last().text, /40 пациентов/);
  console.log('✓ калькулятор в /menu');

  await bot.handleUpdate(press('lead:audit_calls'));
  assert.ok(last().reply_markup.keyboard[0][0].request_contact);
  await bot.handleUpdate(msg('', { text: undefined, contact: { phone_number: '+79001234567', first_name: 'Иван' } }));
  const admin = sent().find((c) => String(c.payload.chat_id) === '777');
  assert.ok(admin, 'админ получил заявку');
  assert.match(admin.payload.text, /Телефон: \+79001234567/);
  assert.match(admin.payload.text, /Источник: tg:post1/);
  assert.match(admin.payload.text, /потери ≈ 1\s000\s000 ₽/);
  console.log('✓ заявка через «Отправить мой номер» с данными калькулятора');

  await bot.handleUpdate(msg('/start buy_tariff_pro'));
  assert.match(last().text, /Тариф Pro/);
  await bot.handleUpdate(msg('+7 912 000-00-00, хочу подробнее'));
  const admin2 = sent().filter((c) => String(c.payload.chat_id) === '777').pop();
  assert.match(admin2.payload.text, /Тема: Тариф Pro/);
  assert.equal(lastStart(), 'unknown', 'вход из мини-приложения — не метка');
  console.log('✓ кнопка «Оформить» из мини-приложения → заявка, источник unknown');

  await bot.handleUpdate(msg('/start'));
  assert.equal(lastStart(), 'direct');
  assert.deepEqual(tracked.filter((t) => t.event === 'start').map((t) => t.props.source), ['post1', 'unknown', 'direct']);
  console.log('✓ /start без метки → direct');

  await bot.handleUpdate({ ...msg('/stats'), message: { ...msg('/stats').message, from: { ...from, id: 777 }, chat: { id: 777, type: 'private' } } });
  assert.match(last().text, /Заявок: 2/);
  console.log('✓ /stats для админа');
  console.log('\nВсе проверки Telegram пройдены');
})().catch((e) => { console.error(e); process.exit(1); });
