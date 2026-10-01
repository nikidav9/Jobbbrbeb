import type { ApplyAnswers, User } from '@/constants/types';

// Частые вопросы работодателей (01.10.2026, «Ответьте один раз»). Значения —
// тем текстом, который Юпитер впишет в анкету: на сайтах это свободные поля
// или списки, где совпадение ищется по смыслу.
export const NOTICE_OPTIONS = ['Сразу', 'Через неделю', 'Через 2 недели', 'Через месяц'];
export const ENGLISH_OPTIONS = ['Не знаю', 'A1 — начальный', 'A2 — элементарный', 'B1 — средний',
  'B2 — выше среднего', 'C1 — продвинутый', 'C2 — свободный'];
export const RELOCATION_OPTIONS = ['Не готов', 'Готов'];
export const FORMAT_OPTIONS = ['Офис', 'Гибрид', 'Удалённо', 'Любой'];

/** Ответы с подстановкой того, что человек уже заполнил в профиле. */
export function applyAnswersFor(user: User | null | undefined): ApplyAnswers {
  const p = user?.personalDetails ?? {};
  const r = user?.resume;
  const saved = p.applyAnswers ?? {};
  const tg = (p.linksList ?? []).find(l => l.type === 'telegram')?.url ?? '';
  const english = (r?.languages ?? []).find(l => /англ|english/i.test(l.name))?.level;
  return {
    desiredSalary: saved.desiredSalary ?? (r?.salaryAmount ? String(r.salaryAmount) : undefined),
    noticePeriod: saved.noticePeriod,
    telegram: saved.telegram ?? (tg ? tg.replace(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_]+)\/?$/, '@$1') : undefined),
    englishLevel: saved.englishLevel ?? english,
    relocation: saved.relocation ?? (p.relocationCities?.length ? 'Готов' : undefined),
    workFormat: saved.workFormat,
  };
}

/** Сколько из шести ответов есть — для строки профиля и карточки ленты. */
export function applyAnswersFilled(a: ApplyAnswers): number {
  return (['desiredSalary', 'noticePeriod', 'telegram', 'englishLevel', 'relocation', 'workFormat'] as const)
    .filter(k => (a[k] ?? '').trim() !== '').length;
}
