// Бот Huma Marketing в Telegram — тот же сценарий, что и в MAX:
// приветствие с кнопкой мини-приложения, /menu с калькулятором и каталогом, заявки, /stats.
const { Bot, InlineKeyboard, Keyboard } = require('grammy');
const catalog = require('./catalog');
const storage = require('./storage');
const appConfig = require('../miniapp/config');
const analytics = require('./analytics');

const ADMIN_IDS = String(process.env.TG_ADMIN_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://rdana743.github.io/huma-miniapp/';

// Состояние диалога: tgUserId -> { step, data }
const states = new Map();

// Тексты каталога написаны с **жирным** (как для MAX) — переводим в HTML для Telegram
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
const rub = (n) => Math.round(n).toLocaleString('ru-RU') + ' ₽';

function productTitle(id) {
  const p = catalog.products.find((x) => x.id === id);
  if (p) return p.title;
  const raw = String(id).replace(/^tariff_/, '');
  const tariff = appConfig.tariffs.find((t) => t.id === raw);
  if (tariff) return `Тариф ${tariff.name}`;
  for (const sec of appConfig.shop) {
    const it = sec.items.find((x) => x.id === id);
    if (it) return `${sec.title}: ${it.name}`;
  }
  return id === 'contact' ? 'Связаться с менеджером' : id;
}

// В общем хранилище пользователи Telegram отличаются префиксом tg:
const storeUser = (from) => ({ user_id: 'tg:' + from.id, name: [from.first_name, from.last_name].filter(Boolean).join(' ') });

function createTgBot(token, options) {
  const bot = new Bot(token, options);
  const uid = (ctx) => ctx.from?.id;
  const who = (ctx, source) =>
    ctx.from ? { id: ctx.from.id, name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '), username: ctx.from.username, source } : null;
  const track = (ctx, event, props, source) => analytics.track('tg', who(ctx, source), event, props);

  // Показать экран: по нажатию кнопки — заменяем сообщение, иначе — шлём новое
  async function show(ctx, text, keyboard) {
    const extra = { parse_mode: 'HTML', reply_markup: keyboard };
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery().catch(() => {});
      try {
        return await ctx.editMessageText(html(text), extra);
      } catch {
        // сообщение нельзя изменить (например, старое) — отправим новое
      }
    }
    return ctx.reply(html(text), extra);
  }

  async function notifyAdmins(text) {
    for (const id of ADMIN_IDS) {
      try {
        await bot.api.sendMessage(id, html(text), { parse_mode: 'HTML' });
      } catch (e) {
        console.error('Не удалось уведомить админа в Telegram', id, e.message);
      }
    }
  }

  const back = () => new InlineKeyboard().text('← В меню', 'menu');

  function greeting(ctx) {
    states.delete(uid(ctx));
    const name = ctx.from?.first_name || 'друг';
    return show(ctx, catalog.greeting.replace('{name}', name), new InlineKeyboard().webApp(catalog.appButton, MINI_APP_URL));
  }

  function mainMenu(ctx, text = catalog.welcome) {
    states.delete(uid(ctx));
    const kb = new InlineKeyboard()
      .text('🧮 Сколько клиника теряет на звонках', 'calc').row()
      .text('📦 Гайды и услуги', 'products').row()
      .text('💬 Связаться с нами', 'lead:contact').row()
      .webApp(catalog.appButton, MINI_APP_URL);
    if (process.env.TG_CHANNEL_URL) kb.row().url('📢 Канал Huma Marketing', process.env.TG_CHANNEL_URL);
    return show(ctx, text, kb);
  }

  // ---------- старт ----------
  // Ссылка t.me/<бот>?start=post1 — метка источника; ?start=buy_<id> — заявка из мини-приложения
  bot.command('start', (ctx) => {
    const payload = ctx.match || '';
    const fromApp = payload.startsWith('buy_');
    storage.touchUser(storeUser(ctx.from), 'tg:' + (fromApp ? 'miniapp' : payload || 'direct'));
    // Сайту — всегда явный источник: метка, direct или unknown (из мини-приложения). Первую метку выбирает сайт
    const source = fromApp ? 'unknown' : payload || 'direct';
    track(ctx, 'start', { source }, source);
    if (fromApp) return startLead(ctx, payload.slice(4));
    return greeting(ctx);
  });
  bot.command('menu', (ctx) => {
    track(ctx, 'menu');
    return mainMenu(ctx);
  });
  bot.command('id', (ctx) => ctx.reply(`Ваш ID в Telegram: ${uid(ctx)}`));
  // Подписка на рассылки
  bot.command('stop', (ctx) => {
    track(ctx, 'unsubscribe');
    return ctx.reply('Вы отписались от рассылок HUMA. Вернуть их — команда /subscribe');
  });
  bot.command('subscribe', (ctx) => {
    track(ctx, 'subscribe');
    return ctx.reply('Готово, вы снова получаете рассылки HUMA. Отписаться — /stop');
  });
  bot.command('stats', (ctx) => {
    if (!ADMIN_IDS.includes(String(uid(ctx)))) return;
    const s = storage.stats();
    const fmt = (o) => Object.entries(o).map(([k, v]) => `• ${k}: ${v}`).join('\n') || '—';
    return ctx.reply(
      html(`**Статистика (MAX + Telegram)**\nПользователей: ${s.users}\nЗаявок: ${s.leads}\n\n` +
        `**Пользователи по источникам**\n${fmt(s.bySource)}\n\n**Заявки по источникам**\n${fmt(s.leadsBySource)}`),
      { parse_mode: 'HTML' },
    );
  });
  bot.callbackQuery('menu', (ctx) => mainMenu(ctx));

  // ---------- каталог ----------
  bot.callbackQuery('products', (ctx) => {
    const kb = new InlineKeyboard();
    catalog.products.forEach((p) => kb.text(`${p.title} · ${p.price}`, `product:${p.id}`).row());
    kb.text('← В меню', 'menu');
    return show(ctx, '**Гайды и услуги**\n\nВыберите, что интересно:', kb);
  });
  bot.callbackQuery(/^product:(.+)$/, (ctx) => {
    const p = catalog.products.find((x) => x.id === ctx.match[1]);
    if (!p) return mainMenu(ctx);
    const kb = new InlineKeyboard();
    if (p.payUrl) kb.url(`💳 Оплатить ${p.price}`, p.payUrl).row();
    kb.text(p.payUrl ? '❓ Задать вопрос' : '✍️ Оставить заявку', `lead:${p.id}`).row();
    kb.text('← Ко всем продуктам', 'products');
    return show(ctx, `**${p.title}**\n${p.price}\n\n${p.description}`, kb);
  });

  // ---------- заявка ----------
  const contactKeyboard = () => new Keyboard().requestContact('📱 Отправить мой номер').resized().oneTime();

  async function startLead(ctx, topic, calc) {
    states.set(uid(ctx), { step: 'lead', data: { topic, calc } });
    const title = productTitle(topic);
    return ctx.reply(
      html((topic === 'contact' ? '' : `Вы выбрали **${title}**.\n\n`) +
        '**Оставьте номер телефона** — кнопкой ниже или сообщением. Менеджер свяжется с вами и пришлёт ссылку на оплату или ответит на вопросы.'),
      { parse_mode: 'HTML', reply_markup: contactKeyboard() },
    );
  }

  bot.callbackQuery(/^lead:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Оставьте контакт' }).catch(() => {});
    const prev = states.get(uid(ctx));
    const calc = prev?.data?.calc?.lost !== undefined ? prev.data.calc : undefined;
    return startLead(ctx, ctx.match[1], calc);
  });

  async function finishLead(ctx, phone, comment) {
    const from = ctx.from;
    const su = storeUser(from);
    const state = states.get(from.id);
    const topic = state?.data?.topic || 'contact';
    const lead = storage.addLead({
      userId: su.user_id,
      name: su.name,
      phone,
      comment: comment || '',
      topic,
      calc: state?.data?.calc,
      source: storage.getUser(su.user_id)?.source || 'tg:direct',
    });
    states.delete(from.id);

    const crm = await analytics.sendLead('tg', who(ctx), {
      phone, topic, topicTitle: productTitle(topic), comment: lead.comment, calc: lead.calc,
    });
    if (!crm) await notifyAdmins(
      `🔥 **Новая заявка из Telegram**\nТема: ${productTitle(topic)}\n` +
        `Имя: ${lead.name || '—'}${from.username ? ` (@${from.username})` : ''}\nТелефон: ${lead.phone || '—'}\n` +
        (lead.comment ? `Комментарий: ${lead.comment}\n` : '') +
        (lead.calc ? `Калькулятор: ${lead.calc.calls} звонков, ${lead.calc.booked} записей, потери ≈ ${rub(lead.calc.lost)}/мес\n` : '') +
        `Источник: ${lead.source}\nID в Telegram: ${from.id}`,
    );
    await ctx.reply(html('✅ **Спасибо! Заявка принята.**\nСвяжемся с вами в ближайшее время.'), {
      parse_mode: 'HTML',
      reply_markup: { remove_keyboard: true },
    });
    return greeting(ctx);
  }

  // ---------- калькулятор ----------
  const calcSteps = {
    calls: 'Шаг 1 из 3. **Сколько звонков в месяц приходит с рекламы?**\nНапишите число, например 200.',
    booked: 'Шаг 2 из 3. **Сколько из них записываются на приём?**\nНапишите число, например 90.',
    check: 'Шаг 3 из 3. **Средний чек пациента, ₽?**\nНапишите число, например 25000.',
  };
  bot.callbackQuery('calc', (ctx) => {
    states.set(uid(ctx), { step: 'calc:calls', data: { calc: {} } });
    return show(ctx, '**Считаем, сколько клиника теряет на телефоне**\n\n' + calcSteps.calls, back());
  });

  function calcResult(ctx, calc) {
    const target = catalog.calc.targetConversion;
    const conv = calc.booked / calc.calls;
    const lostPatients = Math.max(0, Math.round(calc.calls * target - calc.booked));
    calc.lost = lostPatients * calc.check;
    track(ctx, 'calc_done', { lost: calc.lost, conv: Math.round(conv * 100) });
    let text = `**Результат**\n\nКонверсия звонка в запись: **${Math.round(conv * 100)}%**\n`;
    if (lostPatients === 0) {
      text += `\nЭто сильный показатель — выше ${Math.round(target * 100)}%. Главный резерв роста теперь в рекламе: стоимость и качество звонков.`;
    } else {
      text +=
        `Хорошие клиники доводят её до **${Math.round(target * 100)}%**.\n\n` +
        `Вы недополучаете примерно **${lostPatients} пациентов** и **${rub(calc.lost)} в месяц**.\n\n` +
        'Чаще всего причина в скриптах и скорости ответа администраторов. ' +
        'Бесплатно разберём 10 ваших звонков и покажем, где именно теряются пациенты.';
    }
    const kb = new InlineKeyboard()
      .text('🎧 Бесплатный разбор звонков', 'lead:audit_calls').row()
      .text('📘 Гайд со скриптами', 'product:guide_calls').row()
      .text('← В меню', 'menu');
    return ctx.reply(html(text), { parse_mode: 'HTML', reply_markup: kb });
  }

  // ---------- входящие сообщения ----------
  bot.on('message:contact', (ctx) => {
    const state = states.get(uid(ctx));
    if (state?.step !== 'lead') return greeting(ctx);
    return finishLead(ctx, ctx.message.contact.phone_number);
  });

  bot.on('message:text', async (ctx) => {
    const state = states.get(uid(ctx));
    const text = ctx.message.text.trim();

    if (state?.step === 'lead') {
      const m = text.match(/\+?\d[\d\s()+-]{8,}\d/);
      if (m) return finishLead(ctx, m[0], text);
      return ctx.reply('Не вижу номера телефона. Нажмите «Отправить мой номер» или напишите его, например +7 900 123-45-67.');
    }

    if (state?.step?.startsWith('calc:')) {
      const field = state.step.slice(5);
      const value = Number(text.replace(/[^\d]/g, ''));
      if (!value) return ctx.reply('Напишите, пожалуйста, просто число.');
      if (field === 'booked' && value > state.data.calc.calls) return ctx.reply('Записей не может быть больше, чем звонков. Попробуйте ещё раз.');
      state.data.calc[field] = value;
      const order = ['calls', 'booked', 'check'];
      const nextField = order[order.indexOf(field) + 1];
      if (nextField) {
        state.step = `calc:${nextField}`;
        return ctx.reply(html(calcSteps[nextField]), { parse_mode: 'HTML' });
      }
      states.set(uid(ctx), { step: 'calc:done', data: state.data });
      return calcResult(ctx, state.data.calc);
    }

    if (text.startsWith('/')) return;
    return greeting(ctx);
  });

  bot.catch((err) => console.error('Ошибка Telegram-бота:', err.error?.message || err.message));
  return bot;
}

