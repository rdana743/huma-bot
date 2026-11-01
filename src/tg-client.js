// Подключение к Telegram Bot API через прокси или зеркало — для серверов, откуда api.telegram.org недоступен.
//
// TG_PROXY=socks5://логин:пароль@host:1080   или   http://логин:пароль@host:3128
// TG_API_ROOT=https://ваше-зеркало.workers.dev   (адрес вместо https://api.telegram.org)
// Можно задать одно из двух или оба. Пусто — прямое подключение.
// TG_IP_FAMILY=6 (или 4) — подключаться только по IPv6/IPv4. Нужно, если на одном из них соединение режется
// (бывает с Cloudflare из России: curl работает, а Node висит на TLS).

function tgClientOptions(env = process.env) {
  const client = {};
  if (env.TG_API_ROOT) client.apiRoot = env.TG_API_ROOT.trim().replace(/\/$/, '');
  if (env.TG_PROXY) {
    const url = env.TG_PROXY.trim();
    const agent = /^socks/i.test(url)
      ? new (require('socks-proxy-agent').SocksProxyAgent)(url)
      : new (require('https-proxy-agent').HttpsProxyAgent)(url);
    client.baseFetchConfig = { agent, compress: true };
  } else if (env.TG_IP_FAMILY === '4' || env.TG_IP_FAMILY === '6') {
    const agent = new (require('node:https').Agent)({ keepAlive: true, family: Number(env.TG_IP_FAMILY) });
    client.baseFetchConfig = { agent, compress: true };
  }
  return client;
}

// Для логов: куда подключаемся, без логина и пароля
function describe(env = process.env) {
  const parts = [];
  if (env.TG_API_ROOT) parts.push(`зеркало ${new URL(env.TG_API_ROOT).host}`);
  if (env.TG_IP_FAMILY && !env.TG_PROXY) parts.push(`только IPv${env.TG_IP_FAMILY}`);
  if (env.TG_PROXY) {
    const u = new URL(env.TG_PROXY);
    parts.push(`прокси ${u.protocol}//${u.hostname}:${u.port}`);
  }
  return parts.length ? parts.join(', ') : 'напрямую';
}

module.exports = { tgClientOptions, describe };
