import { uz, type TranslationCatalog } from "./uz";

export type SupportedLocale = "uz";

export const translations: Record<SupportedLocale, TranslationCatalog> = { uz };
export const defaultLocale: SupportedLocale = "uz";
export const t = translations[defaultLocale];
