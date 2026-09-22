(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./timezones.js'));
  else root.AlarmTimeZoneUtils = factory(root.AlarmTimeZones);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (catalog) {
  const defaultZone = catalog.default;
  const ids = new Set(catalog.zones.map(zone => zone.id));
  const cache = new Map();
  function supportsTimeZone(version) {
    const parts = /^v?(\d+)\.(\d+)\.(\d+)(?:$|[-+])/.exec(version || '');
    return Boolean(parts && (Number(parts[1]) > 2 || (Number(parts[1]) === 2 && (Number(parts[2]) > 1 || (Number(parts[2]) === 1 && Number(parts[3]) >= 5)))));
  }
  function options(locale, query = '') {
    const language = locale === 'en' ? 'en' : 'uk';
    if (!cache.has(language)) {
      const names = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames([language], { type: 'region' }) : null;
      cache.set(language, catalog.zones.map(zone => {
        const country = zone.countries.map(code => names ? names.of(code) : code).join(', ');
        const city = zone.id.split('/').at(-1).replaceAll('_', ' ');
        const fixed = /^Etc\/GMT([+-]\d+)$/.exec(zone.id);
        const label = fixed ? 'UTC' + (Number(fixed[1]) <= 0 ? '+' : '−') + Math.abs(Number(fixed[1])) : (country ? country + ' · ' + city : zone.id.replaceAll('_', ' '));
        return { id: zone.id, label };
      }).sort((a, b) => a.label.localeCompare(b.label, language)));
    }
    const search = query.trim().toLocaleLowerCase(language);
    return cache.get(language).filter(zone => !search || (zone.label + ' ' + zone.id).toLocaleLowerCase(language).includes(search));
  }
  function detect() {
    const id = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return ids.has(id) ? id : (id === 'UTC' ? 'Etc/UTC' : null);
  }
  return { defaultZone, options, detect, supportsTimeZone, isValid: id => typeof id === 'string' && ids.has(id) };
});
