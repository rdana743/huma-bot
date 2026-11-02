// Простое хранение в JSON-файлах в папке data/.
// Для старта достаточно; при росте заменим на базу данных.
//
// В эти файлы пишут оба процесса (MAX и Telegram), поэтому данные не держим в памяти:
// каждое изменение перечитывает файл с диска под блокировкой и сразу записывает обратно.
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const LOCK_WAIT_MS = 2000; // дольше ждать нельзя — бот перестанет отвечать
const LOCK_STALE_MS = 10_000; // блокировка старше — процесс упал, не успев её снять

function load(name, fallback) {
  const file = path.join(DATA_DIR, name);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    // Битый файл не перезаписываем пустым: откладываем в сторону, чтобы данные можно было восстановить
    const aside = `${file}.corrupt-${Date.now()}`;
    fs.renameSync(file, aside);
    console.error(`Файл ${name} повреждён (${e.message}), сохранён как ${path.basename(aside)}. Начинаем с пустого.`);
    return fallback;
  }
}

function save(name, data) {
  const file = path.join(DATA_DIR, name);
  // У каждого процесса свой временный файл, иначе два процесса пишут в один .tmp
  const tmp = `${file}.${process.pid}.tmp`;
  // Здесь имена и телефоны — читать может только владелец
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function withLock(name, fn) {
  const lock = path.join(DATA_DIR, name + '.lock');
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, 'wx'));
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.unlinkSync(lock);
      } catch {} // блокировку уже сняли — попробуем снова
      if (Date.now() > deadline) throw new Error(`Не дождались блокировки ${name}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

// Прочитать свежие данные, изменить и записать — целиком под блокировкой
function update(name, fallback, change) {
  return withLock(name, () => {
    const data = load(name, fallback);
    const result = change(data);
    save(name, data);
    return result;
  });
}

module.exports = {
  // Запоминаем пользователя и метку, по которой он пришёл (первую)
  touchUser(user, source) {
    if (!user) return;
    const id = String(user.user_id);
    const now = new Date().toISOString();
    update('users.json', {}, (users) => {
      if (!users[id]) {
        users[id] = { id: user.user_id, name: user.name || user.first_name || '', source: source || 'direct', firstSeen: now };
      }
      users[id].lastSeen = now;
    });
  },

  getUser(id) {
    return load('users.json', {})[String(id)];
  },

  addLead(lead) {
    const record = { ...lead, createdAt: new Date().toISOString() };
    update('leads.json', [], (leads) => leads.push(record));
    return record;
  },

  stats() {
    const users = load('users.json', {});
    const leads = load('leads.json', []);
    const bySource = {};
    for (const u of Object.values(users)) bySource[u.source] = (bySource[u.source] || 0) + 1;
    const leadsBySource = {};
    for (const l of leads) leadsBySource[l.source] = (leadsBySource[l.source] || 0) + 1;
    return { users: Object.keys(users).length, leads: leads.length, bySource, leadsBySource };
  },
};
