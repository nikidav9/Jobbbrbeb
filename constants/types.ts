import type { JobSection } from './jobSections';
export type WorkType = 'stocker' | 'cook' | 'shift_supervisor' | 'picker';

export interface ResumeExperience {
  company: string;
  position: string;
  start: string;
  end: string;
  duration?: string;
  description?: string;
  /** «Работаю здесь сейчас» — экран `resume/02-work-place.html`. При true `end` синхронизируется в 'Сейчас'. */
  current?: boolean;
}

export interface ResumeEducation {
  level?: string;
  institution?: string;
  specialty?: string;
  period?: string;
  /** Год окончания числом — источник для `period`, экран `resume/05-education.html`. */
  endYear?: number;
}

export interface ResumeLanguage {
  name: string;
  level: string;
}

export interface ResumeProject {
  name: string;
  role?: string;
  period?: string;
  description?: string;
  url?: string;
}

export interface ResumeExam {
  name: string;
  score?: string;
  date?: string;
  /** Кто проводил — экран `resume/06-exam.html`. */
  issuer?: string;
}

export interface ResumeCertification {
  name: string;
  issuer?: string;
  date?: string;
  expiration?: string;
  credentialId?: string;
  credentialUrl?: string;
  /** Прикреплённый файл сертификата (URL после загрузки) — `resume/07-certificate.html`. */
  fileUrl?: string;
  /** «Бессрочно»: `expiration` не задан осознанно, а не просто не заполнен. */
  noExpiration?: boolean;
}

export interface ResumeAward {
  name: string;
  issuer?: string;
  date?: string;
  description?: string;
}

export interface ResumeCoursework {
  name: string;
  institution?: string;
  period?: string;
  description?: string;
  /** Год окончания числом — источник для `period`, экран `resume/08-course.html`. */
  endYear?: number;
  /** Длительность курса, например «3 месяца». */
  duration?: string;
  /** Ссылка на сертификат об окончании. */
  credentialUrl?: string;
}

/** Тип ссылки на экране `personal/17-links.html`. */
export type LinkType = 'github' | 'linkedin' | 'portfolio' | 'behance' | 'telegram' | 'other';

export interface PersonalLink {
  type: LinkType;
  url: string;
  label?: string;
}

/** Одна станция метро с линией — до 3 штук, экран `personal/15-city-metro.html`. */
export interface MetroStationChoice {
  station: string;
  lineId?: string;
}

export interface PersonalDetails {
  middleName?: string;
  preferredName?: string;
  title?: string;
  contactEmail?: string;
  links?: string;
  citizenship?: string;
  workAuthorization?: string;
  location?: string;
  workAvailability?: string;
  relocation?: string;
  driversLicense?: string;
  employmentRestrictions?: string;
  /** Дата рождения ДД.ММ.ГГГГ — по ней считается `User.age`, экран `personal/11-basic.html`. */
  birthDate?: string;
  /** Показывать возраст в профиле работодателю. */
  showAge?: boolean;
  /** Показывать номер телефона работодателям — экран `personal/13-phone.html`. */
  showPhone?: boolean;
  /** Страны, где можно работать без визы — множественный выбор, `personal/14-work-permit.html`. Легаси `workAuthorization` — join через запятую. */
  workAuthorizationCountries?: string[];
  /** До 3 станций метро — `personal/15-city-metro.html`. Первая синхронизируется в `User.metroStation`/`metroLineId`. */
  metroStations?: MetroStationChoice[];
  /** Занятость, множественный выбор — экран `personal/16-work-conditions.html`. */
  employmentTypes?: string[];
  /** Формат работы, множественный выбор — экран `personal/16-work-conditions.html`. */
  workFormats?: string[];
  /** График работы, множественный выбор — экран `personal/16-work-conditions.html`. */
  schedule?: string[];
  /** Ссылки списком (до 5) — экран `personal/17-links.html`. Легаси `links` — текстовый список. */
  linksList?: PersonalLink[];
  /** Города, куда готов переехать — экран `personal/18-relocation.html`. */
  relocationCities?: string[];
  /** Категории водительских прав — экран `personal/19-driving-license.html`. Легаси `driversLicense` — «Да»/«Нет». */
  drivingCategories?: string[];
  /** Есть личный автомобиль. */
  hasOwnCar?: boolean;
  /** Есть ли ограничения по трудоустройству — экран `personal/20-restrictions.html`. Легаси `employmentRestrictions` хранит описание. */
  hasEmploymentRestrictions?: boolean;
}

