const { createBot, maxSender, maxHandlers } = require('./bot');

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('Нет BOT_TOKEN. Скопируйте .env.example в .env и вставьте токен.');
  process.exit(1);
}

const { httpsFetch } = require('./http');

// Подставляем настоящее имя бота в мини-приложение (кнопки «Оформить» ведут в бота)
function syncMiniAppUsername(username) {
  if (!username) return;
  const fs = require('node:fs');
  const file = require('node:path').join(__dirname, '..', 'miniapp', 'config.js');
  try {
    const src = fs.readFileSync(file, 'utf8');
    const next = src.replace(/botUsername: '[^']*'/, `botUsername: '${username}'`);
    if (next !== src) {
      fs.writeFileSync(file, next);
      console.log(`В мини-приложение записано имя бота: ${username}`);
    }
  } catch (e) {
    console.error('Не удалось обновить miniapp/config.js:', e.message);
  }
}

const bot = createBot(token, { clientOptions: { fetch: httpsFetch } });

bot.api
  .setMyCommands([
    { name: 'start', description: 'Открыть приложение' },
    { name: 'menu', description: 'Калькулятор и заявки' },
    { name: 'id', description: 'Узнать свой ID' },
    { name: 'stop', description: 'Отписаться от рассылок' },
  ])
  .catch((e) => console.error('setMyCommands:', e.message));

bot.api
  .getMyInfo()
  .then((me) => {
    console.log(`Бот @${me.username || me.name} запущен. Остановить: Ctrl+C`);
    syncMiniAppUsername(me.username);
  })
  .catch((e) => console.error('Не удалось подключиться к MAX:', e.message));

require('./analytics').start();
// Связь с MAX проверяем раз в минуту — если её нет дольше 10 минут, сайт пришлёт тревогу в чат команды
const health = require('./health').createHealth(() => bot.api.getMyInfo());
health.start();
// Рассылки из админки сайта: бот забирает очередь, когда уже знает своё имя (нужно для кнопки приложения)
bot.api.getMyInfo().then((me) => {
  bot.botInfo = bot.botInfo || me;
  require('./broadcast').createBroadcaster('max', maxSender(bot)).start();
  require('./deliveries').createDeliverer('max', maxHandlers(bot), { health }).start();
}).catch(() => {
  require('./broadcast').createBroadcaster('max', maxSender(bot)).start();
  require('./deliveries').createDeliverer('max', maxHandlers(bot), { health }).start();
});
bot.start();
