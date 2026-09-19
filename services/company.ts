const DEFAULT_COMPANY = 'Компания';
const LAVKA_COMPANY = 'Лавка';

/** A comparison key for company aliases that differ only by legal/punctuation spelling. */
function companyAliasKey(raw: string): string {
  return raw
    .toLocaleLowerCase('ru-RU')
    .replace(/[«»"'`().]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^ооо\s+/, '')
    .replace(/\s+/g, ' ');
}

/** Preserve partner brands, but collapse known aliases to one product-facing name. */
export function normalizeCompany(raw?: string | null): string {
  const company = raw?.trim();
  if (!company) return DEFAULT_COMPANY;

  const key = companyAliasKey(company);
  if (key === 'лавка' || key === 'яндекс лавка' || key === 'яндекс.лавка') {
    return LAVKA_COMPANY;
  }
  return company;
}

export function isLavkaCompany(raw?: string | null): boolean {
  return normalizeCompany(raw) === LAVKA_COMPANY;
}

export function companyInitials(raw?: string | null): string {
  return normalizeCompany(raw)
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word[0])
    .join('')
    .toLocaleUpperCase('ru-RU')
    .slice(0, 2);
}
