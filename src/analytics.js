// Отправка событий и заявок в админку сайта (huma.marketing/admin/bot).
// Нужны SITE_URL и BOT_EVENTS_SECRET в .env. Без них бот работает как раньше, просто без аналитики.
//
// События копятся и уходят пачками раз в 3 секунды. Если сайт недоступен — повторяем позже,
// в памяти держим не больше 2000 событий.

const SITE = (process.env.SITE_URL || '').replace(/\/$/, '');
const SECRET = process.env.BOT_EVENTS_SECRET || '';
const enabled = () => Boolean(SITE && SECRET);

let fetchImpl = (...a) => fetch(...a);
const queue = new Map(); // "platform:id" -> { platform, user, events: [] }
let size = 0;

function setFetch(f) {
  fetchImpl = f;
}

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
 * Записать событие.
 * user: { id, name, username, source } — source (метка ?start=) нужен только при первом входе.
 */
function track(platform, user, event, props = {}) {
  if (!enabled() || !user?.id) return;
  const key = `${platform}:${user.id}`;
  const item = queue.get(key) || { platform, user: {}, events: [] };
  item.user = { ...item.user, ...Object.fromEntries(Object.entries(user).filter(([, v]) => v != null && v !== '')), id: String(user.id) };
  if (size >= 2000) return;
  item.events.push({ event, props, at: new Date().toISOString() });
  size++;
  queue.set(key, item);
}

let flushing = false;
async function flush() {
  if (flushing || !queue.size) return;
  flushing = true;
  const batch = [...queue.values()];
  queue.clear();
  size = 0;
  for (const item of batch) {
    try {
      await post('/api/bot/events', item);
    } catch (e) {
      // Вернём в очередь — отправим в следующий раз
      const key = `${item.platform}:${item.user.id}`;
      const cur = queue.get(key);
      if (cur) cur.events.unshift(...item.events);
      else queue.set(key, item);
      size += item.events.length;
      console.error('Аналитика: сайт недоступен, повторим позже:', e.message);
    }
  }
  flushing = false;
}

let timer = null;
function start() {
  if (!enabled()) {
    console.log('Аналитика выключена: задайте SITE_URL и BOT_EVENTS_SECRET в .env');
    return;
  }
  if (!timer) timer = setInterval(flush, 3000);
  timer.unref?.();
}

/**
 * Заявка в CRM сайта. Возвращает { leadId } или null, если отправить не удалось
 * (тогда бот сам уведомит админов, как раньше).
 */
async function sendLead(platform, user, lead) {
  if (!enabled()) return null;
  await flush().catch(() => {}); // сначала события, чтобы у пользователя была метка источника
  try {
    return await post('/api/bot/leads', { platform, user: { ...user, id: String(user.id) }, ...lead });
  } catch (e) {
    console.error('Заявка не дошла до CRM:', e.message);
    return null;
  }
}

module.exports = { track, flush, start, sendLead, enabled, setFetch };
