export const DEFAULT_LOCALE = "uk";

export const LANG = {
  uk: {
    meta: {
      title: "AlarmMini Installer",
      description:
        "Вибір релізу, Web Serial і сервісна сторінка для AlarmMini.",
    },
    common: {
      unknown: "Невідомо",
      notFound: "Не знайдено",
      open: "Відкрити",
      loading: "Завантаження...",
      done: "Готово",
      fillGithubEnv: "Заповни NEXT_PUBLIC_GITHUB_OWNER і NEXT_PUBLIC_GITHUB_REPO.",
      releasesLoadFailed: "Не вдалося отримати релізи",
    },
    board: {
      waitingForConnection: "Очікує підключення",
      probablyOnline: "Ймовірно онлайн",
      connected: "Підключено",
      apMode: "AP режим",
      noWifi: "Немає Wi‑Fi",
      noMqtt: "Немає з'єднання",
      online: "Онлайн",
      noInternet: "Немає інтернету",
      notReading: "Не читається",
      streaming: "Streaming",
      connectToSeeLog: "Підключи плату, щоб побачити лог.",
    },
    support: {
      monoQrAlt: "Mono QR для донату",
      preparingQr: "Готуємо QR...",
      supportAuthor: "Підтримати автора",
      telegramGroup: "Telegram група",
      openGithub: "Відкрити GitHub",
    },
    config: {
      title: "Конфігурація",
      subtitle: "Wi‑Fi та MQTT беруться з config.json плати й можуть бути змінені перед прошивкою.",
      wifiTitle: "Wi‑Fi",
      ssid: "SSID",
      wifiPassword: "Пароль Wi‑Fi",
      mqttTitle: "MQTT",
      host: "Broker",
      port: "Порт",
      topic: "Топік",
      user: "Логін",
      mqttPassword: "Пароль MQTT",
      edit: "Конфігурація",
      close: "Закрити",
      save: "Застосувати",
      configuredWifi: "Wi‑Fi з config.json",
      configuredMqtt: "MQTT з config.json",
      notSet: "Не задано",
      staged: "Конфігурацію підготовлено. Вона буде застосована під час прошивки.",
    },
    flash: {
      releaseMissing: "Ще не вибрано",
      firmwareMissing: "firmware.bin не знайдено",
      littlefsMissing: "littlefs.bin не знайдено",
      backupSaved: "Конфіг збережено перед прошивкою",
      backupRequired: "Потрібен backup конфігу",
      serialUnsupported:
        "Для прошивки потрібен Chrome або Edge з підтримкою Web Serial.",
      busy: "Триває підготовка або завершення прошивки. Зачекай кілька секунд.",
      connecting: "Триває підключення до плати. Зачекай кілька секунд.",
      chooseRelease: "Спершу вибери реліз для прошивки.",
      requireAssets: "У релізі мають бути firmware.bin і littlefs.bin.",
      defaultConfig:
        "Конфіг не зчитано. Прошивка піде з типовою конфігурацією з релізу.",
      restoreConfig:
        "Конфіг зчитано. Після прошивки сторінка поверне його назад на плату.",
      autoFlow:
        "Кнопка сама підключить плату, спробує зчитати конфіг і лише потім запустить прошивку.",
      readingConfig: "Зчитуємо конфігурацію з плати...",
      restoringConfig: "Повертаємо конфігурацію на плату...",
      configReadOk: "Конфігурацію зчитано. Можна запускати прошивку.",
      configReadFailedCanContinue:
        "Конфігурацію не вдалося зчитати. Можна прошити плату з типовою конфігурацією.",
      connectingBoard: "Підключаємо плату...",
      configReadOkStarting: "Конфігурацію зчитано. Запускаємо прошивку...",
      configNotReadContinue:
        "Конфігурацію не вдалося зчитати. Можна продовжити з типовою конфігурацією.",
      doneWithDefault: "Готово. Плату прошито з типовою конфігурацією.",
      preparing: "Готуємо прошивку...",
      continueWithDefaultQuestion:
        "Конфігурацію не вдалося зчитати. Продовжити прошивку з типовою конфігурацією?",
      flashCancelled:
        "Прошивку скасовано. Перевір зчитування конфігу й спробуй ще раз.",
      continuingWithDefault:
        "Продовжуємо з типовою конфігурацією з релізу...",
      openingDialog: "Відкриваємо діалог прошивки...",
      flashStartFailedDefault:
        "Не вдалося запустити прошивку. Спробуй ще раз з підключеною платою.",
      flashStartFailed:
        "Не вдалося підготувати прошивку або зчитати конфігурацію. Перевір кабель і спробуй ще раз.",
      restoreFailed:
        "Прошивка завершена, але конфігурацію не вдалося повернути автоматично.",
      stageFlashed: "Прошито",
      stageRestoring: "Відновлюємо конфіг",
      stageDone: "Готово",
      connectBtn: "Підключити плату",
      connectingBtn: "Підключення...",
      connectedBtn: "Порт підключено",
      disconnectBtn: "Від'єднати",
      flashBtn: "Прошити плату",
      flashPreparingBtn: "Підготовка до прошивки...",
    },
    page: {
      brandTitle: "AlarmMini",
      brandSubtitle: "Installer console",
      comBrowser: "COM / Browser",
      connectBoardTitle: "Підключення плати",
      connectBoardText:
        "Працює в Chrome або Edge на ПК. Сторінка зчитує сервісну інформацію з serial ще до етапу прошивки.",
      webSerialAvailable: "Web Serial доступний",
      needChromium: "Потрібен Chromium-браузер",
      supportLabel: "Support",
      supportTitle: "Підтримати автора",
      githubLabel: "GitHub",
      githubTitle: "Проєкт AlarmMini",
      githubText:
        "Офіційний репозиторій з кодом, документацією та релізами прошивки.",
      eyebrow: "Прошивка",
      title: "Вибір релізу та підключення плати",
      releasesLabel: "GitHub Releases",
      releasesTitle: "Список доступних версій",
      releasesLoading: "Завантаження релізів...",
      noReleases: "Релізи не знайдено.",
      selected: "Обрано",
      select: "Вибрати",
      selectedReleaseLabel: "Обраний реліз",
      comStatusLabel: "COM status",
      boardInfoTitle: "Службова інформація з плати",
      serialLogLabel: "Serial log",
      wifi: "Wi‑Fi",
      internet: "Internet",
      mqtt: "MQTT",
      ip: "IP",
      mdns: "mDNS",
      password: "Пароль",
      firmware: "Firmware",
      lastLine: "Останній рядок",
    },
  },
};

export function getMessages(locale = DEFAULT_LOCALE) {
  return LANG[locale] ?? LANG[DEFAULT_LOCALE];
}
