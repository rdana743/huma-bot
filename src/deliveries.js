// Выдача после оплаты и автоцепочки: бот раз в 5 секунд забирает очередь с сайта и выполняет.
// Виды: text — сообщение; file — гайд; club_invite — пригласить в HUMA Club; club_remove — убрать из канала.
//
// handlers — объект платформы: { text(id, msg), file(id, payload), clubInvite(id, payload), clubRemove(id) }.
// Ошибка с blocked = true — человек заблокировал бота; network = true — не достучались до мессенджера (сайт повторит позже).

const SITE = (process.env.SITE_URL || '').replace(/\/$/, '');
const SECRET = process.env.BOT_EVENTS_SECRET || '';
const { FOOTER } = require('./broadcast');

let fetchImpl = (...a) => fetch(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const res = await fetchImpl(`${SITE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${data.error || ''}`.trim());
  return data;
}

function createDeliverer(platform, handlers, { intervalMs = 5000, batch = 20, pauseMs = 60, retryPauseMs = 2000, health } = {}) {
  let busy = false;
  let timer = null;

  async function run(it) {
    const p = it.payload || {};
    switch (it.kind) {
      case 'text':
        // Подпись про отписку — только у автоцепочек; сообщения об оплате без неё
        return handlers.text(it.externalId, { ...p, text: p.automation ? p.text + FOOTER : p.text });
      case 'file':
        return handlers.file(it.externalId, p);
      case 'club_invite':
        return handlers.clubInvite(it.externalId, p);
      case 'club_remove':
        return handlers.clubRemove(it.externalId, p);
      default:
        throw new Error(`Неизвестный вид выдачи: ${it.kind}`);
    }
  }

  async function tick() {
    if (busy) return 0;
    busy = true;
    let n = 0;
    try {
      const { items = [] } = await post('/api/bot/deliveries/claim', { platform, limit: batch, health: health ? health.get() : undefined });
      const results = [];
      for (const it of items) {
        let attempt = 0;
        for (;;) {
          try {
            await run(it);
            results.push({ id: it.id, status: 'done' });
            break;
          } catch (e) {
            if (e.retryAfter && attempt++ < 2) {
              await sleep(Math.min(e.retryAfter, 30) * 1000);
              continue;
            }
            // Сеть или зеркало моргнули — пробуем ещё пару раз сразу, потом отдаём сайту «повторить позже»
            if (e.network && attempt++ < 2) {
              await sleep(retryPauseMs * attempt);
              continue;
            }
            results.push({ id: it.id, status: e.blocked ? 'blocked' : e.network ? 'retry' : 'failed', error: String(e.message || e).slice(0, 200) });
            console.error(`Выдача ${platform} (${it.kind}) не удалась:`, e.message);
            break;
          }
        }
        await sleep(pauseMs);
      }
      if (results.length) await post('/api/bot/deliveries/report', { platform, results });
      n = results.length;
    } catch (e) {
      console.error(`Выдача ${platform}: сайт недоступен, повторим позже:`, e.message);
    } finally {
      busy = false;
    }
    if (n >= batch && timer) setImmediate(tick);
    return n;
  }

  return {
    tick,
    start() {
      if (!SITE || !SECRET) return console.log('Выдача после оплаты выключена: задайте SITE_URL и BOT_EVENTS_SECRET в .env');
      if (!timer) timer = setInterval(tick, intervalMs);
    },
  };
}

module.exports = { createDeliverer, setFetch: (f) => (fetchImpl = f) };
