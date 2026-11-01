#!/bin/bash
# Добавляет корневые сертификаты, которых не хватает Node.js для подключения к MAX.
# Проверку TLS не отключает.
set -u
cd "$(dirname "$0")/.."
mkdir -p certs
KC=/System/Library/Keychains/SystemRootCertificates.keychain

echo "1) Корневые сертификаты HARICA из системного хранилища macOS:"
: > certs/ca.pem
for name in "HARICA TLS RSA Root CA 2021" "Hellenic Academic and Research Institutions RootCA 2015"; do
  security find-certificate -c "$name" -p "$KC" >> certs/ca.pem 2>/dev/null && echo "   + $name" || echo "   - нет: $name"
done

echo "2) Российские корневые сертификаты Минцифры:"
for f in russian_trusted_root_ca_pem.crt russian_trusted_sub_ca_pem.crt; do
  if [ -s "certs/$f" ] || curl -fsS -m 20 "https://gu-st.ru/content/lending/$f" -o "certs/$f"; then
    echo "   + $f"
  else
    echo "   ! не удалось скачать $f (вручную: https://www.gosuslugi.ru/crt)"
  fi
done
echo

echo "3) Проверяю подключение к MAX так же, как это делает бот:"
node -e '
const { httpsFetch } = require("./src/http");
const hosts = ["platform-api2.max.ru", "platform-api.max.ru"];
Promise.all(hosts.map((h) => httpsFetch("https://" + h + "/me")
  .then((r) => { console.log("   ✓", h, "— соединение доверенное"); return true; })
  .catch((e) => { console.log("   ✗", h, "—", e.code || e.message); return false; })))
.then((ok) => console.log(ok[0] ? "\nГотово. Запускайте: npm start" : "\nНе получилось. Пришлите весь вывод в чат."));'
