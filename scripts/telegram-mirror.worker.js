// Зеркало Telegram Bot API на Cloudflare Workers (бесплатно).
// Пропускает запросы только вашего бота: в BOT_ID — число до двоеточия в токене.
const BOT_ID = '9260916937';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`/bot${BOT_ID}:`) && !url.pathname.startsWith(`/file/bot${BOT_ID}:`)) {
      return new Response('Not found', { status: 404 });
    }
    url.hostname = 'api.telegram.org';
    url.port = '';
    url.protocol = 'https:';
    return fetch(new Request(url, request));
  },
};