export interface ResumeProfile {
  desiredPosition?: string;
  salary?: string;
  summary?: string;
  specializations: string[];
  employmentType?: string;
  workFormat?: string;
  city?: string;
  email?: string;
  citizenship?: string;
  workPermit?: string;
  businessTrips?: string;
  /** Зарплата числом — экран `resume/01-desired-position.html`. Легаси `salary` собирается из неё и `salaryNet`. */
  salaryAmount?: number;
  /** true — «на руки», false — «до вычета налогов». */
  salaryNet?: boolean;
  /** Занятость, множественный выбор — легаси `employmentType` хранит первый вариант. */
  employmentTypes?: string[];
  /** Формат работы, множественный выбор — легаси `workFormat` хранит первый вариант. */
  workFormats?: string[];
  /** График работы, множественный выбор — экран `personal/16-work-conditions.html` (общий с занятостью/форматом). */
  schedule?: string[];
  experience: ResumeExperience[];
  education: ResumeEducation[];
  projects: ResumeProject[];
  exams: ResumeExam[];
  languages: ResumeLanguage[];
  skills: string[];
  interests: string[];
  certifications: ResumeCertification[];
  awards: ResumeAward[];
  coursework: ResumeCoursework[];
  sourceFileName: string;
  importedAt: string;
}

export interface User {
  id: string;
  role: 'worker' | 'employer';
  /**
   * Телефон для связи. С 25.09.2026 необязателен: регистрация идёт по почте.
   * У старых аккаунтов он же — вход, пока не подтверждена почта.
   */
  phone: string;
  /** Почта для входа — только в своём профиле, чужим не отдаётся. */
  email?: string;
  /** Когда почта подтверждена кодом; пусто — старый аккаунт без почты. */
  emailVerifiedAt?: string;
  /**
   * Задан ли пароль — только в своём профиле, сервер отдаёт признак, а не сам
   * пароль. false — аккаунт создан по коду из письма; undefined — неизвестно
   * (старый ответ сервера или кэш).
   */
  hasPassword?: boolean;
  lastName: string;
  firstName: string;
  age?: number;
  metroLineId?: string;
  metroStation?: string;
  workTypes?: WorkType[];
  company?: string;
  createdAt: string;
  password?: string;
  isBlocked?: boolean;
  avatarUrl?: string;
  avgRating?: number;
  ratingCount?: number;
  bio?: string;
  resume?: ResumeProfile;
  /** Приватная анкета из вкладки «Личные». Не входит в публичный профиль. */
  personalDetails?: PersonalDetails;
  telegramId?: number;
  /** Когда пользователь последний раз был в приложении */
  lastSeenAt?: string;
  /** Гостевой просмотр без регистрации: синтетический пользователь, которого
   *  нельзя сохранять и от чьего имени нельзя писать в базу. Любое действие
   *  вместо записи ведёт на регистрацию. */
  isGuest?: boolean;

  // ─── JobToo Score ───────────────────────────────────────────────────────
  // Считает сервер после каждой смены и каждой оценки; приложение только
  // показывает. Пусто — отработанных смен ещё меньше трёх, и любое число
  // здесь было бы выдумкой (см. миграцию 037).
  /** 0–100. */
  score?: number;
  /** Сколько смен отработано — знаменатель всего остального. */
  scoreShifts?: number;
  /** Доли 0–1 по осям. */
  scoreReliability?: number;
  scorePunctuality?: number;
  scoreQuality?: number;
  scoreSpeed?: number;
  /** У скольких разных работодателей работал. */
  scoreEmployers?: number;

