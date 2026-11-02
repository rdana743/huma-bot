// Выдача после оплаты в MAX без сети: сайт и API MAX имитируются
const assert = require('node:assert');
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'huma-mdl-'));
process.env.SITE_URL = 'https://site.test';
process.env.BOT_EVENTS_SECRET = 's';
process.env.MAX_CLUB_CHAT_ID = '-700';
const { MaxError } = require('@maxhub/max-bot-api');
const { maxHandlers } = require('../src/bot');
const deliveries = require('../src/deliveries');

const reports = [];
const items = [
  { id: 1, externalId: '601', kind: 'text', payload: { text: 'Оплата прошла', buttonType: 'none' } },
  { id: 2, externalId: '602', kind: 'text', payload: { text: 'Сеть моргнула', buttonType: 'none' } },
  { id: 3, externalId: '603', kind: 'file', payload: { title: 'Гайд', url: 'https://huma.marketing/api/bot/files/x' } },
  { id: 4, externalId: '604', kind: 'text', payload: { text: 'Заблокировал', buttonType: 'none' } },
  { id: 5, externalId: '605', kind: 'text', payload: { text: 'Ошибка MAX', buttonType: 'none' } },
  { id: 6, externalId: '606', kind: 'club_remove', payload: {} },
];
deliveries.setFetch(async (url, init) => {
  if (url.endsWith('/claim')) return new Response(JSON.stringify({ items }), { status: 200 });
  reports.push(...JSON.parse(init.body).results);
  return new Response('{"ok":true}', { status: 200 });
});

const netError = () => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
let flaky = 0;
const sent = [];
const bot = {
  botInfo: { username: 'huma_bot' },
  api: {
    async sendMessageToUser(id, text) {
      if (id === 602 && flaky++ === 0) throw netError(); // первая попытка — сеть, вторая успешна
      if (id === 603) throw netError(); // сеть лежит всё время
      if (id === 604) throw new MaxError(403, { code: 'chat.denied', message: 'chat.denied' });
      if (id === 605) throw new MaxError(400, { code: 'proto.payload', message: 'bad payload' });
      sent.push({ id, text });
    },
    async removeChatMember() {
      throw netError();
    },
  },
};

(async () => {
  const n = await deliveries.createDeliverer('max', maxHandlers(bot), { pauseMs: 0, retryPauseMs: 0 }).tick();
  assert.equal(n, 6);
  assert.deepEqual(sent.map((s) => s.id), [601, 602]);
  assert.deepEqual(reports.map((r) => r.status), ['done', 'done', 'retry', 'blocked', 'failed', 'retry']);
  assert.match(reports[2].error, /ECONNRESET/);
  console.log('✓ выдача MAX: сбой сети — повтор, а не потеря; блокировка и ошибка MAX различаются; удаление из канала тоже повторяется');
  console.log('\nВсе проверки выдачи MAX пройдены');
})().catch((e) => { console.error(e); process.exit(1); });
