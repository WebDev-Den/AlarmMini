"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { DEFAULT_LOCALE, STORAGE_KEY, htmlLanguage, normalizeLocale, translateText, type Locale } from "./lang";

const LanguageContext = createContext({
  locale: DEFAULT_LOCALE,
  setLocale: (_locale: Locale) => {},
  t: (text: string) => text,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(DEFAULT_LOCALE);
  useEffect(() => {
    try { updateLocale(normalizeLocale(localStorage.getItem(STORAGE_KEY))); } catch { /* Storage may be disabled. */ }
  }, []);
  const setLocale = useCallback((value: Locale) => {
    updateLocale(value);
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* Switching still works without persistence. */ }
  }, []);
  const t = useCallback((text: string) => translateText(text, locale), [locale]);
  useEffect(() => {
    document.documentElement.lang = htmlLanguage(locale);
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute("content", t("Проший ESP32-C3 або ESP8266 через USB. Просте оновлення AlarmMini зі збереженням і перевіркою налаштувань."));
  }, [locale, t]);
  return <LanguageContext.Provider value={{ locale, setLocale, t }}>
    <a className="skip-link" href="#installer">{t("Перейти до прошивання")}</a>
    {children}
  </LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);

export function LanguageSwitcher() {
  const { locale, setLocale } = useLanguage();
  return <div className="language-switcher" role="group" aria-label="Мова / Language">
    <button type="button" lang="uk" aria-label="Українська" aria-pressed={locale === "ua"} onClick={() => setLocale("ua")}>UA</button>
    <button type="button" lang="en" aria-label="English" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>EN</button>
  </div>;
}
