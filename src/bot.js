const { Bot, Keyboard } = require('@maxhub/max-bot-api');
const catalog = require('./catalog');
const storage = require('./storage');
const appConfig = require('../miniapp/config');
const analytics = require('./analytics');

// Название продукта по id: из каталога бота или мини-приложения
function productTitle(id) {
  const bot = catalog.products.find((p) => p.id === id);
  if (bot) return bot.title;
  const raw = String(id).replace(/^tariff_/, '');
  const tariff = appConfig.tariffs.find((t) => t.id === raw);
  if (tariff) return `Тариф ${tariff.name}`;
  for (const sec of appConfig.shop) {
    const it = sec.items.find((x) => x.id === id);
    if (it) return `${sec.title}: ${it.name}`;
  }
  return id === 'contact' ? 'Связаться с менеджером' : id;
}

const { button } = Keyboard;
const ADMIN_IDS = String(process.env.ADMIN_USER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Состояние диалога (на каком шаге человек): userId -> { step, data }
const states = new Map();

function createBot(token, options) {
  const bot = new Bot(token, options);

  // ---------- helpers ----------

  const userOf = (ctx) => ctx.user || ctx.message?.sender;
  const userId = (ctx) => userOf(ctx)?.user_id;
  // Пользователь для аналитики сайта
  const who = (ctx, source) => {
    const u = userOf(ctx);
    return u ? { id: u.user_id, name: u.name || [u.first_name, u.last_name].filter(Boolean).join(' '), username: u.username, source } : null;
  };
  const track = (ctx, event, props, source) => analytics.track('max', who(ctx, source), event, props);

  // Показать экран: при нажатии кнопки — заменяем сообщение, иначе — шлём новое
  async function show(ctx, text, rows) {
    const body = { text, format: 'markdown', attachments: rows ? [Keyboard.inlineKeyboard(rows)] : [] };
    if (ctx.updateType === 'message_callback') {
      return ctx.answerOnCallback({ message: body });
    }
    return ctx.reply(text, { format: 'markdown', attachments: body.attachments });
  }

  const backRow = [button.callback('← В меню', 'menu')];

  async function notifyAdmins(text) {
    for (const id of ADMIN_IDS) {
      try {
        await bot.api.sendMessageToUser(Number(id), text, { format: 'markdown' });
      } catch (e) {
        console.error('Не удалось уведомить админа', id, e.message);
      }
    }
  }

  function mainMenu(ctx, text = catalog.welcome) {
    states.delete(userId(ctx));
    return show(ctx, text, [
      [button.callback('🧮 Сколько клиника теряет на звонках', 'calc')],
      [button.callback('📦 Гайды и услуги', 'products')],
      [button.callback('💬 Связаться с нами', 'lead:contact')],
      ...(catalog.channelUrl ? [[button.link('📢 Канал Huma Marketing', catalog.channelUrl)]] : []),
    ]);
  }

  // Приветствие с кнопкой мини-приложения.
  // MINI_APP — что передать в кнопку open_app (по умолчанию имя бота: открывается
  // мини-приложение, привязанное к боту в кабинете MAX для партнёров).
  function greeting(ctx) {
    const u = userOf(ctx);
    const name = u?.first_name || u?.name || 'друг';
    const webApp = process.env.MINI_APP || ctx.botInfo?.username;
    states.delete(userId(ctx));
    return show(ctx, catalog.greeting.replace('{name}', name), [[button.openApp(catalog.appButton, webApp)]]);
  }

  // ---------- старт и меню ----------

  // Метка в ссылке max.ru/<бот>?start=tg_post1 попадает сюда — по ней видно, откуда пришёл человек
  bot.on('bot_started', (ctx) => {
    const payload = ctx.startPayload || '';
    const source = payload.startsWith('buy_') ? 'miniapp' : payload;
    storage.touchUser(ctx.user, source);
    track(ctx, 'start', { source: source || null }, source);
    // Пришли из мини-приложения по кнопке «Оформить»: сразу собираем заявку
    if (payload.startsWith('buy_')) return startLead(ctx, payload.slice(4));
    return greeting(ctx);
  });

  bot.command('start', (ctx) => {
    storage.touchUser(userOf(ctx));
    return greeting(ctx);
  });

  // Старое меню (калькулятор, каталог, заявки) — по команде /menu
  bot.command('menu', (ctx) => {
    track(ctx, 'menu');
    return mainMenu(ctx);
  });

  bot.command('id', (ctx) => ctx.reply(`Ваш ID в MAX: ${userId(ctx)}`));
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
    if (!ADMIN_IDS.includes(String(userId(ctx)))) return;
    const s = storage.stats();
    const fmt = (o) => Object.entries(o).map(([k, v]) => `• ${k}: ${v}`).join('\n') || '—';
    return ctx.reply(
      `**Статистика**\nПользователей: ${s.users}\nЗаявок: ${s.leads}\n\n` +
        `**Пользователи по источникам**\n${fmt(s.bySource)}\n\n**Заявки по источникам**\n${fmt(s.leadsBySource)}`,
      { format: 'markdown' },
    );
  });

  bot.action('menu', (ctx) => mainMenu(ctx));

  // ---------- каталог ----------

  bot.action('products', (ctx) =>
    show(ctx, '**Гайды и услуги**\n\nВыберите, что интересно:', [
      ...catalog.products.map((p) => [button.callback(`${p.title} · ${p.price}`, `product:${p.id}`)]),
      backRow,
    ]),
  );

  bot.action(/^product:(.+)$/, (ctx) => {
    const p = catalog.products.find((x) => x.id === ctx.match[1]);
    if (!p) return mainMenu(ctx);
    const rows = [];
    if (p.payUrl) rows.push([button.link(`💳 Оплатить ${p.price}`, p.payUrl)]);
    rows.push([button.callback(p.payUrl ? '❓ Задать вопрос' : '✍️ Оставить заявку', `lead:${p.id}`)]);
    rows.push([button.callback('← Ко всем продуктам', 'products')]);
    return show(ctx, `**${p.title}**\n${p.price}\n\n${p.description}`, rows);
  });

  // ---------- заявка ----------

  async function startLead(ctx, topic) {
    states.set(userId(ctx), { step: 'lead', data: { topic } });
    const title = productTitle(topic);
    return ctx.reply(
      (topic === 'contact' ? '' : `Вы выбрали **${title}**.\n\n`) + '**Оставьте номер телефона**' +
        ' — менеджер свяжется с вами и пришлёт ссылку на оплату или ответит на вопросы.',
      { format: 'markdown', attachments: [Keyboard.inlineKeyboard([[button.requestContact('📱 Отправить мой номер')]])] },
    );
  }

  bot.action(/^lead:(.+)$/, async (ctx) => {
    const topic = ctx.match[1];
    // Если человек только что прошёл калькулятор — прикладываем его цифры к заявке
    const prev = states.get(userId(ctx));
    states.set(userId(ctx), { step: 'lead', data: { topic, calc: prev?.data?.calc?.lost !== undefined ? prev.data.calc : undefined } });
    await ctx.answerOnCallback({ notification: 'Оставьте контакт' });
    return ctx.reply(
      'Отправьте номер телефона кнопкой ниже или напишите его сообщением. ' +
        'Можно добавить комментарий: название клиники, город, что хотите обсудить.',
      { attachments: [Keyboard.inlineKeyboard([[button.requestContact('📱 Отправить мой номер')], backRow])] },
    );
  });

  async function finishLead(ctx, contact) {
    const user = userOf(ctx);
    const state = states.get(user.user_id);
    const known = storage.getUser(user.user_id);
    const topic = state?.data?.topic || 'contact';

    const lead = storage.addLead({
      userId: user.user_id,
      name: user.name || contact.fullName || '',
      phone: contact.tel || '',
      comment: contact.comment || '',
      topic,
      calc: state?.data?.calc,
      source: known?.source || 'direct',
    });
    states.delete(user.user_id);

    // Заявка уходит в CRM сайта; если сайт недоступен — уведомляем админов сами, как раньше
    const crm = await analytics.sendLead('max', who(ctx), {
      phone: lead.phone, topic, topicTitle: productTitle(topic), comment: lead.comment, calc: lead.calc,
    });
    if (!crm) await notifyAdmins(
      `🔥 **Новая заявка**\n` +
        `Тема: ${productTitle(topic)}\n` +
        `Имя: ${lead.name || '—'}\nТелефон: ${lead.phone || '—'}\n` +
        (lead.comment ? `Комментарий: ${lead.comment}\n` : '') +
        (lead.calc ? `Калькулятор: ${lead.calc.calls} звонков, ${lead.calc.booked} записей, потери ≈ ${rub(lead.calc.lost)}/мес\n` : '') +
        `Источник: ${lead.source}\nID в MAX: ${lead.userId}`,
    );
    return mainMenu(ctx, '✅ **Спасибо! Заявка принята.**\nСвяжемся с вами в ближайшее время.');
  }

  // ---------- калькулятор потерь ----------

  const calcSteps = {
    calls: 'Шаг 1 из 3. **Сколько звонков в месяц приходит с рекламы?**\nНапишите число, например 200.',
    booked: 'Шаг 2 из 3. **Сколько из них записываются на приём?**\nНапишите число, например 90.',
    check: 'Шаг 3 из 3. **Средний чек пациента, ₽?**\nНапишите число, например 25000.',
  };

  bot.action('calc', (ctx) => {
    states.set(userId(ctx), { step: 'calc:calls', data: { calc: {} } });
    return show(ctx, '**Считаем, сколько клиника теряет на телефоне**\n\n' + calcSteps.calls, [backRow]);
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
    return ctx.reply(text, {
      format: 'markdown',
      attachments: [
        Keyboard.inlineKeyboard([
          [button.callback('🎧 Бесплатный разбор звонков', 'lead:audit_calls')],
          [button.callback('📘 Гайд со скриптами', 'product:guide_calls')],
          backRow,
        ]),
      ],
    });
  }

  // ---------- входящие сообщения (ответы на шаги) ----------

  bot.on('message_created', async (ctx, next) => {
    const user = userOf(ctx);
    if (!user) return next();
    const state = states.get(user.user_id);
    const text = (ctx.message.body?.text || '').trim();

    if (state?.step === 'lead') {
      const contact = readContact(ctx);
      if (contact?.tel) return finishLead(ctx, contact);
      if (/\d[\d\s()+-]{8,}\d/.test(text)) return finishLead(ctx, { tel: text.match(/\+?\d[\d\s()+-]{8,}\d/)[0], comment: text });
      return ctx.reply('Не вижу номера телефона. Нажмите «Отправить мой номер» или напишите его, например +7 900 123-45-67.');
    }

    if (state?.step?.startsWith('calc:')) {
      const field = state.step.slice(5);
      const value = Number(text.replace(/[^\d]/g, ''));
      if (!value) return ctx.reply('Напишите, пожалуйста, просто число.');
      if (field === 'booked' && value > state.data.calc.calls) {
        return ctx.reply('Записей не может быть больше, чем звонков. Попробуйте ещё раз.');
      }
      state.data.calc[field] = value;
      const order = ['calls', 'booked', 'check'];
      const nextField = order[order.indexOf(field) + 1];
      if (nextField) {
        state.step = `calc:${nextField}`;
        return ctx.reply(calcSteps[nextField], { format: 'markdown' });
      }
      // Калькулятор пройден: оставляем данные, чтобы приложить их к заявке
      states.set(user.user_id, { step: 'calc:done', data: state.data });
      return calcResult(ctx, state.data.calc);
    }

    if (text.startsWith('/')) return next();
    return greeting(ctx);
  });

  bot.catch((err, ctx) => {
    console.error('Ошибка при обработке', ctx?.updateType, err);
  });

  return bot;
}

