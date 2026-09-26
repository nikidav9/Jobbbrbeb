// Уровень и формат работы вакансии — для фильтров ленты (как у Cofinder).
//
// Отдельного поля у вакансий нет: источники присылают уровень прямо в
// названии («Senior Go-разработчик», «Стажёр-аналитик»), а формат — в графике
// («Гибридный», «Удалённо») или в тексте. Поэтому вычисляем здесь, одной
// чистой функцией: сервер для этого не нужен, и правило одно и для своих
// вакансий, и для карьерных. Не нашли признака — null: такая вакансия не
// проходит фильтр по уровню или формату, но и не выдаётся за чужой уровень.

export type VacancyLevel = 'intern' | 'junior' | 'middle' | 'senior' | 'lead' | 'head';
export type VacancyFormat = 'remote' | 'hybrid' | 'office';

export const VACANCY_LEVELS: { id: VacancyLevel; label: string }[] = [
  { id: 'intern', label: 'Стажёр' },
  { id: 'junior', label: 'Junior' },
  { id: 'middle', label: 'Middle' },
  { id: 'senior', label: 'Senior' },
  { id: 'lead', label: 'Lead' },
  { id: 'head', label: 'Head' },
];

export const VACANCY_FORMATS: { id: VacancyFormat; label: string }[] = [
  { id: 'remote', label: 'Удалённо' },
  { id: 'hybrid', label: 'Гибрид' },
  { id: 'office', label: 'Офис' },
];

// Порядок важен: «Head of Engineering» и «Team Lead» раньше «Senior», а
// «Senior Team Lead» — это лид. Кириллица без \b: в JS граница слова знает
// только латиницу, поэтому для русских слов — явные границы.
const LEVEL_RULES: [VacancyLevel, RegExp][] = [
  ['head', /\bhead\b|\bcto\b|\bcpo\b|\bvp\b|директор|(^|[^а-яё])(руководитель|начальник)([^а-яё]|$)/iu],
  ['lead', /\b(team\s*|tech\s*)?lead\b|\blead\b|тимлид|техлид|(^|[^а-яё])ведущ(ий|ая|его)([^а-яё]|$)/iu],
  ['intern', /\bintern(ship)?\b|\btrainee\b|стаж[её]р|стажировк|практикант/iu],
  ['junior', /\bjunior\b|\bjun\b|(^|[^а-яё])младш(ий|ая|его)([^а-яё]|$)|без опыта/iu],
  ['senior', /\bsenior\b|\bsr\.?\b|(^|[^а-яё])старш(ий|ая|его)([^а-яё]|$)/iu],
  ['middle', /\bmiddle\b|\bmid\b/iu],
];

/** Уровень по названию вакансии; null — в названии уровня нет. */
export function vacancyLevel(title: string | null | undefined): VacancyLevel | null {
  const t = (title ?? '').trim();
  if (!t) return null;
  for (const [level, re] of LEVEL_RULES) if (re.test(t)) return level;
  return null;
}

const REMOTE_RE = /удал[её]нн|удал[её]нк|\bremote\b|из дома|home office/iu;
const HYBRID_RE = /гибрид|\bhybrid\b|\bmixed\b/iu;
const OFFICE_RE = /(^|[^а-яё])(офис|в офисе|офисн)|\boffice\b/iu;

/**
 * Формат по графику, а если там пусто — по тексту вакансии. Гибрид раньше
 * «удалёнки» и «офиса»: «гибрид: 3 дня в офисе» — это гибрид, а не офис.
 */
export function vacancyFormat(schedule: string | null | undefined, text?: string | null): VacancyFormat | null {
  for (const s of [schedule ?? '', text ?? '']) {
    if (!s.trim()) continue;
    if (HYBRID_RE.test(s)) return 'hybrid';
    if (REMOTE_RE.test(s)) return 'remote';
    if (OFFICE_RE.test(s)) return 'office';
  }
  return null;
}
