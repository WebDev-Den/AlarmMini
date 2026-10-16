import { resolve } from 'node:path';

export function normalizePublicUrl(value) {
  if (!value) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Public URL must be an HTTPS origin without a path, credentials, query or fragment');
  }
  return url.origin;
}

export function loadConfig(env = process.env) {
  function integer(name, fallback, min, max) {
    const raw = env[name] ?? String(fallback);
    if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
      throw new Error(`${name} must be an integer between ${min} and ${max}`);
    }
    return Number(raw);
  }
  const apiToken = env.UKRAINEALARM_API_TOKEN?.trim();
  if (!apiToken || /[\r\n]/.test(apiToken)) {
    throw new Error('Set UKRAINEALARM_API_TOKEN in the environment or .env');
  }
  const config = {
    apiToken,
    apiBaseUrl: 'https://api.ukrainealarm.com/api/v3',
    host: env.HOST || '0.0.0.0',
    port: integer('PORT', 3000, 1, 65535),
    pollMs: integer('POLL_INTERVAL_MS', 30000, 5000, 60000),
    timeoutMs: integer('REQUEST_TIMEOUT_MS', 10000, 1000, 60000),
    staleMs: integer('STALE_AFTER_MS', 90000, 10000, 300000),
    minRefreshMs: 5000,
    regionsRefreshMs: 24 * 60 * 60 * 1000,
    mqttUrl: env.MQTT_URL?.trim() || '',
    mqttUsername: env.MQTT_USERNAME || undefined,
    mqttPassword: env.MQTT_PASSWORD || undefined,
    mqttClientId: env.MQTT_CLIENT_ID || 'alarmmini-server',
    topics: {
      legacy: env.MQTT_TOPIC_LEGACY || 'ukraine/alarm/map/full',
      v2: env.MQTT_TOPIC_V2 || 'ukraine/alarm/map/full_v2',
      status: env.MQTT_TOPIC_STATUS || 'ukraine/alarm/map/status',
    },
    httpToken: env.HTTP_API_TOKEN || '',
    publicStatusToken: env.PUBLIC_STATUS_TOKEN || env.HTTP_API_TOKEN || '',
    webhookToken: env.WEBHOOK_TOKEN || '',
    publicBaseUrl: normalizePublicUrl(env.PUBLIC_BASE_URL?.trim()),
    adminUser: env.ADMIN_USERNAME || '',
    adminPassword: env.ADMIN_PASSWORD || '',
    adminAllowedHosts: (env.ADMIN_ALLOWED_HOSTS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean),
    settingsFile: resolve(env.SETTINGS_FILE || 'runtime/settings.json'),
    webhookKeyFile: env.WEBHOOK_PUBLIC_KEY_FILE || '',
    duckDns: {
      enabled: env.DUCKDNS_ENABLED === 'true',
      domain: env.DUCKDNS_DOMAIN || '',
      token: env.DUCKDNS_TOKEN || '',
      ipv4: env.DUCKDNS_IPV4 || '',
      intervalMinutes: integer('DUCKDNS_INTERVAL_MINUTES', 5, 1, 1440),
    },
  };
  if (config.staleMs <= config.pollMs + config.timeoutMs) {
    throw new Error('STALE_AFTER_MS must exceed POLL_INTERVAL_MS + REQUEST_TIMEOUT_MS');
  }
  if (config.mqttUrl) {
    const url = new URL(config.mqttUrl);
    if (!['mqtt:', 'mqtts:', 'ws:', 'wss:'].includes(url.protocol)) {
      throw new Error('MQTT_URL must use mqtt, mqtts, ws or wss');
    }
  }
  const topics = Object.values(config.topics);
  if (new Set(topics).size !== topics.length || topics.some(t => /[+#\u0000]/.test(t))) {
    throw new Error('MQTT topics must be distinct and must not contain wildcards');
  }
  for (const [name, token] of [['PUBLIC_STATUS_TOKEN', config.publicStatusToken], ['WEBHOOK_TOKEN', config.webhookToken]]) {
    if (token && !/^[\x21-\x7e]{1,511}$/.test(token)) {
      throw new Error(`${name} must contain 1–511 ASCII characters without spaces`);
    }
  }
  if (Boolean(config.adminUser) !== Boolean(config.adminPassword)) throw new Error('Set both ADMIN_USERNAME and ADMIN_PASSWORD');
  if (env.DUCKDNS_ENABLED && !['true', 'false'].includes(env.DUCKDNS_ENABLED)) throw new Error('DUCKDNS_ENABLED must be true or false');
  return config;
}
