# Розгортання на Debian 13 без Docker

Команди нижче призначені для першого встановлення в окремому контейнері.
Підключення виконується як root. У прикладі каталог застосунку — `/opt/alarmmini`;
IP контейнера в командах копіювання заміни на свою LAN-адресу.

## 1. Перенесення файлів із Windows

Готовий архів: `server/dist/alarmmini-server.tar.gz`. Він містить вихідний код,
публічні файли панелі, таблицю регіонів, lockfile, тести, приклад `.env` і PM2-конфіг.
Секрети, runtime та node_modules до нього не входять.

Якщо архів треба зібрати після зміни коду, виконай у PowerShell з каталогу проєкту:

```powershell
New-Item -ItemType Directory -Force server/dist | Out-Null
tar -czf server/dist/alarmmini-server.tar.gz -C server package.json package-lock.json .env.example ecosystem.config.cjs README.md DEPLOY.md src data public test
scp server/dist/alarmmini-server.tar.gz root@LAN_ADDRESS:/root/
ssh root@LAN_ADDRESS
```

## 2. Node.js 22 та PM2 на сервері

Debian 13 у стандартному репозиторії має Node.js 20; цьому проєкту потрібна
версія **22.16+**. Наступні команди додають репозиторій NodeSource для Node.js 22.
Після кожного кроку переконайся, що команда завершилася успішно.

```bash
apt update
apt install -y ca-certificates curl nano
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/alarmmini-nodesource-setup.sh
bash /tmp/alarmmini-nodesource-setup.sh
apt install -y nodejs
node -v
npm -v
npm install -g pm2
```

