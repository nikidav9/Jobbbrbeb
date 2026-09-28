import type {
  LinkType,
  MetroStationChoice,
  PersonalDetails,
  PersonalLink,
  ResumeProfile,
  User,
} from '@/constants/types';

/**
 * Чистые функции для 20 экранов редактирования профиля
 * (`docs/design/profile-edit/`). Ни одна не трогает React и не ходит на
 * сервер — сохранение по-прежнему идёт через `updateUser` из `useApp`,
 * которому эти функции только готовят новый объект `User`.
 *
 * ── Синхронизация legacy-полей ───────────────────────────────────────────
 * Часть экранов заводит структурные поля вместо старых строк, но старые
 * строки читают `lib/resumeParser.ts`, Jupiter и карточка у работодателя —
 * их нельзя просто бросить. `patchResume`/`patchPersonal` после применения
 * патча пересчитывают такие пары:
 *   - `ResumeProfile.salaryAmount` + `salaryNet`      → `ResumeProfile.salary` (строка)
 *   - `ResumeProfile.employmentTypes[0]`              → `ResumeProfile.employmentType`
 *   - `ResumeProfile.workFormats[0]`                  → `ResumeProfile.workFormat`
 *   - `ResumeExperience.current`                      → `ResumeExperience.end` ('Сейчас')
 *   - `ResumeEducation.endYear`                       → `ResumeEducation.period`
 *   - `ResumeCoursework.endYear`                      → `ResumeCoursework.period`
 *   - `PersonalDetails.linksList`                     → `PersonalDetails.links` (текстовый список)
 *   - `PersonalDetails.drivingCategories`              → `PersonalDetails.driversLicense` ('Да'/'Нет')
 *   - `PersonalDetails.hasEmploymentRestrictions=false` → `PersonalDetails.employmentRestrictions` (очищается)
 *   - `PersonalDetails.workAuthorizationCountries`     → `PersonalDetails.workAuthorization` (через запятую)
 *   - `PersonalDetails.metroStations[0]`               → `User.metroStation`/`User.metroLineId`
 */

export function emptyResume(): ResumeProfile {
  return {
    specializations: [],
    experience: [],
    education: [],
    projects: [],
    exams: [],
    languages: [],
    skills: [],
    interests: [],
    certifications: [],
    awards: [],
    coursework: [],
    sourceFileName: '',
    importedAt: '',
  };
}

function formatSalary(amount?: number, net?: boolean): string | undefined {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return undefined;
  // Обычный пробел, а не результат toLocaleString (там неразрывный  ) —
  // строка уходит в базу и сравнивается парсером, лишний повод для расхождений ни к чему.
  const grouped = Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sum = `${grouped} ₽`;
  if (net === true) return `${sum} на руки`;
  if (net === false) return `${sum} до вычета налогов`;
  return sum;
}

function syncResumeLegacy(resume: ResumeProfile): ResumeProfile {
  const synced: ResumeProfile = { ...resume };

  if (synced.salaryAmount != null) {
    const formatted = formatSalary(synced.salaryAmount, synced.salaryNet);
    if (formatted) synced.salary = formatted;
  }
  if (synced.employmentTypes && synced.employmentTypes.length > 0) {
    synced.employmentType = synced.employmentTypes[0];
  }
  if (synced.workFormats && synced.workFormats.length > 0) {
    synced.workFormat = synced.workFormats[0];
  }

  synced.experience = synced.experience.map((exp) => (
    exp.current ? { ...exp, end: 'Сейчас' } : exp
  ));
  synced.education = synced.education.map((edu) => (
    edu.endYear != null ? { ...edu, period: String(edu.endYear) } : edu
  ));
  synced.coursework = synced.coursework.map((c) => (
    c.endYear != null ? { ...c, period: String(c.endYear) } : c
  ));

  return synced;
}

/** Создаёт `resume`, если у пользователя его ещё не было, и применяет патч. */
export function patchResume(user: User, patch: Partial<ResumeProfile>): User {
  const base = user.resume ?? emptyResume();
  const merged = syncResumeLegacy({ ...base, ...patch });
  return { ...user, resume: merged };
}

function formatLink(link: PersonalLink): string {
  return link.label ? `${link.label} (${link.url})` : link.url;
}

function syncPersonalLegacy(personal: PersonalDetails): PersonalDetails {
  const synced: PersonalDetails = { ...personal };

  if (synced.linksList && synced.linksList.length > 0) {
    synced.links = synced.linksList.map(formatLink).join('\n');
  }
  if (synced.drivingCategories) {
    synced.driversLicense = synced.drivingCategories.length > 0 ? 'Да' : 'Нет';
  }
  if (synced.hasEmploymentRestrictions === false) {
    synced.employmentRestrictions = undefined;
  }
  if (synced.workAuthorizationCountries && synced.workAuthorizationCountries.length > 0) {
    synced.workAuthorization = synced.workAuthorizationCountries.join(', ');
  }

  return synced;
}

