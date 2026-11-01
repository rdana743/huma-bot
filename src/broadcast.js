// Рассылки из админки сайта: бот раз в 5 секунд забирает порцию сообщений, отправляет и отчитывается.
// Нужны SITE_URL и BOT_EVENTS_SECRET (те же, что для аналитики).
//
// Темп — около 20 сообщений в секунду: ниже лимитов Telegram (30/с) и MAX (30 запросов/с).

const SITE = (process.env.SITE_URL || '').replace(/\/$/, '');
const SECRET = process.env.BOT_EVENTS_SECRET || '';
const FOOTER = '\n\nОтписаться от рассылки — /stop';

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

/**
 * platform: 'max' | 'tg'
 * send(externalId, message) — отправляет одно сообщение; message: { text, buttonType, buttonText, buttonUrl }.
 * Ошибка с полем blocked = true — человек заблокировал бота; retryAfter (сек) — мессенджер просит подождать.
 */
function createBroadcaster(platform, send, { intervalMs = 5000, batch = 25, pauseMs = 50 } = {}) {
  let busy = false;
  let timer = null;

  async function tick() {
    if (busy) return 0;
    busy = true;
    let done = 0;
    try {
      const { items = [] } = await post('/api/bot/broadcasts/claim', { platform, limit: batch });
      const results = [];
      for (const it of items) {
        const message = { ...it.broadcast, text: it.broadcast.text + FOOTER };
        let attempt = 0;
        for (;;) {
          try {
            await send(it.externalId, message);
            results.push({ rid: it.rid, status: 'sent' });
            break;
          } catch (e) {
            if (e.retryAfter && attempt++ < 2) {
              await sleep(Math.min(e.retryAfter, 30) * 1000);
              continue;
            }
            results.push({ rid: it.rid, status: e.blocked ? 'blocked' : 'failed', error: String(e.message || e).slice(0, 200) });
            break;
          }
        }
        await sleep(pauseMs);
      }
      if (results.length) await post('/api/bot/broadcasts/report', { platform, results });
      done = results.length;
      if (done) console.log(`Рассылка ${platform}: отправлено ${results.filter((r) => r.status === 'sent').length} из ${done}`);
    } catch (e) {
      console.error(`Рассылка ${platform}: сайт недоступен, повторим позже:`, e.message);
    } finally {
      busy = false;
    }
    // Есть ещё очередь — следующая порция сразу
    if (done >= batch && timer) setImmediate(tick);
    return done;
  }

  return {
    tick,
    start() {
      if (!SITE || !SECRET) return console.log('Рассылки выключены: задайте SITE_URL и BOT_EVENTS_SECRET в .env');
      if (!timer) timer = setInterval(tick, intervalMs);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { createBroadcaster, setFetch: (f) => (fetchImpl = f), FOOTER };