  // ─── Репутация работодателя ─────────────────────────────────────────────
  // Те же правила: считает сервер, пусто — смен ещё мало. Оси — четыре из
  // презентации, причём «отмены смен» не спрашивается, а считается из
  // записанных исходов (см. миграцию 039).
  empScore?: number;
  empScoreShifts?: number;
  /** Работа совпала с описанием. */
  empScoreDesc?: number;
  /** Отношение к людям. */
  empScoreAttitude?: number;
  /** Платит вовремя. */
  empScorePay?: number;
  /** Доля смен, которые он НЕ отменил. */
  empScoreKept?: number;

  /**
   * Профессии, по которым пройден микро-тест. Копия из jm_skill_results:
   * нужна там, где показывают список людей, а лезть за каждым отдельно
   * значит сорок запросов на один экран.
   */
  confirmedSkills?: WorkType[];

  /**
   * Поручительство: скольких приведённых этот человек довёл до первой смены.
   * Считает сервер (jt_referral_on_outcome), приложение только показывает —
   * как и рейтинг, поставить его себе самому нельзя.
   */
  referralWorked?: number;
}

export interface Vacancy {
  id: string;
  employerId: string;
  company: string;
  title: string;
  workType: WorkType;
  workTypeLabel: string;
  metroLineId: string;
  metroStation: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  salary: number;
  normsAndPay: string;
  address?: string;
  lat?: number;
  lng?: number;
  workersNeeded: number;
  workersFound: number;
  isUrgent: boolean;
  noExperienceNeeded: boolean;
  conditions: string;
  status: 'open' | 'closed';
  createdAt: string;
}

export interface Like {
  id: string;
  vacancyId: string;
  workerId: string;
  employerId: string;
  workerLiked: boolean;
  employerLiked: boolean | null;
  workerSkipped: boolean;
  isMatch: boolean;
  matchedAt?: string;
  workerConfirmed?: boolean;
  employerConfirmed?: boolean;
  workerRated?: boolean;
  employerRated?: boolean;
  shiftCompleted?: boolean;
  cancelled?: boolean;
  // Чем смена кончилась на самом деле. `shiftCompleted`/`cancelled` — то же
  // самое, но грубее: по ним не отличить невыход от отмены работодателем.
  outcome?: ShiftOutcome;
  // Минуты опоздания. 0 — пришёл вовремя, не задано — не спрашивали
  // (все смены до августа 2026).
  lateMinutes?: number;
  outcomeAt?: string;
}

/**
 * Исход смены. Отдельные значения вместо одной галочки «отменена» нужны
 * рейтингу: невыход — это про работника, отмена работодателем — про
 * работодателя, а предупредивший отказ не позорит никого.
 *
 * `cancelled_legacy` — то, что отменили до появления причин. Причину тогда
 * не спрашивали, поэтому в статистику такие смены не идут вовсе.
 */
export type ShiftOutcome =
  | 'worked'
  | 'no_show'
  | 'worker_cancelled'
  | 'employer_cancelled'
  | 'other_cancelled'
  | 'cancelled_legacy';

/** Что работодатель может отметить руками. `cancelled_legacy` только читается. */
export type ReportableOutcome = Exclude<ShiftOutcome, 'cancelled_legacy'>;

export interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
}