/**
 * Создаёт `personalDetails`, если его ещё не было, и применяет патч. Первая
 * станция из `metroStations` синхронизируется в `User.metroStation`/`metroLineId`
 * — их читают карточки в ленте у работодателя, а не только вкладка «Личные».
 */
export function patchPersonal(user: User, patch: Partial<PersonalDetails>): User {
  const base = user.personalDetails ?? {};
  const merged = syncPersonalLegacy({ ...base, ...patch });

  const next: User = { ...user, personalDetails: merged };
  if (patch.metroStations) {
    const first: MetroStationChoice | undefined = patch.metroStations[0];
    next.metroStation = first?.station;
    next.metroLineId = first?.lineId;
  }
  return next;
}

/** Ставит/заменяет элемент списка: `index` задан — заменяет, не задан — добавляет в конец. */
export function upsertAt<T>(list: T[], index: number | undefined, item: T): T[] {
  if (index == null) return [...list, item];
  const next = [...list];
  next[index] = item;
  return next;
}

/** Убирает элемент списка по индексу. Индекс вне диапазона — список не меняется. */
export function removeAt<T>(list: T[], index: number): T[] {
  if (index < 0 || index >= list.length) return list;
  return [...list.slice(0, index), ...list.slice(index + 1)];
}

// ─── Справочники вариантов (из docs/design/profile-edit/) ──────────────────
// Справочник полей вкладки «Личные» уже есть в lib/personalFieldChoices.ts
// (подписи, плейсхолдеры, старые choices) — эти списки его не дублируют, а
// закрывают то, чего там нет: новые структурные поля из макетов.

/** `resume/01-desired-position.html`, `personal/16-work-conditions.html`. */
export const EMPLOYMENT_TYPES = ['Полная', 'Частичная', 'Проектная', 'Стажировка', 'Волонтёрство'];

/** `resume/01-desired-position.html`, `personal/16-work-conditions.html`. */
export const WORK_FORMATS = ['В офисе', 'Гибрид', 'Удалённо', 'Разъездной'];

/** `personal/16-work-conditions.html`. */
export const SCHEDULES = ['5/2', '2/2', 'Гибкий', 'Сменный', 'Вахта'];

/** `resume/05-education.html`. */
export const EDUCATION_LEVELS = [
  'Среднее', 'Среднее специальное', 'Неоконченное высшее', 'Бакалавр',
  'Специалист', 'Магистр', 'Кандидат наук',
];

/** `resume/03-languages.html` — шкала CEFR + «Родной». */
export const LANGUAGE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Родной'];

/** Популярные языки для быстрого выбора при «+ Добавить язык». */
export const POPULAR_LANGUAGES = [
  'Английский', 'Немецкий', 'Французский', 'Испанский', 'Китайский',
  'Итальянский', 'Португальский', 'Турецкий', 'Арабский',
];

/** `personal/17-links.html`. */
export const LINK_TYPES: { value: LinkType; label: string }[] = [
  { value: 'github', label: 'GitHub' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'portfolio', label: 'Портфолио' },
  { value: 'behance', label: 'Behance' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'other', label: 'Другое' },
];

/** `personal/19-driving-license.html`. */
export const DRIVING_CATEGORIES = ['A', 'B', 'C', 'D', 'E', 'BE', 'CE', 'M'];

/** `personal/18-relocation.html` — три радио-варианта готовности к переезду. */
export const RELOCATION_VARIANTS = [
  { value: 'Не готов к переезду', description: 'Ищу работу только в своём городе' },
  { value: 'Готов к переезду', description: 'Рассмотрю предложения из других городов' },
  { value: 'Хочу переехать', description: 'Ищу работу именно в другом городе' },
];

/** `personal/18-relocation.html` — подсказки городов. */
export const POPULAR_RELOCATION_CITIES = [
  'Любой город', 'Санкт-Петербург', 'Казань', 'Екатеринбург', 'Новосибирск', 'Другой город',
];

/** `personal/14-work-permit.html` — множественный выбор стран без визы. */
export const WORK_PERMIT_COUNTRIES = [
  'Россия', 'Беларусь', 'Казахстан', 'Армения', 'Кыргызстан', 'Узбекистан',
  'Грузия', 'Сербия', 'Другая страна',
];

/** `personal/11-basic.html` — «Как к вам обращаться». */
export const ADDRESS_FORMS = ['По имени', 'По имени и отчеству', 'Свой вариант'];

/** Месяцы для полей вида «Начало» / «Окончание» на `resume/02-work-place.html`. */
export const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
