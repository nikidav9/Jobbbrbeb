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

/**
 * Достаёт сумму из легаси-строки `salary` вида «150 000 ₽ на руки»,
 * «от 120000 руб.», «200 000–250 000 ₽» (берёт первое число). Строка могла
 * прийти из парсера резюме (`lib/resumeParser.ts`) с неразрывными пробелами
 * между разрядами — их тоже считаем разделителем.
 */
export function parseSalaryAmount(salary?: string): number | undefined {
  if (!salary) return undefined;
  const match = salary.match(/\d[\d\s ]*/);
  if (!match) return undefined;
  const digits = match[0].replace(/[\s ]/g, '');
  if (!digits) return undefined;
  const amount = Number(digits);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

/** «На руки» → true, «до вычета» → false, без уточнения — неизвестно. */
export function parseSalaryNet(salary?: string): boolean | undefined {
  if (!salary) return undefined;
  if (/на руки/i.test(salary)) return true;
  if (/до вычета/i.test(salary)) return false;
  return undefined;
}

function syncResumeLegacy(resume: ResumeProfile): ResumeProfile {
  const synced: ResumeProfile = { ...resume };

  if (synced.salaryAmount != null) {
    const formatted = formatSalary(synced.salaryAmount, synced.salaryNet);
    if (formatted) synced.salary = formatted;
  }
  // Массив задан (в том числе пустой — «стёрли последний вариант») —
  // легаси-поле пересчитывается; не задан вовсе — не трогаем.
  if (synced.employmentTypes !== undefined) {
    synced.employmentType = synced.employmentTypes[0];
  }
  if (synced.workFormats !== undefined) {
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
  // Зарплату стёрли на экране — старая строка salary не должна пережить это.
  if ('salaryAmount' in patch && !(Number(patch.salaryAmount) > 0)) merged.salary = undefined;
  return { ...user, resume: merged };
}

function formatLink(link: PersonalLink): string {
  return link.label ? `${link.label} (${link.url})` : link.url;
}

function syncPersonalLegacy(personal: PersonalDetails): PersonalDetails {
  const synced: PersonalDetails = { ...personal };

  // Массив задан (в том числе пустой — «удалили последнюю ссылку/страну») —
  // легаси-поле пересчитывается; не задан вовсе — не трогаем.
  if (synced.linksList !== undefined) {
    synced.links = synced.linksList.length > 0
      ? synced.linksList.map(formatLink).join('\n')
      : undefined;
  }
  if (synced.drivingCategories) {
    synced.driversLicense = synced.drivingCategories.length > 0 ? 'Да' : 'Нет';
  }
  if (synced.hasEmploymentRestrictions === false) {
    synced.employmentRestrictions = undefined;
  }
  if (synced.workAuthorizationCountries !== undefined) {
    synced.workAuthorization = synced.workAuthorizationCountries.length > 0
      ? synced.workAuthorizationCountries.join(', ')
      : undefined;
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
  // Город один на профиль: экран «Город и метро» пишет location, а блок
  // «Желаемая должность» и работодатель читают resume.city.
  if ('location' in patch && user.resume) {
    next.resume = { ...user.resume, city: patch.location || undefined };
  }
  return next;
}

/**
 * Добавляет `https://` по умолчанию и проверяет, что ссылка http/https
 * и ведёт на хост с точкой (не `http://localhost`, не `javascript:...`).
 * Пустая строка — не ошибка: экраны ссылок делают поле необязательным.
 */
export function normalizeHttpUrl(raw: string): { url?: string; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  const SCHEME_ERROR = 'Ссылка должна начинаться с http:// или https://';
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`;
  const scheme = withScheme.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)?.[1].toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') return { error: SCHEME_ERROR };
  let host = '';
  try {
    host = new URL(withScheme).hostname;
  } catch {
    return { error: SCHEME_ERROR };
  }
  if (!host.includes('.')) return { error: SCHEME_ERROR };
  return { url: withScheme };
}

/**
 * Слияние публичной строки из `dbGetUsers` со своим текущим профилем: та
 * проекция (`USER_PUBLIC_COLS` в `php-proxy/db.php`) не содержит self-only
 * колонки (`USER_SELF_COLS`) — их нужно сохранить из `prev`, иначе следующий
 * `updateUser` отправит `personal_data: {}` и сотрёт их на сервере.
 */
export function mergeSelfUser(prev: User, fresh: User): User {
  return {
    ...prev,
    ...fresh,
    phone: prev.phone,
    email: prev.email,
    emailVerifiedAt: prev.emailVerifiedAt,
    hasPassword: fresh.hasPassword ?? prev.hasPassword,
    personalDetails: prev.personalDetails,
    resume: fresh.resume
      ? {
        ...fresh.resume,
        email: prev.resume?.email,
        sourceFileName: prev.resume?.sourceFileName ?? '',
        importedAt: prev.resume?.importedAt ?? '',
      }
      : prev.resume,
  };
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
