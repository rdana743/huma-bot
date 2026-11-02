// Очередь событий для сайта без сети: fetch имитируется
const assert = require('node:assert');
// Модуль читает адрес и секрет при загрузке — задаём до require
process.env.SITE_URL = 'https://site.test';
process.env.BOT_EVENTS_SECRET = 's';
const analytics = require('../src/analytics');

let sent = [];
let down = false;
analytics.setFetch(async (url, init) => {
  if (down) throw new Error('fetch failed');
  sent.push(JSON.parse(init.body));
  return new Response('{"ok":true}', { status: 200 });
});
const errors = console.error;
console.error = () => {}; // «сайт недоступен» в выводе теста не нужен

const startsOf = (id) => sent.filter((b) => b.user.id === String(id)).flatMap((b) => b.events.filter((e) => e.event === 'start'));

(async () => {
  // 2000 обычных событий заполняют очередь — start нового человека всё равно уходит, а лишнее обычное — нет
  for (let i = 0; i < 2000; i++) analytics.track('max', { id: 'u' + i }, 'menu');
  analytics.track('max', { id: 'late' }, 'menu');
  analytics.track('max', { id: 'new', source: 'post1' }, 'start', { source: 'post1' });
  await analytics.flush();
  assert.equal(sent.filter((b) => b.user.id === 'late').length, 0, 'обычное событие сверх 2000 отброшено');
  const fresh = sent.find((b) => b.user.id === 'new');
  assert.equal(fresh.user.source, 'post1');
  assert.deepEqual(startsOf('new').map((e) => e.props.source), ['post1']);
  console.log('✓ start не вытесняется обычными событиями при полной очереди');

  // Сайт лежит: человек пришёл по метке, потом снова нажал /start — сайт получает оба входа по порядку
  sent = [];
  down = true;
  analytics.track('tg', { id: 7, source: 'ads' }, 'start', { source: 'ads' });
  await analytics.flush();
  analytics.track('tg', { id: 7, source: 'direct' }, 'start', { source: 'direct' });
  down = false;
  await analytics.flush();
  const b = sent.find((x) => x.user.id === '7');
  assert.equal(b.user.source, 'ads', 'первая метка не затёрта повторным /start');
  assert.deepEqual(startsOf(7).map((e) => e.props.source), ['ads', 'direct']);
  console.log('✓ первая метка и порядок входов сохраняются, пока сайт недоступен');

  // Потолок для start — 50 000, дальше догонит сверка
  sent = [];
  down = true;
  for (let i = 0; i < 50_001; i++) analytics.track('max', { id: 's' + i, source: 'p' }, 'start', { source: 'p' });
  down = false;
  await analytics.flush();
  assert.equal(sent.length, 50_000);
  assert.equal(sent.some((x) => x.user.id === 's50000'), false);
  console.log('✓ событий start в очереди не больше 50 000');

  console.error = errors;
  console.log('\nВсе проверки очереди аналитики пройдены');
})().catch((e) => { console.error = errors; console.error(e); process.exit(1); });
