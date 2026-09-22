/* Shared, dependency-free translation engine for the installer and device UI. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AlarmLocale = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STORAGE_KEY = "alarmmini.locale";
  function normalizeLocale(value) { return value === "en" ? "en" : "ua"; }
  function htmlLanguage(locale) { return normalizeLocale(locale) === "en" ? "en" : "uk"; }
  function createTranslator(catalogs) {
    const patterns = Object.keys(catalogs.ua).filter(key => /\{\d+\}/.test(key)).map(key => {
      const ids = [];
      const pattern = key.split(/(\{\d+\})/).map(part => {
        const match = part.match(/^\{(\d+)\}$/);
        if (match) { ids.push(match[1]); return "([\\s\\S]*?)"; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }).join("");
      return { key, ids, regex: new RegExp("^" + pattern + "$") };
    });
    function translate(source, locale = "ua", depth = 0) {
      if (typeof source !== "string" || !source) return source;
      const dictionary = catalogs[normalizeLocale(locale)];
      if (Object.hasOwn(dictionary, source)) return dictionary[source];
      if (depth > 3) return source;
      for (const { key, ids, regex } of patterns) {
        const match = source.match(regex);
        if (!match) continue;
        const values = Object.fromEntries(ids.map((id, index) => [id, translate(match[index + 1], locale, depth + 1)]));
        return (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, id) => values[id]);
      }
      return source;
    }
    return translate;
  }
  return { STORAGE_KEY, normalizeLocale, htmlLanguage, createTranslator };
});