// Номер из кнопки «Отправить мой номер». Разбор SDK иногда падает на нестандартной vCard —
// тогда достаём номер из текста карточки сами.
function readContact(ctx) {
  try {
    const info = ctx.contactInfo;
    if (info?.tel) return info;
  } catch {}
  const att = (ctx.message?.body?.attachments || []).find((a) => a.type === 'contact');
  if (!att) return undefined;
  const vcf = att.payload?.vcf_info || '';
  const tel = vcf.match(/TEL[^:]*:([+\d\s()-]+)/i)?.[1]?.trim();
  const fullName = vcf.match(/FN[^:]*:(.+)/i)?.[1]?.trim() || att.payload?.max_info?.name;
  return { tel, fullName };
}

function rub(n) {
  return Math.round(n).toLocaleString('ru-RU') + ' ₽';
}

// Ошибка MAX в понятном виде. Нет status — значит не дошли до MAX (сеть, прокси): такое стоит повторить
function wrapMaxError(e) {
  const err = new Error(e.description || e.message);
  if (e.status === 403 || /block|denied|forbidden/i.test(String(e.code || e.message))) err.blocked = true;
  if (e.status === 429) err.retryAfter = 5;
  if (!e.status) err.network = true;
  return err;
}

// Отправка одного сообщения рассылки (для src/broadcast.js)
function maxSender(bot) {
  return async (userId, m) => {
    const webApp = process.env.MINI_APP || bot.botInfo?.username;
    const rows =
      m.buttonType === 'app' ? [[button.openApp(m.buttonText, webApp)]]
      : m.buttonType === 'link' ? [[button.link(m.buttonText, m.buttonUrl)]]
      : null;
    try {
      await bot.api.sendMessageToUser(Number(userId), m.text, { format: 'markdown', attachments: rows ? [Keyboard.inlineKeyboard(rows)] : [] });
    } catch (e) {
      throw wrapMaxError(e);
    }
  };
}

