// Связь бота с мессенджером: раз в минуту лёгкий запрос (getMe / getMyInfo).
// Состояние уходит на сайт вместе с заходом за очередью выдачи — если связи нет дольше 10 минут, сайт пишет тревогу в чат команды.

function createHealth(check, { intervalMs = 60_000, timeoutMs = 20_000 } = {}) {
  const state = { ok: true, since: null, error: null };
  let timer = null;

  async function probe() {
    try {
      await Promise.race([check(), new Promise((_, rej) => setTimeout(() => rej(new Error(`нет ответа ${timeoutMs / 1000} с`)), timeoutMs))]);
      if (!state.ok) console.log('Связь с мессенджером восстановлена');
      state.ok = true;
      state.since = null;
      state.error = null;
    } catch (e) {
      if (state.ok) {
        state.since = new Date().toISOString();
        console.error('Нет связи с мессенджером:', e.message);
      }
      state.ok = false;
      state.error = String(e.message || e).slice(0, 200);
    }
  }

  return {
    get: () => ({ ...state }),
    probe,
    start() {
      if (timer) return;
      probe();
      timer = setInterval(probe, intervalMs);
    },
  };
}

module.exports = { createHealth };
