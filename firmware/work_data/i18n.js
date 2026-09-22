/* Source text stays in the model; only visible text and accessibility labels change. */
(function () {
  let locale = "ua";
  let translate = text => text;
  const textSources = new WeakMap();
  const attributeSources = new WeakMap();
  const ignored = "script, style, textarea, code, pre, [translate='no'], [data-i18n-ignore]";
  const t = value => translate(value, locale);

  function text(element, source) {
    if (!element) return;
    element.textContent = t(source);
    if (element.firstChild) textSources.set(element.firstChild, { source, rendered: element.textContent });
  }

  function attribute(element, name, source) {
    if (!element) return;
    const values = attributeSources.get(element) || {};
    values[name] = source;
    attributeSources.set(element, values);
    element.setAttribute(name, t(source));
  }

  function localize(root = document.body) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest(ignored)) continue;
      const previous = textSources.get(node);
      const source = previous && previous.rendered === node.textContent ? previous.source : node.textContent;
      const trimmed = source.trim();
      const normalized = trimmed.replace(/\s+/g, " ");
      let translated = t(trimmed);
      if (translated === trimmed) translated = t(normalized);
      node.textContent = translated === trimmed || translated === normalized ? source : source.replace(trimmed, translated);
      textSources.set(node, { source, rendered: node.textContent });
    }
    root.querySelectorAll("[title], [placeholder], [aria-label]").forEach(element => {
      if (element.closest(ignored)) return;
      const originals = attributeSources.get(element) || {};
      for (const name of ["title", "placeholder", "aria-label"]) {
        if (element.hasAttribute(name)) attribute(element, name, originals[name] ?? element.getAttribute(name));
      }
    });
  }

  function html(element, value) {
    element.innerHTML = value;
    localize(element);
  }

  function select(value) {
    locale = window.AlarmLocale.normalizeLocale(value);
    document.documentElement.lang = window.AlarmLocale.htmlLanguage(locale);
    try { localStorage.setItem(window.AlarmLocale.STORAGE_KEY, locale); } catch { /* Optional persistence. */ }
    localize();
    document.querySelectorAll("[data-locale]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.locale === locale)));
    document.dispatchEvent(new Event("languagechange"));
  }

  async function init(embeddedCatalogs) {
    try {
      if (embeddedCatalogs) translate = window.AlarmLocale.createTranslator(embeddedCatalogs);
      else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          const [ua, en] = await Promise.all(["ua", "en"].map(async name => {
            const response = await fetch(`/locales/${name}.json`, { signal: controller.signal });
            if (!response.ok) throw new Error("Could not load language file");
            return response.json();
          }));
          translate = window.AlarmLocale.createTranslator({ ua, en });
        } finally { clearTimeout(timer); }
      }
    } catch (error) {
      console.error("[language]", error);
      document.querySelectorAll('[data-locale="en"]').forEach(button => { button.disabled = true; button.title = "English could not load. Reload to retry."; });
      return;
    }
    let saved = "ua";
    try { saved = localStorage.getItem(window.AlarmLocale.STORAGE_KEY); } catch { /* Default to Ukrainian. */ }
    document.querySelectorAll("[data-locale]").forEach(button => button.addEventListener("click", () => select(button.dataset.locale)));
    select(saved);
  }
  window.AlarmI18n = { init, t, text, attribute, html, localize };
})();
