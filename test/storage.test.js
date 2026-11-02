// Хранилище, в которое пишут два процесса (MAX и Telegram) — без сети
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'huma-st-'));
process.env.DATA_DIR = dir;

// Два независимых экземпляра модуля — как два процесса pm2 с общей папкой data/
const fresh = () => {
  delete require.cache[require.resolve('../src/storage')];
  return require('../src/storage');
};
const max = fresh();
const tg = fresh();

max.touchUser({ user_id: 1, name: 'Анна' }, 'max:ads');
tg.touchUser({ user_id: 2, first_name: 'Борис' }, 'tg:direct');
tg.addLead({ source: 'tg:direct', phone: '+79990000000' });
max.touchUser({ user_id: 1, name: 'Анна' }); // повторный визит — раньше стирал данные второго процесса
max.addLead({ source: 'max:ads', phone: '+79991111111' });

for (const s of [max, tg]) {
  const st = s.stats();
  assert.equal(st.users, 2, 'оба процесса видят обоих пользователей');
  assert.equal(st.leads, 2, 'обе заявки сохранились');
  assert.deepEqual(st.leadsBySource, { 'tg:direct': 1, 'max:ads': 1 });
}
assert.equal(tg.getUser(1).source, 'max:ads', 'пользователь другого процесса виден сразу');
assert.equal(max.getUser(1).source, 'max:ads', 'первая метка не перезаписывается');
console.log('✓ два процесса не стирают пользователей и заявки друг друга');

assert.equal(fs.statSync(path.join(dir, 'leads.json')).mode & 0o777, 0o600);
assert.deepEqual(fs.readdirSync(dir).filter((f) => /\.(tmp|lock)$/.test(f)), [], 'после записи не остаётся .tmp и .lock');
console.log('✓ файлы с телефонами доступны только владельцу, временных файлов нет');

// Зависшая блокировка от упавшего процесса не мешает записи
const lock = path.join(dir, 'leads.json.lock');
fs.writeFileSync(lock, '');
const old = (Date.now() - 60_000) / 1000;
fs.utimesSync(lock, old, old);
max.addLead({ source: 'max:ads' });
assert.equal(max.stats().leads, 3);
console.log('✓ старая блокировка упавшего процесса снимается');

// Битый файл не заменяется пустым молча — он откладывается в сторону
fs.writeFileSync(path.join(dir, 'users.json'), '{"1": {"id": 1');
const errors = [];
const origError = console.error;
console.error = (...a) => errors.push(a.join(' '));
tg.touchUser({ user_id: 3, first_name: 'Вера' }, 'tg:direct');
console.error = origError;
const aside = fs.readdirSync(dir).filter((f) => f.startsWith('users.json.corrupt-'));
assert.equal(aside.length, 1, 'битый файл сохранён рядом');
assert.equal(fs.readFileSync(path.join(dir, aside[0]), 'utf8'), '{"1": {"id": 1');
assert.match(errors[0], /повреждён/);
assert.equal(tg.stats().users, 1);
console.log('✓ битый файл откладывается, а не перезаписывается');

console.log('\nВсе проверки хранилища пройдены');
