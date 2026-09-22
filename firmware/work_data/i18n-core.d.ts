declare const core: {
  STORAGE_KEY: string;
  normalizeLocale(value: unknown): "ua" | "en";
  htmlLanguage(locale: string): "uk" | "en";
  createTranslator(catalogs: Record<"ua" | "en", Record<string, string>>): (source: string, locale?: string) => string;
};
export default core;