export interface Chat {
  id: string;
  vacancyId: string;
  workerId: string;
  employerId: string;
  vacTitle: string;
  companyName: string;
  messages: Message[];
  unreadWorker: number;
  unreadEmployer: number;
  // Когда каждая сторона в последний раз открывала переписку. Отсюда
  // галочки: своё сообщение прочитано, если оно старше отметки собеседника.
  // Пусто — собеседник ещё ни разу не заходил, и относиться галочке не к чему.
  workerReadAt?: string;
  employerReadAt?: string;
  createdAt: string;
  // Остались от удалённого раздела «Биржа»: два старых чата заведены оттуда.
  // Вакансии у них нет, и по этим полям чат это про себя и понимает.
  bulletinId?: string;
  workerSlotId?: string;
  isLocked?: boolean;
}

export interface Complaint {
  id: string;
  reporterId: string;
  reporterPhone: string;
  reporterCompany?: string;
  targetId: string;
  targetPhone: string;
  targetCompany?: string;
  complaintType: 'worker' | 'employer';
  description?: string;
  createdAt: string;
}

// ─── Permanent jobs ──────────────────────────────────────────────────────────

export interface PermVacancy {
  id: string;
  employerId: string;
  company: string;
  title: string;
  workType?: WorkType;
  metroLineId?: string;
  metroStation?: string;
  address?: string;
  lat?: number;
  lng?: number;
  salary: number;
  schedule: string;
  description?: string;
  status: 'open' | 'closed';
  createdAt: string;
}

// hired — работодатель нажал «Завершить»: кандидат закрыт, карточка ушла из
// «Мэтчей» в «Завершённые». Сама вакансия при этом остаётся в поиске, закрыть
// её можно во вкладке «Активные».
export type PermApplicationStatus = 'pending' | 'approved' | 'rejected' | 'hired';

/**
 * Заявка, которую Jupiter подаёт на внешнем карьерном сайте.
 *
 * Не путать с PermApplication: та про отклик внутри JobToo, где решение
 * принимает работодатель. Здесь — чужой сайт, чужая форма и фоновый прогон,
 * поэтому и состояния свои.
 */
export type JupiterApplicationState =
  | 'queued' | 'opening_site' | 'finding_vacancy' | 'opening_application'
  | 'filling' | 'validating' | 'ready_to_submit' | 'submitting' | 'verifying'
  | 'submitted' | 'action_required' | 'submission_unknown' | 'duplicate'
  | 'retryable_failed' | 'failed';

export interface JupiterApplication {
  id: string;
  vacancyUrl: string;
  company?: string | null;
  /** Название вакансии из фида, если она там ещё есть; иначе null. */
  vacancyTitle?: string | null;
  /** Вакансия ещё в списке сайта. false — работодатель её закрыл; null — неизвестно. */
  vacancyActive?: boolean | null;
  state: JupiterApplicationState;
  reasonCode?: string | null;
  /** Есть, когда прогон ждёт человека: капча, код из письма, вход. */
  resumeToken?: string | null;
  externalApplicationId?: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string | null;
  verifiedAt?: string | null;
  submissionAuthorizedAt?: string | null;
  /** Явное согласие с условиями конкретного внешнего работодателя. */
  thirdPartyConsentAt?: string | null;
  /** Адрес условий, с которыми пользователь согласился для этой заявки. */
  thirdPartyTermsUrl?: string | null;
}

export interface ExtVacancy {
  id: string;
  sourceId: string;
  externalId: string;
  title: string;
  company: string;
  metroStation?: string | null;
  metroLineId?: string | null;
  workType?: string | null;
  /** Раздел ленты по названию (php-proxy/job_sections.php); null — ещё не размечена. */
  section?: JobSection | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  salary?: number | null;
  payPeriod?: string | null;
  schedule?: string | null;
  description?: string | null;
  url: string;
  active: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface PermApplication {
  id: string;
  vacancyId: string;
  workerId: string;
  employerId: string;
  status: PermApplicationStatus;
  createdAt: string;
}

export interface Rating {
  id: string;
  fromUserId: string;
  toUserId: string;
  vacancyId: string;
  likeId: string;
  rating: number;
  role: 'worker' | 'employer';
  createdAt: string;
}
