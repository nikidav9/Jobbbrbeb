/**
 * Фильтры ленты работника (полоса чипов над колодой, решение владельца
 * 27.09.2026 — вместо шестерёнки и общей шторки PermFilterSheet).
 *
 * Чистая логика, без React и без сети — как соседние services/feedMix.ts и
 * services/energy.ts, чтобы её проверял обычный node:test. Карьерные вакансии
 * фильтрует сервер (dbGetExtFeed → php-proxy/ext_feed.php), свои вакансии
 * JobToo — этот файл, одним и тем же набором правил (зарплата, специализация,
 * уровень, формат, компания, дата публикации).
 */
import type { VacancySpec, VacancyLevel, VacancyFormat } from './vacancyFacets.ts';
import { vacancySpecs, vacancyLevel, vacancyFormat } from './vacancyFacets.ts';
import type { ExtFeedFilters } from './db.ts';

export type PostedFilter = 'all' | 'day' | '3days' | 'week' | 'month';

export type FeedFilters = {
  /** 0 — без ограничения снизу. */
  salaryFrom: number;
  specs: VacancySpec[];
  levels: VacancyLevel[];
  formats: VacancyFormat[];
  companies: string[];
  posted: PostedFilter;
};

export const EMPTY_FEED_FILTERS: FeedFilters = {
  salaryFrom: 0,
  specs: [],
  levels: [],
  formats: [],
  companies: [],
  posted: 'all',
};

/** Хоть один фильтр включён — используется и для «пустой экран» текста. */
export function isFilterActive(f: FeedFilters): boolean {
  return f.salaryFrom > 0 || f.specs.length > 0 || f.levels.length > 0
    || f.formats.length > 0 || f.companies.length > 0 || f.posted !== 'all';
}

/** Сколько из шести групп фильтров включено — не сумма выбранных значений. */
export function activeCount(f: FeedFilters): number {
  return [
    f.salaryFrom > 0,
    f.specs.length > 0,
    f.levels.length > 0,
    f.formats.length > 0,
    f.companies.length > 0,
    f.posted !== 'all',
  ].filter(Boolean).length;
}

function postedWithin(iso: string | null | undefined, posted: PostedFilter, now: number): boolean {
  if (posted === 'all' || !iso) return true;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return true;
  const days = posted === 'day' ? 1 : posted === '3days' ? 3 : posted === 'week' ? 7 : 30;
  return now - t <= days * 86400000;
}

/** Минимум полей своей вакансии, нужных для фильтра — не тянем весь PermVacancy. */
export type OwnVacancyLike = {
  title: string;
  company: string;
  schedule?: string | null;
  description?: string | null;
  salary?: number | null;
  createdAt?: string | null;
};

/**
 * Своя вакансия JobToo проходит фильтр целиком на клиенте — сервер её не
 * видит. Уровень, формат и специализация без признака в тексте не проходят
 * выбранный фильтр (не выдумываем вакансии чужой уровень), а без зарплаты
 * вакансия скрывается, как только выбрана сумма «от» — то же правило, что и
 * на сервере для карьерных.
 */
export function matchOwnVacancy(v: OwnVacancyLike, f: FeedFilters, now: number): boolean {
  if (f.salaryFrom > 0) {
    const s = typeof v.salary === 'number' ? v.salary : 0;
    if (s <= 0 || s < f.salaryFrom) return false;
  }
  if (f.specs.length && !vacancySpecs(v.title).some(s => f.specs.includes(s))) return false;
  if (f.levels.length) {
    const lv = vacancyLevel(v.title);
    if (!lv || !f.levels.includes(lv)) return false;
  }
  if (f.formats.length) {
    const fm = vacancyFormat(v.schedule, v.description);
    if (!fm || !f.formats.includes(fm)) return false;
  }
  if (f.companies.length && !f.companies.includes(v.company)) return false;
  if (!postedWithin(v.createdAt, f.posted, now)) return false;
  return true;
}

/** Тот же фильтр, в форме, которую ждёт dbGetExtFeed. */
export function toExtFeedFilters(f: FeedFilters): ExtFeedFilters {
  return {
    salaryFrom: f.salaryFrom,
    specs: f.specs,
    levels: f.levels,
    formats: f.formats,
    companies: f.companies,
    posted: f.posted,
  };
}

/** Склонение «вакансия/вакансии/вакансий» под число. */
export function pluralVacancies(n: number): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return 'вакансий';
  if (last === 1) return 'вакансия';
  if (last >= 2 && last <= 4) return 'вакансии';
  return 'вакансий';
}
