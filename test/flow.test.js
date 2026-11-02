// Прогон сценариев бота без подключения к MAX: запросы к API перехватываются.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Тест пишет во временную папку и не трогает рабочие данные в data/
process.env.DATA_DIR = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'huma-bot-test-'));
process.env.ADMIN_USER_IDS = '999';
process.env.CHANNEL_URL = 'https://max.ru/huma_channel';
process.env.PAY_URL_GUIDE_CALLS = 'https://pay.example/guide';

const { createBot } = require('../src/bot');
// Какой источник бот отдаёт сайту в событии start
const analytics = require('../src/analytics');
const tracked = [];
analytics.track = (platform, user, event, props) => tracked.push({ platform, user, event, props });
const lastStart = () => tracked.filter((t) => t.event === 'start').pop();

const calls = [];
const fakeFetch = async (url, init) => {
  const u = new URL(url);
  calls.push({ method: init.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : null });
  const res = u.pathname === '/messages' ? { message: { body: { mid: 'm1' } } } : { success: true };
  return new Response(JSON.stringify(res), { status: 200, headers: { 'content-type': 'application/json' } });
};

const bot = createBot('test-token', { clientOptions: { fetch: fakeFetch } });
bot.botInfo = { user_id: 1, username: 'huma_bot', name: 'Huma' };
bot.catch((err) => { throw err; });

const user = { user_id: 42, name: 'Иван', first_name: 'Иван' };
let ts = 1;
const started = (payload) => ({ update_type: 'bot_started', timestamp: ts++, chat_id: 100, user, payload });
const text = (t, attachments) => ({
  update_type: 'message_created', timestamp: ts++,
  message: { sender: user, recipient: { chat_id: 100, chat_type: 'dialog' }, body: { mid: 'x' + ts, text: t, attachments } },
});
const press = (payload) => ({
  update_type: 'message_callback', timestamp: ts++,
  callback: { callback_id: 'cb' + ts, payload, user },
  message: { sender: { user_id: 1 }, recipient: { chat_id: 100, chat_type: 'dialog' }, body: { mid: 'm1', text: '' } },
});

const last = () => calls[calls.length - 1];
const lastText = () => last().body.text ?? last().body.message?.text;
const buttons = () => {
  const b = last().body.attachments ?? last().body.message?.attachments;
  return b[0].payload.buttons.flat();
};

(async () => {
  await bot.handleUpdate(started('tg_post1'));
  assert.match(lastText(), /^Привет, Иван! Используй наше приложение/);
  assert.deepEqual(buttons().map((b) => [b.type, b.web_app]), [['open_app', 'huma_bot']]);
  assert.deepEqual([lastStart().props.source, lastStart().user.source], ['tg_post1', 'tg_post1']);
  console.log('✓ приветствие с кнопкой мини-приложения, метка уходит на сайт');

  await bot.handleUpdate(text('/menu'));
  assert.match(lastText(), /Huma Marketing/);
  assert.equal(buttons().length, 4);
  console.log('✓ /menu открывает старое меню');

  await bot.handleUpdate(press('products'));
  assert.equal(last().path, '/answers');
  await bot.handleUpdate(press('product:guide_calls'));
  assert.ok(buttons().some((b) => b.type === 'link' && b.url === 'https://pay.example/guide'));
  console.log('✓ каталог и кнопка оплаты');

  await bot.handleUpdate(press('calc'));
  await bot.handleUpdate(text('200'));
  await bot.handleUpdate(text('сто пятьдесят'));
  assert.match(lastText(), /число/);
  await bot.handleUpdate(text('300'));
  assert.match(lastText(), /больше/);
  await bot.handleUpdate(text('90'));
  await bot.handleUpdate(text('25 000'));
  assert.match(lastText(), /40 пациентов/);
  assert.match(lastText(), /1\s000\s000 ₽/);
  console.log('✓ калькулятор: 200 звонков, 90 записей → 40 пациентов, 1 000 000 ₽');

  await bot.handleUpdate(press('lead:audit_calls'));
  assert.ok(calls.some((c) => c.path === '/answers' && c.body.notification));
  await bot.handleUpdate(text('привет'));
  assert.match(lastText(), /Не вижу номера/);
  await bot.handleUpdate(text('+7 900 123-45-67, клиника Улыбка, Екатеринбург'));
  const adminMsg = calls.find((c) => c.query.user_id === '999');
  assert.ok(adminMsg, 'админ получил заявку');
  assert.match(adminMsg.body.text, /Источник: tg_post1/);
  assert.match(adminMsg.body.text, /потери ≈ 1\s000\s000 ₽/);
  console.log('✓ заявка с телефоном, данными калькулятора и источником ушла админу');

  await bot.handleUpdate(text('', [{ type: 'contact', payload: { vcf_info: 'BEGIN:VCARD\nTEL:+79001112233\nEND:VCARD', max_info: user } }]));
  assert.match(lastText(), /Используй наше приложение/);
  await bot.handleUpdate(press('lead:contact'));
  await bot.handleUpdate(text('', [{ type: 'contact', payload: { vcf_info: 'BEGIN:VCARD\nVERSION:3.0\nTEL;TYPE=cell:+79001112233\nEND:VCARD', max_info: user } }]));
  assert.match(lastText(), /Заявка принята/);
  console.log('✓ заявка через кнопку «Отправить мой номер»');

  const s = require('../src/storage').stats();
  assert.equal(s.leads, 2); // до заявки из мини-приложения
  assert.equal(s.bySource.tg_post1, 1);
  console.log('✓ статистика:', JSON.stringify(s));
  await bot.handleUpdate(started('buy_tariff_pro'));
  assert.match(lastText(), /Тариф Pro/);
  await bot.handleUpdate(text('+7 912 000-00-00'));
  const fromApp = calls.filter((c) => c.query.user_id === '999').pop();
  assert.match(fromApp.body.text, /Тема: Тариф Pro/);
  assert.equal(lastStart().props.source, 'unknown', 'вход из мини-приложения — не метка');
  console.log('✓ кнопка «Оформить» из мини-приложения → заявка «Тариф Pro», источник unknown');

  await bot.handleUpdate(started(''));
  assert.equal(lastStart().props.source, 'direct');
  await bot.handleUpdate(text('/start'));
  assert.equal(lastStart().props.source, 'direct', 'команда /start тоже сообщает о входе');
  assert.equal(tracked.filter((t) => t.event === 'start').length, 4);
  const stats = require('../src/storage').stats();
  assert.deepEqual(stats.bySource, { tg_post1: 1 }, 'локальная статистика не изменилась');
  console.log('✓ вход без метки и команда /start → direct; /stats прежний');

  console.log('\nВсе проверки пройдены');
})().catch((e) => { console.error(e); process.exit(1); });
