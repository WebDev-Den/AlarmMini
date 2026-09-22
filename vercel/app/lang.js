import core from "../../firmware/work_data/i18n-core.js";
import ua from "../../firmware/work_data/locales/ua.json";
import en from "../../firmware/work_data/locales/en.json";

export const DEFAULT_LOCALE = "ua";
export const LANG = { ua, en };
export const { STORAGE_KEY, normalizeLocale, htmlLanguage } = core;
export const translateText = core.createTranslator(LANG);
