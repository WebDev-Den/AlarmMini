export const defaultZone: string;
export function options(locale: string, query?: string): { id: string; label: string }[];
export function detect(): string | null;
export function isValid(id: unknown): id is string;
export function supportsTimeZone(version: string): boolean;
