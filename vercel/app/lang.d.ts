export type Locale = "ua" | "en";
export const DEFAULT_LOCALE: Locale;
export const LANG: Record<Locale, Record<string, string>>;
export const STORAGE_KEY: string;
export function normalizeLocale(value: unknown): Locale;
export function htmlLanguage(locale: string): "uk" | "en";
export function translateText(source: string, locale?: string): string;
