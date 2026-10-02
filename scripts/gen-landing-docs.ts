// Документы для сайта на компьютере (constants/landing.ts): тексты из
// constants/legal.ts в public/landing/docs.json. Сайт открывает их у себя в
// окне, не загружая приложение (решение владельца 02.10.2026). Поменял
// документ — запусти:
//   node --experimental-strip-types scripts/gen-landing-docs.ts
// Сторож расхождения — tests/landing-docs.test.ts.
import { writeFileSync } from 'node:fs';
import { LEGAL_DOCS, formatLegalDate, type LegalDocKey } from '../constants/legal.ts';

/** Порядок — как в списке документов приложения (app/legal.tsx). */
export const LANDING_DOC_KEYS: LegalDocKey[] = [
  'terms', 'privacy', 'dataPolicy', 'consent', 'marketing', 'employers', 'companies',
];

export function landingDocs(): string {
  const docs = LANDING_DOC_KEYS.map(key => ({
    key,
    title: LEGAL_DOCS[key].title,
    date: formatLegalDate(LEGAL_DOCS[key].version),
    sections: LEGAL_DOCS[key].sections,
  }));
  return JSON.stringify({ docs }) + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync('public/landing/docs.json', landingDocs()); // из корня репозитория
}