// Отправка одного сообщения рассылки (для src/broadcast.js)
function tgSender(bot) {
  return async (chatId, m) => {
    const kb =
      m.buttonType === 'app' ? new InlineKeyboard().webApp(m.buttonText, MINI_APP_URL)
      : m.buttonType === 'link' ? new InlineKeyboard().url(m.buttonText, m.buttonUrl)
      : undefined;
    try {
      await bot.api.sendMessage(chatId, html(m.text), { parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } });
    } catch (e) {
      throw wrapTgError(e);
    }
  };
}

// Ошибка Telegram в понятном виде. Нет error_code — значит не дошли до Telegram (сеть, зеркало): такое стоит повторить
function wrapTgError(e) {
  const cause = e.error?.cause?.code || e.error?.code || e.error?.message;
  const err = new Error((e.description || e.message) + (cause && !e.error_code ? ` (${cause})` : ''));
  if (e.error_code === 403) err.blocked = true;
  if (e.error_code === 429) err.retryAfter = e.parameters?.retry_after || 5;
  if (!e.error_code) err.network = true;
  return err;
}

// Выдача после оплаты (для src/deliveries.js). Канал клуба — TG_CLUB_CHAT_ID (бот — администратор канала)
function tgHandlers(bot) {
  const send = tgSender(bot);
  const wrap = wrapTgError;
  const club = () => {
    const id = process.env.TG_CLUB_CHAT_ID;
    if (!id) throw new Error('TG_CLUB_CHAT_ID не задан в .env бота');
    return id;
  };
  return {
    text: send,
    async file(chatId, p) {
      try {
        await bot.api.sendDocument(chatId, p.url, { caption: `📥 ${p.title}` });
      } catch (e) {
        // Telegram не смог скачать файл по ссылке (большой или внешний диск) — отправим ссылку кнопкой
        if (e.error_code === 403) throw wrap(e);
        await send(chatId, { text: `📥 **${p.title}**\n\nСсылка личная, не передавайте её другим.`, buttonType: 'link', buttonText: 'Скачать', buttonUrl: p.url });
      }
    },
    async clubInvite(chatId, p) {
      try {
        const link = await bot.api.createChatInviteLink(club(), {
          name: `HUMA ${chatId}`.slice(0, 32),
          member_limit: 1,
          expire_date: Math.floor(Date.now() / 1000) + 7 * 86400,
        });
        await send(chatId, { text: '🔑 **Ваше приглашение в HUMA Club.**\n\nСсылка личная и действует 7 дней.', buttonType: 'link', buttonText: 'Вступить в клуб', buttonUrl: link.invite_link });
      } catch (e) {
        throw e.error_code ? wrap(e) : e;
      }
    },
    async clubRemove(chatId) {
      try {
        await bot.api.banChatMember(club(), chatId);
        await bot.api.unbanChatMember(club(), chatId, { only_if_banned: true });
      } catch (e) {
        // Человек уже вышел сам — считаем выполненным
        if (/not found|PARTICIPANT_ID_INVALID|user not found/i.test(e.description || '')) return;
        throw e.error_code ? wrap(e) : e;
      }
    },
  };
}

module.exports = { createTgBot, tgSender, tgHandlers, states };
