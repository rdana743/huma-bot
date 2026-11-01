// Простое хранение в JSON-файлах в папке data/.
// Для старта достаточно; при росте заменим на базу данных.
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

function load(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  } catch {
    return fallback;
  }
}

function save(name, data) {
  const file = path.join(DATA_DIR, name);
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(file + '.tmp', file);
}

const users = load('users.json', {});
const leads = load('leads.json', []);

module.exports = {
  // Запоминаем пользователя и метку, по которой он пришёл (первую)
  touchUser(user, source) {
    if (!user) return;
    const id = String(user.user_id);
    const now = new Date().toISOString();
    if (!users[id]) {
      users[id] = { id: user.user_id, name: user.name || user.first_name || '', source: source || 'direct', firstSeen: now };
    }
    users[id].lastSeen = now;
    save('users.json', users);
  },

  getUser(id) {
    return users[String(id)];
  },

  addLead(lead) {
    const record = { ...lead, createdAt: new Date().toISOString() };
    leads.push(record);
    save('leads.json', leads);
    return record;
  },

  stats() {
    const bySource = {};
    for (const u of Object.values(users)) bySource[u.source] = (bySource[u.source] || 0) + 1;
    const leadsBySource = {};
    for (const l of leads) leadsBySource[l.source] = (leadsBySource[l.source] || 0) + 1;
    return { users: Object.keys(users).length, leads: leads.length, bySource, leadsBySource };
  },
};
