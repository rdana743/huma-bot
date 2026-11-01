# Деплой ботов на сервер

Боты живут в `/var/www/huma-bot` — отдельно от сайта (`deploy.sh` сайта сбрасывает `/var/www/huma`).
Запускаются через PM2, как сайт.

## Первый раз

С Mac (боты на Mac перед этим остановить — два запущенных бота мешают друг другу):

```bash
rsync -av --exclude node_modules --exclude '.trash-*' ~/Documents/GitHub/chatbot/ root@IP_СЕРВЕРА:/var/www/huma-bot/
```

На сервере:

```bash
cd /var/www/huma-bot
node -v                      # нужно 20.6 или новее
npm install --omit=dev
npm test
pm2 start ecosystem.config.js && pm2 save
pm2 logs --lines 20          # «Бот @… запущен» и «Telegram-бот @… запущен»
```

## Обновление

С Mac (данные и .env на сервере не трогаются):

```bash
rsync -av --exclude node_modules --exclude data --exclude .env --exclude '.trash-*' ~/Documents/GitHub/chatbot/ root@IP_СЕРВЕРА:/var/www/huma-bot/
ssh root@IP_СЕРВЕРА "cd /var/www/huma-bot && npm install --omit=dev && pm2 restart huma-max-bot huma-tg-bot"
```

## Полезное

- `pm2 logs huma-max-bot` / `pm2 logs huma-tg-bot` — логи
- `pm2 restart huma-max-bot huma-tg-bot` — перезапуск после правки `.env`
- `pm2 stop huma-max-bot huma-tg-bot` — остановить

## Рассылки

Боты сами забирают рассылки из админки (huma.marketing/admin/bot/broadcasts) раз в 5 секунд.
Нужны `SITE_URL` и `BOT_EVENTS_SECRET` в `.env` — те же, что для аналитики. Отписка — команда `/stop`, вернуть — `/subscribe`.

## Telegram на сервере в России

С российского сервера `api.telegram.org` часто недоступен: бот MAX работает, а Telegram-бот молчит.
Проверка на сервере: `curl -m 10 -sS -o /dev/null -w "%{http_code}\n" https://api.telegram.org` — `000` и timeout значит «заблокировано».

Решение — одна строка в `/var/www/huma-bot/.env`, затем `pm2 restart huma-tg-bot`.

**Вариант А. Прокси за рубежом** (есть у многих VPN-сервисов или на зарубежном VPS):
```
TG_PROXY=socks5://логин:пароль@host:1080
```
(или `http://логин:пароль@host:3128`)

**Вариант Б. Зеркало на Cloudflare Workers** (бесплатно):
1. dash.cloudflare.com → Workers & Pages → Create → Worker → Deploy
2. Edit code → вставить `scripts/telegram-mirror.worker.js` → Deploy
3. Скопировать адрес вида `https://имя.ваш-аккаунт.workers.dev`
4. Проверить с сервера: `curl -m 10 -sS https://имя.ваш-аккаунт.workers.dev/bot123:x/getMe` — должен прийти ответ от Telegram (ошибка 401 — нормально)
5. В `.env`: `TG_API_ROOT=https://имя.ваш-аккаунт.workers.dev`

После перезапуска в `pm2 logs huma-tg-bot` должно быть «Подключение к Telegram: …» и «Telegram-бот @… запущен».