// Выдача после оплаты (для src/deliveries.js).
// MAX_CLUB_LINK — ссылка-приглашение в канал клуба; MAX_CLUB_CHAT_ID — ID канала, чтобы убирать по окончании
function maxHandlers(bot) {
  const send = maxSender(bot);
  return {
    text: send,
    file: (userId, p) =>
      send(userId, { text: `📥 **${p.title}**\n\nСсылка личная, не передавайте её другим.`, buttonType: 'link', buttonText: 'Скачать', buttonUrl: p.url }),
    async clubInvite(userId) {
      const link = process.env.MAX_CLUB_LINK;
      if (!link) throw new Error('MAX_CLUB_LINK не задан в .env бота');
      await send(userId, { text: '🔑 **Ваше приглашение в HUMA Club.**\n\nВступайте по кнопке ниже.', buttonType: 'link', buttonText: 'Вступить в клуб', buttonUrl: link });
    },
    async clubRemove(userId) {
      const chat = process.env.MAX_CLUB_CHAT_ID;
      if (!chat) throw new Error('MAX_CLUB_CHAT_ID не задан в .env бота');
      try {
        await bot.api.removeChatMember(Number(chat), Number(userId));
      } catch (e) {
        if (e.status === 404) return; // уже не в канале
        throw wrapMaxError(e);
      }
    },
  };
}

module.exports = { createBot, maxSender, maxHandlers, states };