Очікувана версія Node.js — `v22.16.0` або новіша у гілці 22.
NodeSource включає npm у пакет nodejs.
Джерела: [пакет Debian](https://packages.debian.org/trixie/nodejs),
[NodeSource](https://github.com/nodesource/distributions).

## 3. Розпакування і налаштування

```bash
mkdir -p /opt/alarmmini
tar -xzf /root/alarmmini-server.tar.gz -C /opt/alarmmini
cd /opt/alarmmini
npm ci --omit=dev
if [ ! -e .env ]; then
  install -m 600 .env.example .env
fi
nano .env
```

Заповни принаймні такі поля, зберігаючи решту прикладу:

```dotenv
UKRAINEALARM_API_TOKEN=YOUR_API_TOKEN
HOST=0.0.0.0
PORT=3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD="YOUR_ADMIN_PASSWORD"
PUBLIC_STATUS_TOKEN=YOUR_STATUS_TOKEN
WEBHOOK_TOKEN=YOUR_DIFFERENT_WEBHOOK_TOKEN
PUBLIC_BASE_URL=https://alarm.example.com
MQTT_URL=mqtt://YOUR_BROKER:1883
MQTT_USERNAME="YOUR_MQTT_LOGIN"
MQTT_PASSWORD="YOUR_MQTT_PASSWORD"
```

Для PUBLIC_BASE_URL вкажи свій домен Cloudflare Tunnel. Для MQTT_URL — адресу
чинного брокера; localhost підходить лише якщо брокер працює в цьому контейнері.
Якщо брокер не вимагає облікових даних, залиш MQTT_USERNAME і MQTT_PASSWORD порожніми.
Можна тимчасово вимкнути MQTT через `MQTT_URL=` і перевірити вебпанель та HTTP.
Сервіс сам брокер не встановлює.

Для кожного з двох публічних токенів окремо виконай команду й перенеси результат
у відповідне поле `.env`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

У nano: Ctrl+O, Enter — зберегти; Ctrl+X — вийти. Пароль панелі задається
окремо від пароля root та ключа UkraineAlarm. Значення з `#` або пробілами
записуй у лапках, як у прикладі.

## 4. Запуск та автозапуск PM2

Перед першим запуском з MQTT у чинні топіки зупини старий Node-RED flow,
щоб два джерела не надсилали суперечливі стани.

```bash
cd /opt/alarmmini
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs alarmmini --lines 30 --nostream
```

У PM2 має бути один процес alarmmini зі статусом online. У журналі очікуй
`AlarmMini HTTP listening on 0.0.0.0:3000` та `Map updated [...]` після успішного
запиту UkraineAlarm. Статус PM2 online підтверджує роботу процесу;
свіжість даних і MQTT перевіряються окремо в панелі або через health:

```bash
curl -i http://127.0.0.1:3000/health
```

HTTP 200 означає свіжі дані й підключений або вимкнений MQTT. HTTP 503 —
очікування першого знімка, застарілі дані або відсутність підключення MQTT.

Після успішного запуску додай автозапуск сервера:

```bash
pm2 startup systemd -u root --hp /root
pm2 save
```

Ці команди налаштовують автозапуск процесу всередині Debian. Для запуску самого
LXC після перезавантаження Proxmox увімкни Start at boot у параметрах контейнера.
Джерело: [автозапуск PM2](https://pm2.keymetrics.io/docs/usage/startup/).

Конфігурація запускає один процес у fork-режимі та читає `.env` через Node.js.
При зміні `.env` достатньо `pm2 restart alarmmini`. Не запускай одночасно ще
один екземпляр через `npm start` або PM2 cluster: це дублюватиме запити й MQTT.

## 5. Журнали та монітор

У версії 1.1.0 поточні події видно відразу в локальній панелі: блок
«Події та діагностика» оновлюється кожні 5 секунд, містить фільтр і паузу журналу.
Окремо показано час оновлення API, зміни станів карти, MQTT і доставки webhook.
Журнал тримає останні 200 записів у пам’яті від запуску; історія до перезапуску
залишається у файлах PM2. Успішна реєстрація webhook ще не означає, що запити
доходять: «Доставку підтверджено» з’явиться лише після перевіреного підпису.

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 3
pm2 set pm2-logrotate:compress true
pm2 save
pm2 monit
```

Ctrl+C закриває монітор, процес сервера продовжує працювати. Ротація обмежує
розмір окремих журналів; 10M перевіряється періодично й не є суворим загальним
лімітом диска. Джерело: [pm2-logrotate](https://github.com/keymetrics/pm2-logrotate).

## 6. Панель, тунель, webhook і карта

Відкрий `http://LAN_ADDRESS:3000/admin` і ввійди з ADMIN_USERNAME / ADMIN_PASSWORD.
Збережи HTTPS-домен без шляху. У Cloudflare Tunnel:

- Path: `^/public/.*$`.
- Service URL: `http://LAN_ADDRESS:3000`.

У панелі натисни «Оновити» для вже наявної підписки UkraineAlarm або
«Зареєструвати» для нової. Результат має підтвердити успішну відповідь API.
Починаючи з 1.2.0, перед цим автоматично перевіряються публічна адреса й ключ;
перевірку адреси можна окремо запустити кнопкою «Перевірити адресу».
Якщо Cloudflare блокує файл ключа, завантаж офіційний `.pem` у браузері за
посиланням у панелі та імпортуй його кнопкою «Зберегти ключ із файлу».
Жодне оновлення сервера не вимикає перевірку підпису реальних подій.
Це не перевірка фактичної доставки: повний шлях webhook перевіряється під час
реальної підписаної події від UkraineAlarm.

Кнопка «Копіювати з токеном» біля статусу дає посилання для перевірки у браузері.
Відповідь — масив 25 кодів 0–5. Для прошивки використовуй MQTT-топік
`ukraine/alarm/map/full_v2`, а для резервного HTTP — `/public/status` та окреме
поле токена. Палітру кодів 2–5 налаштуй на платі.

## Подальші оновлення

### Оновлення до 1.4.0

Архів `alarmmini-server-1.4.0.tar.gz` містить нову панель, карту, статистику
та очищення журналу. Зміни `.env`, MQTT-топіків або прошивки не потрібні.
Перед оновленням збережи резервну копію поточного каталогу; залиш `.env` і
`runtime` на місці. Архів не містить цих файлів і не перезаписує їх.

Після завантаження архіву, наприклад у `/tmp`, виконай:

```bash
cd /opt/alarmmini
tar -czf /root/alarmmini-backup-$(date +%Y%m%d-%H%M%S).tar.gz --exclude=node_modules --exclude=dist .
tar -xzf /tmp/alarmmini-server-1.4.0.tar.gz -C /opt/alarmmini
npm ci --omit=dev
npm test
pm2 restart alarmmini
pm2 save
curl -i http://127.0.0.1:3000/health
```

Після перезапуску онови сторінку `/admin` та ввійди знову. Перевір свіжість API,
MQTT і наступну реальну доставку webhook. Історія метрик і лічильники починаються
з нового запуску. Кнопка очищення журналу не видаляє файли логів PM2.
Поточне налаштування PM2 з одним процесом потрібно зберегти: статистика,
сесії та фонові завдання розраховані на один екземпляр сервера.

Якщо потрібно повернутися назад, зупини `alarmmini`, віднови резервну копію
в його каталозі, виконай `npm ci --omit=dev` та `pm2 restart alarmmini`.

У версії 1.3.0 після оновлення відкрий вкладку **DuckDNS** у локальній панелі.
Введи домен і токен, збережи та натисни «Перевірити без змін». Для фонового
оновлення ввімкни відповідний прапорець і збережи ще раз. За замовчуванням
функція вимкнена. Якщо брокер в іншій мережі, задай його публічний IPv4 вручну.
Налаштування зберігаються у `runtime/duckdns.json`; цей файл містить токен,
тому його потрібно зберігати приватно та не замінювати під час розгортання.

Скопіюй новий архів і розпакуй у той самий `/opt/alarmmini`, встанови залежності
через `npm ci --omit=dev`, потім виконай `pm2 restart ecosystem.config.cjs` та
`pm2 save`. Архів не замінює `.env` або `runtime`. Якщо використовував інші
способи копіювання, збережи ці файли й каталог перед оновленням.
