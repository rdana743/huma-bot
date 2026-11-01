// Запросы к API MAX через модуль https с явным списком доверенных сертификатов.
// Встроенный fetch в Node 20 не видит добавленные сертификаты (certs/ca.pem),
// поэтому передаём библиотеке MAX свою реализацию fetch.
const https = require('node:https');
const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');

// Все сертификаты из папки certs/ (*.pem, *.crt): HARICA и Минцифры
function loadExtraCerts() {
  const dir = path.join(__dirname, '..', 'certs');
  const out = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /\.(pem|crt)$/i.test(f));
  } catch {
    return out;
  }
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    out.push(...(text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []));
  }
  return out;
}

const agent = new https.Agent({ keepAlive: true, ca: [...tls.rootCertificates, ...loadExtraCerts()] });

function toHeaderObject(h) {
  if (!h) return {};
  return Object.fromEntries(new Headers(h).entries());
}

function httpsFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const signal = init.signal;
    if (signal?.aborted) return reject(signal.reason || new Error('Aborted'));

    const req = https.request(url, { method: init.method || 'GET', headers: toHeaderObject(init.headers), agent }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
          else if (v !== undefined) headers.set(k, v);
        }
        const noBody = res.statusCode === 204 || res.statusCode === 304;
        resolve(new Response(noBody ? null : Buffer.concat(chunks), { status: res.statusCode, statusText: res.statusMessage, headers }));
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    if (signal) signal.addEventListener('abort', () => req.destroy(signal.reason || new Error('Aborted')), { once: true });
    if (init.body !== undefined && init.body !== null) req.write(typeof init.body === 'string' ? init.body : Buffer.from(init.body));
    req.end();
  });
}

module.exports = { httpsFetch };
