# AlarmMini

**Мапа тривог України · Ukraine alert map**
ESP32-C3 SuperMini / ESP8266 Wemos D1 mini · UA / EN · v2.1.5

[Відкрити інсталятор / Open installer](https://alarmmini.vercel.app) · [Посібник / User guide (PDF)](docs/AlarmMini_User_Manual_UA_EN.pdf) · [Реліз / Release](https://github.com/WebDev-Den/AlarmMini/releases/latest) · [Підтримка / Support](https://t.me/+j3zFZHE5gGoyNGYy)

---

## Українська

AlarmMini перетворює компактну LED-мапу на зручний індикатор стану тривог. Налаштуйте Wi-Fi з телефона, відкрийте панель пристрою й оберіть кольори, яскравість та нічний розклад. Для оновлення достатньо USB-кабелю й браузера на комп’ютері.

### Можливості

- Українська й англійська мови інсталятора, панелі та початкового налаштування Wi-Fi.
- Адаптивна панель на самому пристрої: огляд мапи, кольори, нічний режим, калібрування та QR-етикетки.
- MQTT і резервний HTTP/HTTPS-канал із підтримкою токена авторизації.
- Початковий JSON-профіль із шістьма станами, кольорами, MQTT і резервним API. Сервісний пароль та токен включені за дозволом автора; домашній Wi-Fi користувач налаштовує сам.
- Пошук часового поясу за країною або містом, визначення з браузера, автоматичний літній/зимовий час. Підтримуються й зміщення на 30 та 45 хвилин.
- Експорт та імпорт JSON; оновлення зі збереженням і перевіркою налаштувань.

### Перший запуск

1. Увімкніть мапу й підключіться до Wi-Fi **AlarmMap-Setup-XXXXXX** (без пароля).
2. Відкрийте **http://192.168.4.1**, виберіть домашню мережу **2,4 ГГц** і збережіть пароль.
3. Поверніться до домашнього Wi-Fi. Відкрийте адресу з етикетки мапи; пароль адміністратора також є на етикетці або в USB-інсталяторі.
4. У розділі **Нічний режим → Часовий пояс** виберіть місце, де стоятиме мапа, і натисніть **Зберегти**.

Друкований [посібник UA + EN](docs/AlarmMini_User_Manual_UA_EN.pdf) займає **один аркуш A4: дві половини A5**. Друкуйте в альбомній орієнтації, масштаб 100%; за потреби розріжте посередині.

### Оновлення

На [сайті](https://alarmmini.vercel.app) у Chrome або Edge на комп’ютері підключіть плату USB-кабелем із передаванням даних. Виберіть свою плату й **оновлення зі збереженням налаштувань**. Не від’єднуйте USB до завершення перевірки. Оновлюються і програма, і вебпанель плати. Режим першого встановлення скидає старі налаштування й призначений для нових пристроїв.

Для готової мапи початкове налаштування та подальше керування доступні з телефона. Прошивання через USB виконується на комп’ютері. Інтернет потрібен для отримання станів тривог і синхронізації часу. За відсутності актуальних даних перевіряйте офіційні сповіщення: мапа є допоміжним індикатором.

### Використання та підтримка

Особисте некомерційне використання, навчання та подарунки дозволені. **Продаж пристроїв із AlarmMini, платні послуги та інше комерційне використання потребують попередньої письмової згоди автора WebDev-Den.** Повні умови: [LICENSE](LICENSE). Для підтримки й комерційних домовленостей: [Telegram](https://t.me/+j3zFZHE5gGoyNGYy).

---

## English

AlarmMini turns a compact LED map into an easy-to-read Ukraine alert display. Set up Wi-Fi from your phone, open the device dashboard, and choose your colours, brightness and night schedule. Updates need only a USB data cable and a desktop browser.

### Features

- Ukrainian and English throughout the installer, device dashboard and initial Wi-Fi setup.
- Responsive dashboard hosted on the device: map overview, colours, night mode, calibration and QR labels.
- MQTT updates with an HTTP/HTTPS fallback source and authorization-token support.
- A default JSON profile with six states, colours, MQTT and fallback API settings. Service credentials are included with the author's permission; users supply their own home Wi-Fi details.
- Search time zones by country or city, detect your browser's zone, and switch automatically between summer and winter time. Half-hour and quarter-hour offsets are supported.
- JSON export/import and firmware updates that preserve and verify settings.

### First setup

1. Power on the map and join **AlarmMap-Setup-XXXXXX** Wi-Fi (no password).
2. Open **http://192.168.4.1**, select your home **2.4 GHz** network, and save its password.
3. Rejoin your home Wi-Fi. Open the address on the map's label; the admin password is on the label or available through the USB installer.
4. Go to **Night mode → Time zone**, choose where the map will be used, and select **Save**.

The printable [UA + EN guide](docs/AlarmMini_User_Manual_UA_EN.pdf) fits on **one A4 sheet as two A5 panels**. Print landscape at 100% scale; cut along the centre line if needed.

### Updates

Open the [installer](https://alarmmini.vercel.app) in Chrome or Edge on a computer and connect the board with a USB data cable. Select your board and **update while preserving settings**. Keep USB connected until verification finishes. The update includes both firmware and the board's web interface. First installation resets previous settings and is intended for new devices.

A phone is sufficient for Wi-Fi setup and everyday control of an assembled map. USB flashing requires a computer. Alert updates and time synchronization require internet access. If data is stale, check official notifications: this map is a supplementary display.

### Use and support

Personal non-commercial use, learning and gifts are permitted. **Selling AlarmMini-equipped devices, offering paid services, or any other commercial use requires prior written permission from the author, WebDev-Den.** See [LICENSE](LICENSE) for the full terms. Support and commercial enquiries: [Telegram](https://t.me/+j3zFZHE5gGoyNGYy).

---

## Development / Розробка

| Path | Contents / Вміст |
| --- | --- |
| `firmware/` | ESP32-C3 / ESP8266 firmware and embedded web panel |
| `vercel/` | Web installer and default JSON profile |
| `docs/` | Printable bilingual PDF only |
| `documentation/` | Technical notes, release history and manual source |

```sh
# Firmware and LittleFS for both boards
cd firmware
python scripts/build_release_assets.py
# Installer
cd ../vercel
npm ci
npm test
npm run build
```

[Timezone implementation](documentation/timezones.md) · [Translations in JSON](documentation/localization.md) · [Fallback API contract](documentation/http-fallback.md) · [ESP8266 wiring](documentation/wemos-d1-mini.md) · [v2.1.5 changes](documentation/releases/v2.1.5.md)

The timezone database follows IANA rules shipped with the firmware. Future changes to national time rules require a database/firmware update. Third-party libraries and data retain their own licences; the AlarmMini licence applies only to original project materials.
