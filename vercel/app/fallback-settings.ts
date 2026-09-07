export function normalizeFallbackUrl(value: string): string {
  const input = value.trim();
  if (!input) return "";
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Введи повну адресу резервного API: https://example.com/alerts.json"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || /[\s\\]/.test(input)) {
    throw new Error("Резервний URL має починатися з http:// або https://, без логіна, пароля, пробілів чи #.");
  }
  if (url.hostname.includes(":")) throw new Error("Для резерву використай домен або IPv4-адресу.");
  if (new TextEncoder().encode(url.href).length > 255) throw new Error("Резервний URL має вміщуватися у 255 байтів.");
  return url.href;
}

export function supportsFallback(version: string): boolean {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(?:$|-)/);
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  return major > 2 || (major === 2 && (minor > 0 || patch >= 7));
}
