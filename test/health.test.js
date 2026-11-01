// Связь с мессенджером: падение, неизменная дата начала сбоя, восстановление
const { createHealth } = require('../src/health');
(async () => {
  let fail = true;
  const h = createHealth(async () => { if (fail) throw new Error('fetch failed'); });
  await h.probe(); const a = h.get(); if (a.ok || !a.since) throw new Error('должен быть down');
  await h.probe(); if (h.get().since !== a.since) throw new Error('since не должен меняться');
  fail = false; await h.probe(); if (!h.get().ok) throw new Error('должен восстановиться');
  console.log('✓ health');
})();
