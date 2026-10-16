// Only fixed messages and allowlisted codes belong here: never URLs, tokens or request bodies.
export function createMonitor({now = Date.now, log = console, limit = 200} = {}) {
  const startedAt = new Date(now()).toISOString();
  const events = [];
  let sequence = 0;
  let clearedAt = null;
  let logGeneration = 0;
  const webhook = {received:0, accepted:0, rejected:0, duplicates:0, lastReceivedAt:null,
    lastAcceptedAt:null, lastRejectedAt:null, lastOutcome:null, lastError:null};
  function record(level, source, code, message) {
    const at = new Date(now()).toISOString();
    const previous = events.at(-1);
    if (previous?.code === code && previous.message === message && previous.level === level && previous.source === source) {
      previous.count++; previous.lastAt = at;
    } else {
      events.push({id:++sequence, at, lastAt:at, level, source, code, message, count:1});
      if (events.length > limit) events.shift();
    }
    log[level]?.(`[${source}] ${code}: ${message}`);
  }
  function receivedWebhook(outcome, code) {
    const at = new Date(now()).toISOString();
    webhook.received++; webhook.lastReceivedAt = at; webhook.lastOutcome = outcome;
    if (outcome === 'accepted') {
      webhook.accepted++; webhook.lastAcceptedAt = at; webhook.lastError = null;
      record('info', 'webhook', 'WEBHOOK_ACCEPTED', 'Webhook отримано, підпис перевірено. Заплановано оновлення API.');
    } else if (outcome === 'duplicate') {
      webhook.duplicates++; webhook.lastError = null;
      record('info', 'webhook', 'WEBHOOK_DUPLICATE', 'Повторний підписаний webhook: уже оброблено.');
    } else {
      webhook.rejected++; webhook.lastRejectedAt = at; webhook.lastError = code;
      record('warn', 'webhook', code, 'Вхідний webhook відхилено. Дані карти з цього запиту не змінювалися.');
    }
  }
  function view() {
    return {startedAt, uptimeSeconds:Math.max(0, Math.floor((now() - Date.parse(startedAt)) / 1000)),
      webhook:{...webhook}, events:events.slice().reverse().map(event => ({...event})), limit, clearedAt, logGeneration};
  }
  function clear() {
    events.length = 0;
    logGeneration++;
    clearedAt = new Date(now()).toISOString();
    return view();
  }
  return {record, receivedWebhook, view, clear};
}

export function mqttError(code) {
  const known = {
    1:'Брокер не підтримує версію протоколу MQTT.', 2:'Брокер відхилив ідентифікатор клієнта.',
    3:'MQTT-брокер тимчасово недоступний.', 4:'Брокер відхилив логін або пароль. Перевір MQTT_USERNAME і MQTT_PASSWORD у .env.',
    5:'Брокер заборонив доступ цьому користувачу.', 134:'Брокер відхилив логін або пароль.', 135:'Брокер заборонив доступ.',
    ECONNREFUSED:'Брокер відхилив з’єднання. Перевір адресу й порт.', ENOTFOUND:'Не вдалося знайти адресу MQTT-брокера.',
    EAI_AGAIN:'Тимчасова помилка DNS MQTT-брокера.', ETIMEDOUT:'MQTT-брокер не відповів вчасно.',
    ECONNRESET:'MQTT-брокер розірвав з’єднання.',
  };
  const key = String(code);
  return Object.hasOwn(known, key) ? {code:`MQTT_${key}`, message:known[key]}
    : {code:'MQTT_ERROR', message:'Помилка з’єднання з MQTT-брокером. Перевір адресу, доступи та TLS.'};
}
