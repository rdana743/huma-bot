// Запуск Telegram-бота: npm run start:tg
const fs = require('node:fs');
const path = require('node:path');
const { createTgBot, tgSender, tgHandlers } = require('./tg-bot');

const token = process.env.TG_BOT_TOKEN;
if (!token) {
  console.error('Нет TG_BOT_TOKEN. Создайте бота в @BotFather и впишите токен в .env');
  process.exit(1);
}

// Имя Telegram-бота записываем в мини-приложение: кнопки «Оформить» в Telegram ведут сюда
function syncMiniAppUsername(username) {
  const file = path.join(__dirname, '..', 'miniapp', 'config.js');
  try {
    const src = fs.readFileSync(file, 'utf8');
    const next = src.replace(/tgBotUsername: '[^']*'/, `tgBotUsername: '${username}'`);
    if (next !== src) {
      fs.writeFileSync(file, next);
      console.log(`В мини-приложение записано имя Telegram-бота: ${username}`);
    }
  } catch (e) {
    console.error('Не удалось обновить miniapp/config.js:', e.message);
  }
}

const { tgClientOptions, describe } = require('./tg-client');
console.log(`Подключение к Telegram: ${describe()}`);
const bot = createTgBot(token, { client: tgClientOptions() });

// Если Telegram недоступен, пишем это в лог сразу, а не молчим
bot.api.getMe().catch((e) =>
  console.error('Не удалось подключиться к Telegram:', e.message, '— проверьте TG_PROXY или TG_API_ROOT в .env (см. DEPLOY.md)'),
);

bot.api
  .setMyCommands([
    { command: 'start', description: 'Открыть приложение' },
    { command: 'menu', description: 'Калькулятор и заявки' },
    { command: 'id', description: 'Узнать свой ID' },
    { command: 'stop', description: 'Отписаться от рассылок' },
  ])
  .catch((e) => console.error('setMyCommands:', e.message));

// Кнопка «Приложение» слева от поля ввода — открывает мини-приложение в один тап
bot.api
  .setChatMenuButton({ menu_button: { type: 'web_app', text: 'Приложение', web_app: { url: process.env.MINI_APP_URL || 'https://rdana743.github.io/huma-miniapp/' } } })
  .catch((e) => console.error('setChatMenuButton:', e.message));

require('./analytics').start();
require('./broadcast').createBroadcaster('tg', tgSender(bot)).start();
// Связь с Telegram проверяем раз в минуту — если её нет дольше 10 минут, сайт пришлёт тревогу в чат команды
const health = require('./health').createHealth(() => bot.api.getMe());
health.start();
require('./deliveries').createDeliverer('tg', tgHandlers(bot), { health }).start();
bot.start({
  drop_pending_updates: true,
  onStart: (me) => {
    console.log(`Telegram-бот @${me.username} запущен. Остановить: Ctrl+C`);
    syncMiniAppUsername(me.username);
  },
});
