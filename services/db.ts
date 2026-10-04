import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import type { JupiterEvent } from '@/services/jupiterTimeline';
import { User, Vacancy, Like, Chat, Message, PermVacancy, PermApplication, PermApplicationStatus, ReportableOutcome, ResumeProfile, JupiterApplication, ExtVacancy } from '@/constants/types';
import type { VacancySpec, VacancyLevel, VacancyFormat } from '@/services/vacancyFacets';
import { uid, nowISO } from '@/services/storage';
import { normalizeCompany } from '@/services/company';

const DB_TIMEOUT = 12_000;

// ─── API proxy ───────────────────────────────────────────────────────────────
// Все вызовы идут через proxy() на jobtoo.ru: Supabase из браузеров в России заблокирован.

// trim и снятие косой черты на конце — по той же причине, что в
// lib/supabase.ts: значения вставляют руками, и в один из адресов уже
// попадал перевод строки. Пропуск тоже подрезаем: лишний пробел в нём
// превратился бы в «неверный пропуск» на каждом запросе.
// В вебе (обычный браузер, установленная PWA и Telegram Mini App) ходим за
// данными на тот же адрес, с которого открылось приложение. Иначе, открывшись
// с «чистого» имени (когда jobtoo.ru режет фильтр ТСПУ), приложение всё равно
// стучалось бы на зашитый jobtoo.ru — и данные молча не грузились. Тот же nginx
// на любом нашем имени отдаёт /api/db.php, поэтому same-origin работает везде.
// На нативных платформах window нет — там остаётся явный адрес из окружения.
const API_BASE =
  Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : (process.env.EXPO_PUBLIC_API_URL || 'https://jobtoo.ru').trim().replace(/\/+$/, '');

const APP_SECRET = (process.env.EXPO_PUBLIC_APP_SECRET ?? '').trim();
// Версия приложения уходит в каждом запросе: так сервер может отказать слишком
// старой сборке понятным текстом (php-proxy/app_version.php, с 1.0.0).
const APP_VERSION = Constants.expoConfig?.version ?? '';
const SESSION_TOKEN_KEY = 'jm_session_token';
let sessionTokenCache: string | null | undefined;

/**
 * Где лежит токен сессии.
 *
 * На телефоне — в защищённом хранилище системы (Keychain на iOS, EncryptedShared
 * Preferences на Android), а не в AsyncStorage: тот хранит значения открытым
 * файлом в песочнице приложения, и на разлоченном устройстве или из резервной
 * копии токен читается как обычный текст. Живёт он тридцать дней, так что
 * находка стоит месяца доступа к чужой переписке.
 *
 * На вебе expo-secure-store не работает вовсе (нет системного хранилища), там
 * остаётся AsyncStorage поверх localStorage — и защищает его уже origin, а не
 * файловые права.
 */
const useSecureStore = Platform.OS !== 'web';

async function readToken(): Promise<string | null> {
  if (!useSecureStore) return AsyncStorage.getItem(SESSION_TOKEN_KEY).catch(() => null);
  const fromSecure = await SecureStore.getItemAsync(SESSION_TOKEN_KEY).catch(() => null);
  if (fromSecure) return fromSecure;
  // Разовый перенос: у тех, кто уже вошёл, токен лежит на старом месте.
  // Иначе эта правка разлогинила бы всех сразу после обновления.
  const legacy = await AsyncStorage.getItem(SESSION_TOKEN_KEY).catch(() => null);
  if (legacy) {
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, legacy).catch(() => {});
    await AsyncStorage.removeItem(SESSION_TOKEN_KEY).catch(() => {});
  }
  return legacy;
}

export async function getSessionToken(): Promise<string | null> {
  if (sessionTokenCache !== undefined) return sessionTokenCache;
  sessionTokenCache = await readToken();
  return sessionTokenCache;
}

async function saveSessionToken(token: string | null): Promise<void> {
  sessionTokenCache = token;
  if (!useSecureStore) {
    if (token) await AsyncStorage.setItem(SESSION_TOKEN_KEY, token);
    else await AsyncStorage.removeItem(SESSION_TOKEN_KEY);
    return;
  }
  if (token) await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token).catch(() => {});
  else await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY).catch(() => {});
  // Старое место чистим в любом случае: там мог остаться прежний токен.
  await AsyncStorage.removeItem(SESSION_TOKEN_KEY).catch(() => {});
}

export async function dbClearSession(): Promise<void> {
  await saveSessionToken(null);
}

// Сессия протухла или отсутствует. Сервер (db.php) на авторизованную функцию
// без валидной подписи отвечает 401 «Authentication required». Раньше это
// всплывало как сырая англоязычная плашка прямо на форме (например, при
// «Опубликовать»), и человек оставался на экране, не понимая, что делать.
// Теперь на 401 мы чистим битый токен и зовём обработчик, который приложение
// регистрирует (AppContext → logout + возврат на вход).
const SESSION_EXPIRED_MESSAGE = 'Сессия истекла. Войдите заново, пожалуйста.';
let sessionExpiredHandler: (() => void) | null = null;

/** Приложение регистрирует, что делать при протухшей сессии (401). */
export function setSessionExpiredHandler(cb: (() => void) | null): void {
  sessionExpiredHandler = cb;
}

/**
 * Запрос к прокси.
 *
 * Ответ читаем текстом, а не res.json(). Когда хостинг вместо ответа отдаёт
 * свою страницу — «слишком много запросов», технические работы, — разбор
 * падал с «JSON Parse error: Unexpected character: Т», и это всё, что видел
 * человек. У директора так не опубликовалась вакансия, и по такому тексту
 * понять было нечего: он описывает первую букву чужой страницы, а не беду.
 *
 * Поэтому: одна повторная попытка (страница хостинга — обычно секундная
 * икота), а если и она не JSON — говорим, что именно ответил сервер.
 *
 * И обязательно свой срок ожидания. У fetch его нет вовсе: при подвисшей
 * сети запрос висит бесконечно, а вместе с ним — всё, что его ждёт. Снаружи
 * это выглядит как «нажимаю, и ничего не происходит», без единого слова о
 * причине. Лучше честно сказать, что сервер не ответил.
 */
const PROXY_TIMEOUT = 25_000;

async function proxy<T>(fn: string, args: unknown[] = []): Promise<T> {
  let status = 0;
  let text = '';
  // Был ли к запросу приложен токен сессии. Нужен ниже: 401 при наличии токена
  // — это протухшая/отозванная сессия (разлогиниваем и ведём на вход); 401 без
  // токена — это гость или незалогиненный, у него нечему истекать, поэтому его
  // трогать нельзя (иначе гостевой вход тут же выкидывает на экран входа).
  let hadToken = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), PROXY_TIMEOUT);
    let res: Response;
    try {
      const sessionToken = await getSessionToken();
      hadToken = !!sessionToken;
      res = await fetch(`${API_BASE}/api/db.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Secret': APP_SECRET,
          'X-App-Version': APP_VERSION,
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({ fn, args }),
        signal: ctl.signal,
      });
      status = res.status;
      text = await res.text();
    } catch (e: any) {
      clearTimeout(timer);
      const timedOut = e?.name === 'AbortError';
      // Обрыв связи повторяем один раз — как и невнятный ответ хостинга.
      if (attempt === 0 && !timedOut) { await new Promise(r => setTimeout(r, 600)); continue; }
      console.error(`[db] ${fn}:`, e?.message ?? String(e));
      throw new Error(timedOut
        ? 'Сервер не ответил вовремя. Проверьте соединение и попробуйте ещё раз.'
        : 'Нет связи с сервером. Проверьте соединение.');
    }
    clearTimeout(timer);

    let parsed: { data?: T; error?: string } | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Не JSON — ответила не наша программа. Пробуем ещё раз, один — но не
      // при 502–504: это перегрузка, и повтор от каждого клиента её удваивает.
      if (attempt === 0 && ![502, 503, 504].includes(status)) {
        await new Promise(r => setTimeout(r, 600)); continue;
      }
      break;
    }
    // Сессия недействительна.
    if (status === 401 || parsed?.error === 'Authentication required') {
      if (hadToken) {
        // Токен был, но сервер его отверг — сессия протухла/отозвана. Чистим,
        // поднимаем экран входа, отдаём понятный русский текст.
        await saveSessionToken(null);
        sessionExpiredHandler?.();
        throw new Error(SESSION_EXPIRED_MESSAGE);
      }
      // Токена и не было — это гость/незалогиненный дёрнул авторизованную
      // функцию. Не разлогиниваем (гостя нельзя выкидывать со входа) — просто
      // сообщаем, что нужна регистрация. Фоновые вызовы это молча проглотят.
      throw new Error('Для этого действия нужна регистрация.');
    }
    if (parsed?.error) throw new Error(humanServerError(fn, parsed.error, status));
    return parsed?.data as T;
  }

  console.error(`[db] ${fn}: ответ не JSON (HTTP ${status}):`, text.slice(0, 500));
  throw new Error(httpStatusMessage(status));
}

/**
 * Что показать человеку вместо технического ответа. Раньше в плашку уходили
 * куски HTML хостинга («Сервер ответил не по делу (502): <!DOCTYPE…»),
 * английские ошибки базы и `curl: …`. Русские тексты сервера пишутся для
 * людей и проходят как есть — по ним же, бывает, ветвится экран (/уже есть/,
 * /почт/), поэтому их не трогаем.
 */
function httpStatusMessage(status: number): string {
  if (status === 429) return 'Слишком много попыток. Подождите минуту и попробуйте снова.';
  if (status === 502 || status === 503 || status === 504) {
    return 'Сервер сейчас перегружен. Попробуйте ещё раз через минуту.';
  }
  return 'Что-то пошло не так. Попробуйте ещё раз.';
}

function humanServerError(fn: string, message: string, status: number): string {
  if (/[а-яё]/i.test(message)) return message;
  console.warn(`[db] ${fn}: техническая ошибка сервера (HTTP ${status}):`, message);
  if (status === 403) return 'Это действие вам недоступно.';
  return httpStatusMessage(status);
}

function withTimeout<T>(promise: PromiseLike<T>, ms = DB_TIMEOUT): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Нет ответа от сервера. Проверьте соединение.')), ms)
    ),
  ]);
}

// ─── Users ────────────────────────────────────────────────────────────────────

function rowToUser(r: any): User {
  return {
    id: r.id,
    role: r.role,
    phone: r.phone ?? '',
    email: r.email ?? undefined,
    emailVerifiedAt: r.email_verified_at ?? undefined,
    lastName: r.last_name,
    firstName: r.first_name,
    age: r.age ?? undefined,
    metroLineId: r.metro_line_id ?? undefined,
    metroStation: r.metro_station ?? undefined,
    workTypes: r.work_types ?? [],
    company: r.company ? normalizeCompany(r.company) : undefined,
    createdAt: r.created_at,
    isBlocked: r.is_blocked ?? false,
    avatarUrl: r.avatar_url ?? undefined,
    avgRating: r.avg_rating ?? 0,
    ratingCount: r.rating_count ?? 0,
    password: r.password ?? '',
    bio: r.bio ?? undefined,
    personalDetails: r.personal_data && typeof r.personal_data === 'object'
      ? r.personal_data
      : undefined,
    resume: r.resume_data ? {
      ...r.resume_data,
      specializations: Array.isArray(r.resume_data.specializations) ? r.resume_data.specializations : [],
      experience: Array.isArray(r.resume_data.experience) ? r.resume_data.experience : [],
      education: Array.isArray(r.resume_data.education) ? r.resume_data.education : [],
      projects: Array.isArray(r.resume_data.projects) ? r.resume_data.projects : [],
      exams: Array.isArray(r.resume_data.exams) ? r.resume_data.exams : [],
      languages: Array.isArray(r.resume_data.languages) ? r.resume_data.languages : [],
      skills: Array.isArray(r.resume_data.skills) ? r.resume_data.skills : [],
      interests: Array.isArray(r.resume_data.interests) ? r.resume_data.interests : [],
      certifications: Array.isArray(r.resume_data.certifications) ? r.resume_data.certifications : [],
      awards: Array.isArray(r.resume_data.awards) ? r.resume_data.awards : [],
      coursework: Array.isArray(r.resume_data.coursework) ? r.resume_data.coursework : [],
      ...(r.resume_email ? { email: r.resume_email } : {}),
      sourceFileName: r.resume_file_name ?? r.resume_data.sourceFileName ?? '',
      importedAt: r.resume_imported_at ?? r.resume_data.importedAt ?? '',
    } : undefined,
    telegramId: r.telegram_id ?? undefined,
    lastSeenAt: r.last_seen_at ?? undefined,
    // Рейтинг считает сервер (jt_recalc_score в php-proxy/db.php) и кладёт
    // сюда же. В userToRow его нет намеренно: сохранение профиля не должно
    // уметь его переписать — иначе рейтинг можно было бы поставить себе сам.
    score: r.score ?? undefined,
    scoreShifts: r.score_shifts ?? 0,
    scoreReliability: r.score_reliability != null ? Number(r.score_reliability) : undefined,
    scorePunctuality: r.score_punctuality != null ? Number(r.score_punctuality) : undefined,
    scoreQuality: r.score_quality != null ? Number(r.score_quality) : undefined,
    scoreSpeed: r.score_speed != null ? Number(r.score_speed) : undefined,
    scoreEmployers: r.score_employers ?? 0,
    empScore: r.emp_score ?? undefined,
    empScoreShifts: r.emp_score_shifts ?? 0,
    empScoreDesc: r.emp_score_desc != null ? Number(r.emp_score_desc) : undefined,
    empScoreAttitude: r.emp_score_attitude != null ? Number(r.emp_score_attitude) : undefined,
    empScorePay: r.emp_score_pay != null ? Number(r.emp_score_pay) : undefined,
    empScoreKept: r.emp_score_kept != null ? Number(r.emp_score_kept) : undefined,
    confirmedSkills: Array.isArray(r.confirmed_skills) ? r.confirmed_skills : [],
    referralWorked: r.referral_worked ?? 0,
  };
}
// NB: telegram_id намеренно НЕ входит в userToRow — привязка живёт только
// на сервере (tg.php), иначе сохранение профиля затирало бы её.

function userToRow(u: User) {
  const {
    email: resumeEmail,
    sourceFileName: resumeFileName,
    importedAt: resumeImportedAt,
    ...publicResume
  } = u.resume ?? ({} as NonNullable<User['resume']>);
  return {
    id: u.id,
    // Старый локальный кэш мог не содержать role. Сервер всё равно
    // защищает поле, но клиент не должен отправлять null даже на старой сессии.
    role: u.role === 'employer' || u.role === 'worker'
      ? u.role
      : (u.company ? 'employer' : 'worker'),
    phone: u.phone,
    last_name: u.lastName,
    first_name: u.firstName,
    age: u.age ?? null,
    metro_line_id: u.metroLineId ?? null,
    metro_station: u.metroStation ?? null,
    work_types: u.workTypes ?? [],
    company: u.company ? normalizeCompany(u.company) : null,
    created_at: u.createdAt,
    is_blocked: u.isBlocked ?? false,
    avatar_url: u.avatarUrl ?? null,
    avg_rating: u.avgRating ?? 0,
    rating_count: u.ratingCount ?? 0,
    password: u.password ?? '',
    bio: u.bio ?? null,
    personal_data: u.personalDetails ?? {},
    resume_data: u.resume ? publicResume : null,
    resume_email: resumeEmail ?? null,
    resume_file_name: resumeFileName ?? null,
    resume_imported_at: resumeImportedAt ?? null,
  };
}

/**
 * Своё приглашение: код и что по нему вышло.
 *
 * Отдельная операция, а не поле пользователя: профиль любого человека
 * запрашивает кто угодно, и код приглашения уехал бы вместе с ним.
 *
 * Денег в программе нет: вознаграждение — поручительство, которое видно
 * работодателю на карточке. Поэтому три числа, а не одно: разрыв между
 * «позвали» и «вышли» и есть весь её смысл, а невышедшие не прячутся — без
 * них «вышли» набирается рассылкой кода кому попало.
 */
export type MyReferral = {
  code: string;
  /** Сколько человек зарегистрировались по коду. */
  invited: number;
  /** Из них вышли на первую смену (старые смены). Это тоже поручительство. */
  worked: number;
  /** Из них устроились на работу через JobToo (нанят работодателем). */
  hired: number;
  /** И не вышли. Число неприятное, но без него первое ничего не значит. */
  noShow: number;
};

export async function dbGetMyReferral(userId: string): Promise<MyReferral | null> {
  return await proxy<MyReferral>('dbGetMyReferral', [userId]);
}

export async function dbGetUserById(id: string): Promise<User | null> {
  const d = await proxy<any>('dbGetUserById', [id]);
  return d ? rowToUser(d) : null;
}

/**
 * Насколько человек отзывчив — для чужого профиля.
 *
 * `enough: false` означает «переписок слишком мало, чтобы судить»: по одному
 * чату вывод делать нельзя, а выглядел бы он как приговор. В этом случае блок
 * в профиле не показываем вовсе.
 */
export type UserStats =
  | { enough: false }
  | { enough: true; chats: number; answered: number; medianSeconds: number | null };

export async function dbUserStats(userId: string): Promise<UserStats> {
  try {
    return await proxy<UserStats>('dbUserStats', [userId]);
  } catch {
    // Профиль важнее статистики: не сложилось — просто не показываем блок.
    return { enough: false };
  }
}

export async function dbGetUsers(): Promise<User[]> {
  const d = await proxy<any[]>('dbGetUsers');
  return d.map(rowToUser);
}

export async function dbRestoreSession(): Promise<User | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const d = await proxy<{ user?: any } | null>('dbSession');
    return d?.user ? rowToUser(d.user) : null;
  } catch (e) {
    // proxy очищает токен только при подтверждённом 401.
    // Сетевые ошибки не должны превращаться в logout.
    if (e instanceof Error && e.message === SESSION_EXPIRED_MESSAGE) return null;
    throw e;
  }
}

// ─── Вход по почте с кодом (решение владельца 25.09.2026, вход — 27.09.2026) ─
// register — новый аккаунт; attach — почта к старому аккаунту по телефону;
// reset — восстановление пароля; login — сам вход, пароль остаётся запасным
// вариантом. Код приходит письмом, сверяет сервер; для register/attach/reset
// в ответ идёт «квитанция», которую предъявляют на последнем шаге, а для
// login — сразу сессия (см. dbAuthLoginByCode).
export type EmailCodePurpose = 'register' | 'attach' | 'reset' | 'login' | 'delete';

/**
 * Готова ли почта для кодов. Пока нет (26.09 исходящий SMTP у хостинга
 * закрыт) — регистрация по телефону и без окна «Укажите почту». Сбой связи
 * — тоже «не готова»: безопасное состояние, в котором всё работает как раньше.
 */
export async function dbAuthConfig(): Promise<{ emailReady: boolean }> {
  try {
    const d = await proxy<{ email_ready?: boolean }>('dbAuthConfig');
    return { emailReady: !!d?.email_ready };
  } catch {
    return { emailReady: false };
  }
}

export async function dbAuthSendCode(email: string, purpose: EmailCodePurpose): Promise<void> {
  await proxy<{ ok: boolean }>('dbAuthSendCode', [email, purpose]);
}

export async function dbAuthVerifyCode(email: string, purpose: EmailCodePurpose, code: string): Promise<string> {
  const d = await proxy<{ ticket: string }>('dbAuthVerifyCode', [email, purpose, code]);
  return d.ticket;
}

/** Вход по коду из письма: код одноразовый, квитанции нет — сессия сразу. */
export async function dbAuthLoginByCode(email: string, code: string): Promise<User> {
  const d = await proxy<{ user: any; session_token: string }>('dbAuthVerifyCode', [email, 'login', code]);
  await saveSessionToken(d.session_token);
  return rowToUser(d.user);
}

/** Почта к старому аккаунту по телефону. */
export async function dbAuthAttachEmail(ticket: string): Promise<User> {
  const d = await proxy<{ user: any }>('dbAuthAttachEmail', [ticket]);
  return rowToUser(d.user);
}

/** Телефон для связи: пусто — стереть. */
export async function dbSetContactPhone(userId: string, phone: string): Promise<string | null> {
  const d = await proxy<{ phone: string | null }>('dbSetContactPhone', [userId, phone]);
  return d.phone;
}

/**
 * Сохранить профиль; при РЕГИСТРАЦИИ — передать код приглашения.
 *
 * Код идёт отдельным доводом, а не полем профиля: поля профиля человек
 * назначает себе сам, а кто его привёл — решает сервер. Он же находит
 * владельца кода и записывает связь, и только один раз, при создании.
 */
type ConsentPayload = {
  stamp: string;
  docs: Record<string, string>;
  /** Отдельное добровольное согласие на трансграничную передачу. */
  crossBorderVersion?: string;
  /** Галочка «рекламная рассылка» при регистрации — редакция документа marketing. */
  marketingVersion?: string;
};

export async function dbUpsertUser(
  u: User,
  referralCode?: string,
  consent?: ConsentPayload,
  /** Квитанция dbAuthVerifyCode(…, 'register') — при регистрации по почте. */
  emailTicket?: string,
): Promise<void> {
  const { avg_rating, rating_count, ...row } = userToRow(u);
  // Пустой пароль не отправляем: он означает «профиль пришёл без пароля»
  // (вход его больше не отдаёт), а не «стереть пароль».
  if (!row.password) delete (row as Partial<typeof row>).password;
  // Согласие идёт ТЕМ ЖЕ запросом, что создаёт человека. Отдельным вызовом
  // оно терялось при любом обрыве связи, а запись согласия — доказательство,
  // а не аналитика.
  const args: unknown[] = emailTicket
    ? [row, referralCode ?? '', consent ?? null, emailTicket]
    : consent
      ? [row, referralCode ?? '', consent]
      : (referralCode ? [row, referralCode] : [row]);
  const d = await proxy<{ session_token?: string | null }>('dbUpsertUser', args);
  if (d?.session_token) await saveSessionToken(d.session_token);
}

/**
 * Удаление кодом из письма (01.10.2026): код уходит на подтверждённую почту
 * аккаунта — адрес сервер берёт из сессии сам, поэтому сюда его не передаём.
 */
export async function dbSendDeleteAccountCode(): Promise<void> {
  await proxy<{ ok: boolean }>('dbAuthSendCode', ['', 'delete']);
}

export async function dbDeleteAccountByCode(id: string, code: string): Promise<void> {
  const res = await proxy<{ error?: string; 'удалён'?: boolean }>(
    'dbDeleteAccountByCode', [id, code],
  );
  if (res?.error) throw new Error(res.error);
  if (!res?.['удалён']) throw new Error('Не удалось удалить аккаунт');
}

/**
 * Загрузить фото или голосовое из переписки.
 *
 * Возвращает путь, а не ссылку: файл лежит в закрытом бакете, и ссылку на
 * него надо просить отдельно, перед самым показом. Раньше эти файлы шли в
 * публичный бакет `avatars`, откуда ссылка открывалась кем угодно, без
 * авторизации и навсегда.
 */
export async function dbUploadChatMedia(
  fileName: string, bytes: Uint8Array, contentType: string,
): Promise<string> {
  const res = await proxy<{ path?: string; error?: string }>(
    'dbUploadChatMedia', [fileName, bytesToBase64(bytes), contentType],
  );
  if (res?.error || !res?.path) throw new Error(res?.error ?? 'Не удалось загрузить файл');
  return res.path;
}

/**
 * Ссылка на файл переписки — подписанная, на час.
 *
 * Принимает и путь, и старую публичную ссылку целиком: в сообщениях,
 * отправленных до перехода на закрытый бакет, лежит именно она.
 */
export async function dbSignMedia(pathOrUrl: string): Promise<string | null> {
  try {
    const res = await proxy<{ url?: string }>('dbSignMedia', [pathOrUrl]);
    return res?.url ?? null;
  } catch {
    return null;
  }
}

/**
 * Записать, с какими редакциями документов человек согласился.
 *
 * Отпечаток берётся из сборки приложения, а не с сервера: человек принимал
 * то, что видел на своём экране. Если у него старая версия приложения со
 * старым текстом — запишется старая редакция, и это правда, а не досадная
 * неточность.
 *
 * Не бросает: регистрация уже прошла, и валить её из-за неудачной записи
 * нельзя — человек останется без аккаунта на ровном месте. Неудача попадёт
 * в журнал, а спросить согласие заново мы всё равно умеем.
 */
export async function dbRecordConsent(
  userId: string,
  stamp: string,
  docs: Record<string, string>,
  source: 'registration' | 'reconsent' = 'registration',
): Promise<void> {
  try {
    await proxy('dbRecordConsent', [userId, stamp, docs, source]);
  } catch (e) {
    console.warn('[consent] не записалось', e);
  }
}

/** Последнее принятое: что показать в профиле и спрашивать ли заново. */
export async function dbGetConsent(userId: string): Promise<{
  stamp: string; docs: Record<string, string>; source: string; accepted_at: string;
} | null> {
  return proxy('dbGetConsent', [userId]);
}

/**
 * Согласие на рекламную рассылку (38-ФЗ, ст. 18) — отдельное и необязательное.
 * `on` — последнее решение «да» на текущую редакцию документа.
 */
type MarketingConsent = {
  on: boolean;
  version: string | null;
  source: string | null;
  at: string | null;
  current: string;
};

export async function dbGetMarketingConsent(userId: string): Promise<MarketingConsent> {
  return proxy('dbGetMarketingConsent', [userId]);
}

/** Дать или отозвать. Бросает ошибку: переключатель должен показать правду. */
export async function dbSetMarketingConsent(
  userId: string,
  on: boolean,
  version: string,
  source: 'registration' | 'reconsent' | 'settings' = 'settings',
): Promise<MarketingConsent> {
  return proxy('dbSetMarketingConsent', [userId, on, version, source]);
}

export function dbWarmup(): void {
  fetch(`${API_BASE}/api/db.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-App-Secret': APP_SECRET, 'X-App-Version': APP_VERSION },
    body: JSON.stringify({ fn: 'dbWarmup', args: [] }),
  }).catch(() => {});
}

// ─── Vacancies ────────────────────────────────────────────────────────────────

function rowToVacancy(r: any): Vacancy {
  return {
    id: r.id,
    employerId: r.employer_id,
    company: r.company ? normalizeCompany(r.company) : '',
    title: r.title,
    workType: r.work_type,
    workTypeLabel: r.work_type_label,
    metroLineId: r.metro_line_id ?? '',
    metroStation: r.metro_station ?? '',
    date: r.date,
    timeStart: r.time_start ?? '',
    timeEnd: r.time_end ?? '',
    salary: r.salary,
    normsAndPay: r.norms_and_pay ?? '',
    address: r.address ?? '',
    lat: r.lat ?? undefined,
    lng: r.lng ?? undefined,
    workersNeeded: r.workers_needed,
    workersFound: r.workers_found,
    isUrgent: r.is_urgent,
    noExperienceNeeded: r.no_experience_needed,
    conditions: r.conditions ?? '',
    status: r.status,
    createdAt: r.created_at,
  };
}

export async function dbGetVacancies(): Promise<Vacancy[]> {
  const d = await proxy<any[]>('dbGetVacancies');
  return d.map(rowToVacancy);
}

export async function dbUpdateVacancy(id: string, patch: Partial<{ status: string; workers_found: number }>): Promise<void> {
  await proxy('dbUpdateVacancy', [id, patch]);
}

// ─── Likes ────────────────────────────────────────────────────────────────────

function rowToLike(r: any): Like {
  return {
    id: r.id,
    vacancyId: r.vacancy_id,
    workerId: r.worker_id,
    employerId: r.employer_id,
    workerLiked: r.worker_liked,
    employerLiked: r.employer_liked,
    workerSkipped: r.worker_skipped,
    isMatch: r.is_match,
    matchedAt: r.matched_at ?? undefined,
    workerConfirmed: r.worker_confirmed ?? false,
    employerConfirmed: r.employer_confirmed ?? false,
    workerRated: r.worker_rated ?? false,
    employerRated: r.employer_rated ?? false,
    shiftCompleted: r.shift_completed ?? false,
    cancelled: r.cancelled ?? false,
    outcome: r.outcome ?? undefined,
    lateMinutes: r.late_minutes ?? undefined,
    outcomeAt: r.outcome_at ?? undefined,
  };
}

export async function dbGetLikes(): Promise<Like[]> {
  const d = await proxy<any[]>('dbGetLikes');
  return d.map(rowToLike);
}

export async function dbGetLikesForUser(userId: string, role: 'worker' | 'employer'): Promise<Like[]> {
  const d = await proxy<any[]>('dbGetLikesForUser', [userId, role]);
  return d.map(rowToLike);
}

export async function dbGetVacancyStatsMap(): Promise<Record<string, { applicants: number; rejected: number; views: number }>> {
  return proxy<Record<string, { applicants: number; rejected: number; views: number }>>('dbGetVacancyStatsMap');
}

export async function dbGetVacancyViewers(vacancyId: string): Promise<string[]> {
  return proxy<string[]>('dbGetVacancyViewers', [vacancyId]);
}

export async function dbGetPermVacancyViewers(vacancyId: string): Promise<string[]> {
  return proxy<string[]>('dbGetPermVacancyViewers', [vacancyId]);
}

// ─── Событие «открыл приложение» (Фаза 1b) ───────────────────────────────────
// Стабильный анонимный id устройства: ставится один раз и переживает logout,
// поэтому один и тот же человек до и после регистрации — это одна строка воронки.
const ANON_KEY = 'jt-anon-id';
let anonCache: string | null = null;
async function getAnonId(): Promise<string> {
  if (anonCache) return anonCache;
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    let id = await AsyncStorage.getItem(ANON_KEY);
    if (!id) { id = uid() + uid(); await AsyncStorage.setItem(ANON_KEY, id); }
    anonCache = id;
    return id;
  } catch {
    // если хранилище недоступно — не блокируем, просто разовый id
    anonCache = anonCache || uid() + uid();
    return anonCache;
  }
}

// Fire-and-forget: логирует запуск приложения. role — в каком «мире» человек
// (worker/employer) или null, если ещё не выбрал. Никогда не бросает и не
// блокирует UI — аналитика не должна ронять приложение.
export async function dbLogOpen(userId: string | null, role: string | null, platform: string): Promise<void> {
  try {
    const anon = await getAnonId();
    await proxy('dbLogOpen', [anon, userId, role, platform]);
  } catch {
    /* глотаем — событие открытия не критично */
  }
}

type GuestEventType =
  | 'guest_started'
  | 'vacancy_impression'
  | 'apply_intent'
  | 'registration_started'
  | 'registration_completed'
  | 'campaign_published'
  | 'campaign_open'
  | 'campaign_apply'
  | 'campaign_shared';

interface GuestEventContext {
  vacancyId?: string | null;
  vacancyKind?: 'shift' | 'permanent' | null;
  campaignId?: string | null;
  channel?: 'telegram_group' | 'telegram_dm' | 'user_share' | null;
}

const GUEST_REGISTRATION_PENDING_KEY = 'jt-guest-registration-pending';

// Отдельная воронка гостевого режима. Передаём только случайный anon_id и
// технический контекст вакансии — без имени, телефона, IP или fingerprint.
export async function dbRecordGuestEvent(
  eventType: GuestEventType,
  context: GuestEventContext = {},
): Promise<void> {
  try {
    const anon = await getAnonId();
    await proxy('guestEvent', [
      anon,
      eventType,
      context.vacancyId ?? null,
      context.vacancyKind ?? null,
      Platform.OS,
      context.campaignId ?? null,
      context.channel ?? null,
    ]);
  } catch {
    /* аналитика не должна мешать просмотру и регистрации */
  }
}

export async function dbStartGuestRegistration(context: GuestEventContext = {}): Promise<void> {
  try {
    // Храним только технический контекст источника. Имя, телефон и будущий
    // user_id сюда не попадают, поэтому атрибуция остаётся анонимной.
    await AsyncStorage.setItem(
      GUEST_REGISTRATION_PENDING_KEY,
      JSON.stringify({
        vacancyId: context.vacancyId ?? null,
        vacancyKind: context.vacancyKind ?? null,
        campaignId: context.campaignId ?? null,
        channel: context.channel ?? null,
      }),
    );
  } catch {}
  await Promise.all([
    dbRecordGuestEvent('apply_intent', context),
    dbRecordGuestEvent('registration_started', context),
  ]);
}

export async function dbCompleteGuestRegistration(): Promise<void> {
  try {
    const pending = await AsyncStorage.getItem(GUEST_REGISTRATION_PENDING_KEY);
    if (!pending) return;

    // Значение '1' оставалось у пользователей старой версии. Принимаем его
    // как пустой контекст, чтобы их завершённая регистрация не потерялась.
    let context: GuestEventContext = {};
    if (pending !== '1') {
      try {
        const parsed = JSON.parse(pending);
        if (parsed && typeof parsed === 'object') context = parsed as GuestEventContext;
      } catch {
        context = {};
      }
    }
    await dbRecordGuestEvent('registration_completed', context);
    await AsyncStorage.removeItem(GUEST_REGISTRATION_PENDING_KEY);
  } catch {
    /* повторим при следующей успешной регистрации, если хранилище доступно */
  }
}

export async function dbGetPermVacancyViewsMap(): Promise<Record<string, number>> {
  return proxy<Record<string, number>>('dbGetPermVacancyViewsMap');
}

export async function dbRecordPermVacancyView(vacancyId: string, workerId: string): Promise<void> {
  await proxy('dbRecordPermVacancyView', [vacancyId, workerId]);
}

export async function dbGetLikeByVacancyWorker(vacancyId: string, workerId: string): Promise<Like | null> {
  const d = await proxy<any>('dbGetLikeByVacancyWorker', [vacancyId, workerId]);
  return d ? rowToLike(d) : null;
}

export async function dbUpsertLike(
  vacancyId: string,
  workerId: string,
  employerId: string,
  /**
   * Сервер принимает отсюда только три поля: workerLiked, workerSkipped,
   * employerLiked. Остальные он ставит сам в своих обработчиках.
   *
   * Об отказе он тоже пишет сам — строкой в переписку, со всех экранов, где
   * отказывают. Просить его об этом не нужно.
   */
  updates: Partial<Like>
): Promise<Like> {
  const d = await proxy<any>('dbUpsertLike', [vacancyId, workerId, employerId, updates]);
  return rowToLike(d);
}

// ─── Messages ─────────────────────────────────────────────────────────────────

function rowToMessage(r: any): Message {
  return {
    id: r.id,
    senderId: r.sender_id,
    text: r.text,
    timestamp: r.created_at,
  };
}

export async function dbGetMessages(chatId: string): Promise<Message[]> {
  const d = await proxy<any[]>('dbGetMessages', [chatId]);
  return d.map(rowToMessage);
}

export async function dbInsertMessage(chatId: string, senderId: string, text: string): Promise<Message> {
  // ID рождается до proxy(): внутренняя повторная попытка запроса использует
  // те же args, поэтому потерянный HTTP-ответ не создаёт второе сообщение.
  const messageId = uid();
  const d = await proxy<any>('dbInsertMessage', [chatId, senderId, text, messageId]);
  return rowToMessage(d);
}

// ─── Файлы ────────────────────────────────────────────────────────────────────

/**
 * Кладёт файл в хранилище и возвращает ссылку на него.
 *
 * Через прокси, а не напрямую: ключ, которым приложение обращалось к
 * хранилищу, лежит в каждой установленной сборке. Чтобы загрузка работала,
 * ему нужно право записи — то есть любой, кто достанет ключ, мог бы залить
 * в наше хранилище что угодно. Здесь же вместо этого проверяется пропуск
 * приложения, а служебный ключ не покидает сервер.
 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  // Своими руками, а не через btoa: на телефоне такой глобальной функции
  // может не оказаться вовсе, а отдельную библиотеку ради двенадцати строк
  // тащить незачем. Ошибка здесь проявилась бы только у людей на устройствах
  // и выглядела бы как «фото не отправляется», без всякой подсказки.
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

export async function dbUploadFile(
  fileName: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const res = await proxy<{ url?: string; error?: string }>(
    'dbUploadFile', [fileName, bytesToBase64(bytes), contentType],
  );
  if (!res?.url) throw new Error(res?.error || 'Файл не загрузился');
  return res.url;
}

export type ResumeVaultItem = {
  id: string;
  fileName: string;
  storagePath: string;
  resume: ResumeProfile;
  importedAt: string;
  selected: boolean;
};

function rowToResumeVaultItem(row: any): ResumeVaultItem {
  const data = row?.resume_data && typeof row.resume_data === 'object' ? row.resume_data : {};
  return {
    id: String(row?.id ?? ''),
    fileName: String(row?.file_name ?? ''),
    storagePath: String(row?.storage_path ?? ''),
    importedAt: String(row?.imported_at ?? row?.created_at ?? ''),
    selected: row?.selected === true,
    resume: {
      ...data,
      specializations: Array.isArray(data.specializations) ? data.specializations : [],
      experience: Array.isArray(data.experience) ? data.experience : [],
      education: Array.isArray(data.education) ? data.education : [],
      projects: Array.isArray(data.projects) ? data.projects : [],
      exams: Array.isArray(data.exams) ? data.exams : [],
      languages: Array.isArray(data.languages) ? data.languages : [],
      skills: Array.isArray(data.skills) ? data.skills : [],
      interests: Array.isArray(data.interests) ? data.interests : [],
      certifications: Array.isArray(data.certifications) ? data.certifications : [],
      awards: Array.isArray(data.awards) ? data.awards : [],
      coursework: Array.isArray(data.coursework) ? data.coursework : [],
      ...(row?.resume_email ? { email: String(row.resume_email) } : {}),
      sourceFileName: String(row?.file_name ?? ''),
      importedAt: String(row?.imported_at ?? row?.created_at ?? ''),
    } as ResumeProfile,
  };
}

/** Приватный список PDF-резюме владельца. */
export async function dbGetResumeFiles(): Promise<ResumeVaultItem[]> {
  const rows = await proxy<any[]>('dbGetResumeFiles');
  return (rows ?? []).map(rowToResumeVaultItem);
}

/**
 * Сохранить исходный PDF и распознанные данные в приватном сейфе.
 * Новый файл сразу становится выбранным — профиль переключается на него.
 */
export async function dbSaveResumeFile(
  fileName: string,
  bytes: Uint8Array,
  resume: ResumeProfile,
): Promise<ResumeVaultItem> {
  const {
    email,
    sourceFileName: _sourceFileName,
    importedAt: _importedAt,
    ...publicResume
  } = resume;
  const row = await proxy<any>('dbSaveResumeFile', [
    fileName,
    bytesToBase64(bytes),
    publicResume,
    email ?? null,
  ]);
  return rowToResumeVaultItem(row);
}

/** Выбрать резюме: сервер сразу синхронизирует его с публичным профилем. */
export async function dbSelectResumeFile(id: string): Promise<ResumeVaultItem> {
  const row = await proxy<any>('dbSelectResumeFile', [id]);
  return rowToResumeVaultItem(row);
}

/**
 * Удалить PDF. Если удалялся выбранный, сервер сам выбирает следующий
 * доступный и возвращает его; null означает, что резюме больше нет.
 */
export async function dbDeleteResumeFile(id: string): Promise<ResumeVaultItem | null> {
  const row = await proxy<any | null>('dbDeleteResumeFile', [id]);
  return row ? rowToResumeVaultItem(row) : null;
}

/** Короткоживущая приватная ссылка для просмотра PDF. */
export async function dbSignResumeFile(id: string): Promise<string> {
  const res = await proxy<{ url?: string; error?: string }>('dbSignResumeFile', [id]);
  if (!res?.url) throw new Error(res?.error || 'Не удалось открыть PDF');
  return res.url;
}

/**
 * Сохранить файл сертификата в закрытом бакете `resume-files`
 * (`certificate/<uid>/<id>.<ext>`). Тип определяет сервер по байтам.
 */
export async function dbSaveCertificateFile(
  fileName: string,
  base64: string,
): Promise<{ path: string; fileName: string }> {
  const res = await proxy<{ path?: string; fileName?: string; error?: string }>('dbSaveCertificateFile', [
    fileName,
    base64,
  ]);
  if (!res?.path) throw new Error(res?.error || 'Не удалось сохранить файл');
  return { path: res.path, fileName: res.fileName ?? fileName };
}

/** Короткоживущая приватная ссылка на файл сертификата — открывает только сам соискатель. */
export async function dbSignCertificateFile(path: string): Promise<string> {
  const res = await proxy<{ url?: string; error?: string }>('dbSignCertificateFile', [path]);
  if (!res?.url) throw new Error(res?.error || 'Не удалось открыть файл');
  return res.url;
}

/** Удалить файл сертификата из закрытого бакета. */
export async function dbDeleteCertificateFile(path: string): Promise<void> {
  await proxy<{ ok?: boolean; error?: string }>('dbDeleteCertificateFile', [path]);
}

// ─── Chats ────────────────────────────────────────────────────────────────────

function rowToChat(r: any, messages: Message[] = []): Chat {
  return {
    id: r.id,
    vacancyId: r.vacancy_id,
    workerId: r.worker_id,
    employerId: r.employer_id,
    vacTitle: r.vac_title ?? '',
    companyName: r.company_name ? normalizeCompany(r.company_name) : '',
    messages,
    unreadWorker: r.unread_worker ?? 0,
    unreadEmployer: r.unread_employer ?? 0,
    workerReadAt: r.worker_read_at ?? undefined,
    employerReadAt: r.employer_read_at ?? undefined,
    createdAt: r.created_at,
    bulletinId: r.bulletin_id ?? undefined,
    isLocked: r.is_locked ?? false,
  };
}

export async function dbGetChats(userId: string, role: 'worker' | 'employer'): Promise<Chat[]> {
  const rows = await proxy<any[]>('dbGetChats', [userId, role]);
  return rows.map(row => {
    const last = row._last_msg;
    return rowToChat(row, last ? [rowToMessage(last)] : []);
  });
}

export async function dbGetChatById(chatId: string): Promise<Chat | null> {
  const result = await proxy<any>('dbGetChatById', [chatId]);
  if (!result) return null;
  const { _messages, ...row } = result;
  return rowToChat(row, (_messages ?? []).map(rowToMessage));
}

export async function dbCreateChat(
  workerId: string,
  employerId: string,
  vacancyId: string,
  vacTitle: string,
  companyName: string,
  systemMessage?: string,
  initialUnreadWorker = 0,
  initialUnreadEmployer = 0,
  /**
   * Кто написал первое сообщение: `true` или `'worker'` — работник,
   * `'employer'` — работодатель, иначе система.
   *
   * Без этого признака сообщение уходило от «system» и выглядело
   * автоответчиком, на который никто не отвечает.
   */
  author: boolean | 'worker' | 'employer' = false,
): Promise<string> {
  const canonicalCompanyName = companyName ? normalizeCompany(companyName) : companyName;
  return proxy<string>('dbCreateChat', [
    workerId, employerId, vacancyId, vacTitle, canonicalCompanyName,
    systemMessage, initialUnreadWorker, initialUnreadEmployer, author,
  ]);
}

export async function dbMarkRead(chatId: string, role: 'worker' | 'employer'): Promise<void> {
  await proxy('dbMarkRead', [chatId, role]);
}

export async function dbDeleteChat(chatId: string): Promise<void> {
  await proxy('dbDeleteChat', [chatId]);
}

// ─── Saved ────────────────────────────────────────────────────────────────────

export async function dbGetSaved(userId: string): Promise<string[]> {
  return proxy<string[]>('dbGetSaved', [userId]);
}

// ─── Complaints ───────────────────────────────────────────────────────────────

// ─── Match logic ──────────────────────────────────────────────────────────────

export async function dbCheckAndCreateMatch(
  vacancyId: string,
  workerId: string
): Promise<{ matched: boolean; chatId?: string }> {
  const data = await proxy<{ matched?: boolean; chatId?: string | null }>(
    'dbCheckAndCreateMatch',
    [vacancyId, workerId],
  );
  return data?.chatId
    ? { matched: data.matched === true, chatId: data.chatId }
    : { matched: data?.matched === true };
}

// ─── Permanent vacancies ─────────────────────────────────────────────────────

function rowToPermVacancy(r: any): PermVacancy {
  return {
    id: r.id,
    employerId: r.employer_id,
    company: r.company ? normalizeCompany(r.company) : '',
    title: r.title,
    workType: r.work_type ?? undefined,
    metroLineId: r.metro_line_id ?? undefined,
    metroStation: r.metro_station ?? undefined,
    address: r.address ?? undefined,
    lat: r.lat ?? undefined,
    lng: r.lng ?? undefined,
    salary: r.salary,
    schedule: r.schedule ?? '',
    description: r.description ?? undefined,
    status: r.status,
    createdAt: r.created_at,
  };
}

export async function dbGetPermVacancies(): Promise<PermVacancy[]> {
  const d = await proxy<any[]>('dbGetPermVacancies');
  return d.map(rowToPermVacancy);
}

export async function dbGetPermVacanciesByEmployer(employerId: string): Promise<PermVacancy[]> {
  const d = await proxy<any[]>('dbGetPermVacanciesByEmployer', [employerId]);
  return d.map(rowToPermVacancy);
}

export async function dbUpsertPermVacancy(v: PermVacancy): Promise<void> {
  const permRow = {
    id: v.id, employer_id: v.employerId, company: v.company ? normalizeCompany(v.company) : v.company, title: v.title,
    work_type: v.workType ?? null, metro_line_id: v.metroLineId ?? null,
    metro_station: v.metroStation ?? null, address: v.address ?? null,
    lat: v.lat ?? null, lng: v.lng ?? null,
    salary: v.salary, schedule: v.schedule, description: v.description ?? null,
    status: v.status, created_at: v.createdAt,
  };
  await proxy('dbUpsertPermVacancy', [permRow]);
}

export async function dbClosePermVacancy(id: string): Promise<void> {
  await proxy('dbClosePermVacancy', [id]);
}

export async function dbDeletePermVacancy(id: string): Promise<void> {
  await proxy('dbDeletePermVacancy', [id]);
}

// ─── Permanent applications ───────────────────────────────────────────────────

function rowToPermApp(r: any): PermApplication {
  return {
    id: r.id,
    vacancyId: r.vacancy_id,
    workerId: r.worker_id,
    employerId: r.employer_id,
    status: r.status as PermApplicationStatus,
    createdAt: r.created_at,
  };
}

export async function dbGetPermApplications(userId: string, role: 'worker' | 'employer'): Promise<PermApplication[]> {
  const d = await proxy<any[]>('dbGetPermApplications', [userId, role]);
  return d.map(rowToPermApp);
}

export async function dbApplyPermVacancy(
  vacancyId: string, workerId: string, employerId: string,
  /** Живая строка от работника — с ней отклик открывает переписку. */
  message?: string,
): Promise<void> {
  await proxy('dbApplyPermVacancy', [vacancyId, workerId, employerId, message]);
}

/**
 * Одобрить кандидата и открыть разговор одним серверным действием.
 *
 * Всегда через proxy, даже в web: status + chat + первое сообщение должны
 * коммититься одной транзакцией, чего два прямых Supabase-запроса не дают.
 */
export async function dbApprovePermApplication(appId: string, message: string): Promise<string> {
  const d = await proxy<{ chat_id?: string }>('dbApprovePermApplication', [appId, message]);
  if (!d?.chat_id) throw new Error('Не удалось открыть чат после одобрения');
  return d.chat_id;
}

export async function dbSetPermApplicationStatus(appId: string, status: PermApplicationStatus): Promise<void> {
  await proxy('dbSetPermApplicationStatus', [appId, status]);
}

// ─── Permanent saved ──────────────────────────────────────────────────────────

export async function dbGetPermSaved(userId: string): Promise<string[]> {
  return proxy<string[]>('dbGetPermSaved', [userId]);
}

/**
 * То же избранное, но с датой сохранения.
 *
 * Отдельной функцией, а не расширением dbGetPermSaved: тот отдаёт голый
 * список id, на нём стоит вся отметка «сохранено» в ленте, и менять его форму
 * значило бы переписать десяток мест ради одного экрана. Дата нужна только
 * там, где избранное группируется по дням.
 */
export async function dbGetPermSavedDetailed(
  userId: string,
): Promise<{ vacancyId: string; savedAt: string | null }[]> {
  return proxy('dbGetPermSavedDetailed', [userId]);
}

// ── Заявки Jupiter на внешних сайтах ────────────────────────────────────────
//
// Только через прокси: таблица закрыта построчной защитой, и ходить в неё
// публичным ключом нечем. Прямого обращения к supabase здесь нет.

function toJupiterApplication(row: any): JupiterApplication {
  if (!row || typeof row.id !== 'string' || !row.id || typeof row.state !== 'string') {
    throw new Error('Сервер вернул неполную заявку Jupiter. Обновите страницу и попробуйте ещё раз.');
  }
  return {
    id: String(row.id),
    vacancyUrl: String(row.vacancy_url ?? ''),
    company: row.company ?? null,
    vacancyTitle: row.vacancy_title ?? null,
    vacancyActive: typeof row.vacancy_active === 'boolean' ? row.vacancy_active : null,
    state: (row.state ?? 'queued') as JupiterApplication['state'],
    reasonCode: row.reason_code ?? null,
    resumeToken: row.resume_token ?? null,
    externalApplicationId: row.external_application_id ?? null,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    submittedAt: row.submitted_at ?? null,
    verifiedAt: row.verified_at ?? null,
    submissionAuthorizedAt: row.submission_authorized_at ?? null,
    thirdPartyConsentAt: row.third_party_consent_at ?? null,
    thirdPartyTermsUrl: row.third_party_terms_url ?? null,
  };
}

/**
 * Остаток дневного запаса откликов по счёту сервера — за московские сутки и
 * на всех устройствах сразу (php-proxy/energy.php). Сервер и сам не примет
 * отклик сверх запаса; это число нужно, чтобы шапка ленты не обещала лишнего.
 */
export async function dbEnergyLeft(userId: string): Promise<number> {
  const data = await proxy('dbEnergyLeft', [userId]) as { left?: unknown } | null;
  const left = Number(data?.left);
  if (!Number.isFinite(left)) throw new Error('Нет остатка откликов в ответе сервера');
  return left;
}

/**
 * Поставить внешнюю вакансию в очередь Jupiter.
 *
 * Повторный вызов по тому же адресу возвращает прежнюю заявку, а не заводит
 * вторую: человек мог нажать дважды, и это не повод отправить работодателю
 * второй отклик.
 */
export async function jupiterEnqueue(
  userId: string,
  vacancyUrl: string,
  company?: string,
): Promise<JupiterApplication> {
  const row = await proxy('jupiterEnqueue', [userId, vacancyUrl, company ?? '']);
  return toJupiterApplication(row);
}

export async function jupiterMyApplications(
  userId: string,
): Promise<JupiterApplication[]> {
  const rows = (await proxy('jupiterMyApplications', [userId])) as any[];
  if (!Array.isArray(rows)) {
    throw new Error('Сервер не вернул список заявок Jupiter. Попробуйте обновить экран.');
  }
  return rows.map(toJupiterApplication);
}

/** История своего отклика для карточки (шаги пишет триггер базы). */
export async function jupiterApplicationEvents(
  userId: string,
  applicationId: string,
): Promise<JupiterEvent[]> {
  const rows = await proxy('jupiterApplicationEvents', [userId, applicationId]);
  return Array.isArray(rows) ? (rows as JupiterEvent[]) : [];
}

export async function jupiterLiveStatus(userId: string): Promise<boolean> {
  const result = await proxy<{ enabled: boolean }>('jupiterLiveStatus', [userId]);
  return result?.enabled === true;
}

/**
 * Состояние поручения на автоотклик: включён и, отдельно, отозван ли он.
 *
 * `revoked` — не просто «не включён»: старые сборки сервера его не отдают
 * (см. jupiterLiveStatus в php-proxy/db.php), поэтому здесь по умолчанию
 * false, а не неизвестно.
 */
export async function jupiterLiveState(
  userId: string,
): Promise<{ enabled: boolean; revoked: boolean; serverSends: boolean }> {
  const result = await proxy<{ enabled?: boolean; revoked?: boolean; serverSends?: boolean }>('jupiterLiveStatus', [userId]);
  // serverSends — Юпитер отправляет с сервера; старый сервер его не отдаёт → false.
  return { enabled: result?.enabled === true, revoked: result?.revoked === true, serverSends: result?.serverSends === true };
}

export type JupiterEmail = {
  id: string; sender: string; subject: string; body: string;
  received_at: string; read_at: string | null;
};

export async function jupiterMailbox(userId: string): Promise<{ address: string | null; ready: boolean }> {
  return proxy('jupiterMailbox', [userId]);
}

export async function jupiterMailList(userId: string): Promise<JupiterEmail[]> {
  return proxy('jupiterMailList', [userId]);
}

/** Письмо целиком (HTML) — для показа как в почте. Пусто — у письма нет HTML-версии. */
export async function jupiterMailHtml(userId: string, id: string): Promise<string> {
  const r = await proxy<{ html?: string }>('jupiterMailHtml', [userId, id]);
  return typeof r?.html === 'string' ? r.html : '';
}

/** Сколько непрочитанных писем на почте JobToo для откликов (для точки на конверте). */
export async function jupiterMailUnread(userId: string): Promise<number> {
  const r = await proxy<{ unread?: number }>('jupiterMailUnread', [userId]);
  return typeof r?.unread === 'number' ? r.unread : 0;
}

export async function jupiterMailRead(userId: string, id: string): Promise<void> {
  await proxy('jupiterMailRead', [userId, id]);
}

export async function jupiterSetLive(userId: string, enabled: boolean): Promise<void> {
  await proxy('jupiterSetLive', [userId, enabled]);
}

export async function jupiterRequeueLive(userId: string, applicationId: string): Promise<JupiterApplication> {
  return toJupiterApplication(await proxy('jupiterRequeueLive', [userId, applicationId]));
}

/** Собственные поля человека для ручного заполнения анкеты в WebView. */
export type JupiterFillProfile = {
  first_name: string | null;
  last_name: string | null;
  patronymic: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  citizenship: string | null;
  desired_role: string | null;
  /**
   * Подписанная ссылка на выбранное PDF-резюме и имя файла — чтобы экран
   * «Ждут вас» приложил его к анкете сам. В страницу работодателя ссылка не
   * передаётся: приложение скачивает файл и вкладывает его содержимое.
   */
  resume_url?: string | null;
  resume_name?: string | null;
  /** «Ответьте один раз» — подставляет приложение из профиля, не сервер. */
  desired_salary?: string;
  notice_period?: string;
  telegram?: string;
  english_level?: string;
  relocation?: string;
  work_format?: string;
};

/**
 * Подсказки полей анкеты от сервера (YandexGPT). Уходят только подписи полей —
 * без значений и данных человека; приходит ключ профиля или null.
 */
export async function jupiterFieldHints(
  host: string,
  fields: { sig: string; label: string; name: string; type: string; options: string[] }[],
): Promise<Record<string, string | null>> {
  const d = await proxy<{ hints?: Record<string, string | null> }>('jupiterFieldHints', [host, fields]);
  return d?.hints ?? {};
}

export async function jupiterFillProfile(userId: string): Promise<JupiterFillProfile> {
  return proxy('jupiterFillProfile', [userId]);
}

/** Человек сам прошёл капчу и нажал «Отправить» в WebView. */
export async function jupiterMarkManualSubmitted(
  userId: string,
  applicationId: string,
): Promise<JupiterApplication> {
  return toJupiterApplication(await proxy('jupiterMarkManualSubmitted', [userId, applicationId]));
}

export async function jupiterGrantThirdPartyConsent(
  userId: string,
  applicationId: string,
  termsUrl: string,
): Promise<JupiterApplication> {
  return toJupiterApplication(
    await proxy('jupiterGrantThirdPartyConsent', [userId, applicationId, termsUrl]),
  );
}

function toExtVacancy(row: any): ExtVacancy {
  return {
    id: String(row.id),
    sourceId: String(row.source_id ?? ''),
    externalId: String(row.external_id ?? ''),
    title: String(row.title ?? ''),
    company: String(row.company ?? ''),
    metroStation: row.metro_station ?? null,
    metroLineId: row.metro_line_id ?? null,
    workType: row.work_type ?? null,
    section: row.section ?? null,
    address: row.address ?? null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    salary: row.salary != null ? Number(row.salary) : null,
    payPeriod: row.pay_period ?? null,
    schedule: row.schedule ?? null,
    description: row.description ?? null,
    url: String(row.url ?? ''),
    autoApply: row.auto_apply !== false,
    active: !!row.active,
    firstSeenAt: String(row.first_seen_at ?? ''),
    lastSeenAt: String(row.last_seen_at ?? ''),
  };
}

/**
 * Фильтры ленты (зарплата, уровень, формат, специализация, компания, дата) —
 * теперь ищут по всей базе на сервере (php-proxy/ext_feed.php), а не только
 * по уже полученной порции: раньше выбор компании, которой не было в порции,
 * давал пустую колоду, хотя в базе вакансии есть.
 */
export type ExtFeedFilters = {
  salaryFrom: number;
  specs: VacancySpec[];
  levels: VacancyLevel[];
  formats: VacancyFormat[];
  companies: string[];
  posted: 'all' | 'day' | '3days' | 'week' | 'month';
  /** Поиск «Вакансия или стек»: все слова в названии, компании или описании. */
  query?: string;
  salaryKnown?: boolean;
  hideSeen?: boolean;
};

/**
 * Логотипы компаний из базы (миграция 144): {компания в нижнем регистре:
 * ссылка на PNG 256×256}. Открытая функция — ленту видят и гости.
 */
export async function dbCompanyLogos(): Promise<Record<string, string>> {
  const d = await proxy<{ logos?: Record<string, string> }>('dbCompanyLogos', []);
  return d?.logos && typeof d.logos === 'object' ? d.logos : {};
}

/**
 * Порция ленты карьерных вакансий под человека: без уже свайпнутых, с
 * чередованием компаний и учётом вкуса (php-proxy/ext_feed.php). Вместо
 * всего каталога — ~60 карточек за раз. `total` и `companies` считаются по
 * всему пулу на сервере — честные, а не только по вернувшейся порции.
 */
export async function dbGetExtFeed(
  limit = 60,
  filters: ExtFeedFilters,
): Promise<{ items: ExtVacancy[]; total: number; companies: { company: string; count: number }[] }> {
  const res = await proxy('dbGetExtFeed', [limit, [], {
    salary_from: filters.salaryFrom,
    specs: filters.specs,
    levels: filters.levels,
    formats: filters.formats,
    companies: filters.companies,
    posted: filters.posted,
    query: filters.query ?? '',
    salary_known: filters.salaryKnown ?? false,
    hide_seen: filters.hideSeen ?? true,
  }]);
  // Старый сервер без OTA отвечает голым массивом — устойчиво читаем и так.
  if (Array.isArray(res)) return { items: res.map(toExtVacancy), total: res.length, companies: [] };
  const r = (res ?? {}) as any;
  const items = (Array.isArray(r.items) ? r.items : []).map(toExtVacancy);
  return {
    items,
    total: typeof r.total === 'number' ? r.total : items.length,
    companies: Array.isArray(r.companies)
      ? r.companies.map((c: any) => ({ company: String(c.company ?? ''), count: Number(c.count ?? 0) }))
      : [],
  };
}

/** Закладки карьерных вакансий (миграция 129): свежие сверху, с вакансией. */
export async function dbGetExtSaved(userId: string): Promise<{ vacancy: ExtVacancy; savedAt: string | null }[]> {
  const rows = await proxy<any[]>('dbGetExtSaved', [userId]);
  return (Array.isArray(rows) ? rows : []).map(r => ({ vacancy: toExtVacancy(r), savedAt: r.saved_at ?? null }));
}

export async function dbAddExtSaved(userId: string, vacancyId: string): Promise<void> {
  await proxy('dbAddExtSaved', [userId, vacancyId]);
}

export async function dbRemoveExtSaved(userId: string, vacancyId: string): Promise<void> {
  await proxy('dbRemoveExtSaved', [userId, vacancyId]);
}

/**
 * Кнопка «Показать N вакансий» на экране фильтров: тот же фильтр, что у
 * dbGetExtFeed, но сервер отдаёт только число (dbCountExtFeed).
 */
export async function dbCountExtFeed(filters: ExtFeedFilters): Promise<number> {
  const res = await proxy<{ total?: number }>('dbCountExtFeed', [10, [], {
    salary_from: filters.salaryFrom,
    specs: filters.specs,
    levels: filters.levels,
    formats: filters.formats,
    companies: filters.companies,
    posted: filters.posted,
    query: filters.query ?? '',
    salary_known: filters.salaryKnown ?? false,
    hide_seen: filters.hideSeen ?? true,
  }]);
  return typeof res?.total === 'number' ? res.total : 0;
}

/** Свайп по карьерной вакансии: 1 — вправо, -1 — влево. */
export async function dbExtSwipe(userId: string, vacancyId: string, dir: 1 | -1): Promise<void> {
  await proxy('dbExtSwipe', [userId, vacancyId, dir]);
}

export async function dbExtUnswipe(userId: string, vacancyId: string): Promise<void> {
  await proxy('dbExtUnswipe', [userId, vacancyId]);
}

/** Свайп по своей вакансии JobToo: близнец dbExtSwipe для jm_perm_vacancies. */
export async function dbPermSwipe(userId: string, vacancyId: string, dir: 1 | -1): Promise<void> {
  await proxy('dbPermSwipe', [userId, vacancyId, dir]);
}

export async function dbPermUnswipe(userId: string, vacancyId: string): Promise<void> {
  await proxy('dbPermUnswipe', [userId, vacancyId]);
}

export async function dbGetPermSwipes(userId: string): Promise<{ vacancyId: string; dir: 1 | -1 }[]> {
  const rows = (await proxy('dbGetPermSwipes', [userId])) as any[];
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    vacancyId: String(r.vacancy_id),
    dir: (Number(r.dir) > 0 ? 1 : -1) as 1 | -1,
  }));
}

export async function dbGetExtVacancies(company?: string): Promise<ExtVacancy[]> {
  const rows = (await proxy('dbGetExtVacancies', company ? [company] : [])) as any[];
  return (rows ?? []).map(toExtVacancy);
}

export async function dbAddPermSaved(userId: string, vacancyId: string): Promise<void> {
  await proxy('dbAddPermSaved', [userId, vacancyId]);
}

export async function dbRemovePermSaved(userId: string, vacancyId: string): Promise<void> {
  await proxy('dbRemovePermSaved', [userId, vacancyId]);
}

// ─── Ratings ──────────────────────────────────────────────────────────────────

export interface UserRating {
  id: string;
  rating: number;
  reviewText?: string;
  role: 'worker' | 'employer';
  createdAt: string;
  /**
   * Кто оценил и за какую смену. Приходят ТОЛЬКО когда спрашиваешь отзывы о
   * себе: на своём профиле приложение показывает имя оценившего, на чужом
   * отзывы анонимны — звёзды, роль, дата, текст. Сервер отдаёт ровно столько,
   * сколько рисует экран, иначе обещанная анонимность снимается одним
   * запросом.
   */
  fromUserId?: string;
  vacancyId?: string;
}

export async function dbGetRatingsForUser(toUserId: string): Promise<UserRating[]> {
  const d = await proxy<any[]>('dbGetRatingsForUser', [toUserId]);
  return d.map((r: any) => ({ id: r.id, fromUserId: r.from_user_id, rating: r.rating, reviewText: r.review_text ?? undefined, role: r.role, createdAt: r.created_at, vacancyId: r.vacancy_id }));
}

// ─── Итог смены ───────────────────────────────────────────────────────────────

/**
 * Отметить, чем кончилась смена. Заменяет прежнюю пару «подтвердить /
 * отменить»: подтверждение теперь несёт ещё и опоздание, а отмена — причину.
 *
 * Старые колонки заполняем здесь же. Весь экран «Мэтчи» читает
 * `shiftCompleted` и `cancelled`, и если бы источником правды стал только
 * `outcome`, смена после отметки просто осталась бы висеть активной.
 */
export async function dbSetShiftOutcome(
  likeId: string,
  outcome: ReportableOutcome,
  opts: { lateMinutes?: number; by?: string } = {}
): Promise<void> {
  await proxy('dbSetShiftOutcome', [likeId, outcome, opts]);
}

// ─── Rating & match deletion ──────────────────────────────────────────────────

export async function dbSubmitRatingAndMaybeDelete(params: {
  likeId: string;
  fromUserId: string;
  toUserId: string;
  vacancyId: string;
  rating: number;
  role: 'worker' | 'employer';
  reviewText?: string;
  /** Когда работодатель оценивает работника; 1–5, необязательно. */
  quality?: number;
  speed?: number;
  /** Когда работник оценивает работодателя; 1–5, необязательно. */
  matchedDesc?: number;
  attitude?: number;
  paidOnTime?: number;
}): Promise<{ bothRated: boolean }> {
  return proxy<{ bothRated: boolean }>('dbSubmitRatingAndMaybeDelete', [params]);
}

// ─── Push tokens ──────────────────────────────────────────────────────────────

export async function dbSavePushToken(userId: string, token: string): Promise<void> {
  await proxy('dbSavePushToken', [userId, token]);
}

/**
 * Отвязать устройство от аккаунта при выходе.
 *
 * Токен лежит в строке пользователя, и пока он там, сервер шлёт на этот
 * телефон уведомления — даже если человек из аккаунта вышел, а приложение
 * оставил. Именно так уведомления и приходили «в никуда».
 */
export async function dbClearPushToken(userId: string): Promise<void> {
  await proxy('dbClearPushToken', [userId]);
}

/** Снять токен с любого аккаунта, за которым он записан. Аккаунт знать не нужно. */
export async function dbReleasePushToken(token: string): Promise<void> {
  await proxy('dbReleasePushToken', [token]);
}

/** То же для браузера: снимаем подписку на веб-пуши. */
export async function dbDeleteWebPushSubscription(userId: string): Promise<void> {
  await proxy('dbDeleteWebPushSubscription', [userId]);
}


// ─── In-app notifications ──────────────────────────────────────────────────────


/** Отметить, что пользователь сейчас в приложении. Ошибки глушим: это
 *  фоновая отметка, ради неё нельзя ломать экран. */
export async function dbTouchLastSeen(userId: string): Promise<void> {
  try {
    await proxy('dbTouchLastSeen', [userId]);
  } catch {
    // колонки может ещё не быть — молчим
  }
}

export async function dbGetNotifications(userId: string): Promise<{ id: string; title: string; body: string; is_read: boolean; created_at: string; type?: string | null; payload?: any }[]> {
  return proxy('dbGetNotifications', [userId]);
}

export async function dbMarkNotifRead(id: string): Promise<void> {
  await proxy('dbMarkNotifRead', [id]);
}

export async function dbMarkAllNotifsRead(userId: string): Promise<void> {
  await proxy('dbMarkAllNotifsRead', [userId]);
}

export async function dbDeleteNotif(id: string): Promise<void> {
  await proxy('dbDeleteNotif', [id]);
}

export async function dbDeleteAllNotifs(userId: string): Promise<void> {
  await proxy('dbDeleteAllNotifs', [userId]);
}

// ─── Подсказки адресов ───────────────────────────────────────────────────────

export type AddressSuggestion = { name: string; lat: number | null; lng: number | null };

export async function dbAddressSuggest(query: string): Promise<AddressSuggestion[]> {
  if (query.trim().length < 3) return [];
  // Ошибку сети не превращаем в []: вызывающему коду важно отличать
  // «ничего не найдено» от «подсказки сейчас не загрузились».
  return withTimeout(proxy<AddressSuggestion[]>('addressSuggest', [query]), 9000);
}

// ─── Telegram Mini App ────────────────────────────────────────────────────────

/** Sends a Telegram message to a user's linked account (bot notification) */

export async function dbAutoClosePastVacancies(): Promise<void> {
  await proxy('dbAutoClosePastVacancies');
}

// ─── Поддержка ────────────────────────────────────────────────────────────────

type SupportSender = 'user' | 'assistant' | 'operator' | 'system';

export type SupportMessage = {
  id: string;
  direction: 'in' | 'out';
  sender: SupportSender;
  text: string;
  createdAt: string;
};

export type SupportKnowledgeItem = {
  id: string;
  question: string;
  answer: string;
};

export type SupportState = {
  operatorRequestedAt: string | null;
  closedAt: string | null;
};

/** Переписка человека с помощником и оператором. Тред один на человека. */
export async function dbSupportHistory(userId: string): Promise<SupportMessage[]> {
  const rows = await proxy<any[]>('supportHistory', [userId]);
  return (rows ?? []).map(r => ({
    id: r.id,
    direction: r.direction === 'out' ? 'out' : 'in',
    sender: (
      r.sender === 'assistant' || r.sender === 'operator' || r.sender === 'system'
        ? r.sender
        : r.direction === 'out' ? 'operator' : 'user'
    ) as SupportSender,
    text: r.text,
    createdAt: r.created_at,
  }));
}

/** Актуальные подсказки/FAQ из серверной базы знаний для роли пользователя. */
export async function dbSupportKnowledge(): Promise<SupportKnowledgeItem[]> {
  const rows = await proxy<any[]>('supportKnowledge');
  return (rows ?? []).map(r => ({
    id: String(r.id ?? ''),
    question: String(r.question ?? ''),
    answer: String(r.answer ?? ''),
  })).filter(r => r.id && r.question && r.answer);
}

/** Состояние живого обращения оператору. */
export async function dbSupportState(userId: string): Promise<SupportState> {
  const row = await proxy<any>('supportState', [userId]);
  return {
    operatorRequestedAt: row?.operator_requested_at ?? null,
    closedAt: row?.closed_at ?? null,
  };
}

/**
 * Задать вопрос встроенному помощнику.
 * Ответ формирует только сервер из закрытой базы знаний — клиент не может
 * записать себе сообщение от имени помощника или оператора.
 */
export async function dbSupportAssistantAsk(
  userId: string,
  text: string,
): Promise<{ ok: boolean; matched: boolean }> {
  return proxy<{ ok: boolean; matched: boolean }>('supportAssistantAsk', [userId, text]);
}

/** Явно передать текущий диалог живому оператору. */
export async function dbSupportEscalate(userId: string, reason = ''): Promise<{ ok: boolean }> {
  return proxy<{ ok: boolean }>('supportEscalate', [userId, reason]);
}

/** Ждущая капча заявки (картинка PNG в base64) или null, если её нет/просрочена. */
export async function jupiterCaptchaGet(
  userId: string,
  applicationId: string,
): Promise<{ id: string; image_png: string; expires_at: string; kind?: string } | null> {
  const r = await proxy<{ id: string; image_png: string; expires_at: string; kind?: string } | null>(
    'jupiterCaptchaGet',
    [userId, applicationId],
  );
  return r ?? null;
}

/** Ответ на капчу заявки: слово до 64 символов или нажатия «x,y;x,y» (kind = tap). Просроченная даст ошибку 409. */
export async function jupiterCaptchaAnswer(
  userId: string,
  applicationId: string,
  answer: string,
): Promise<void> {
  await proxy('jupiterCaptchaAnswer', [userId, applicationId, answer]);
}

/** «Повторить капчу»: попросить Юпитера снять свежую капчу с сайта (картинка сменилась или ответ не подошёл). */
export async function jupiterCaptchaRefresh(userId: string, applicationId: string): Promise<void> {
  await proxy('jupiterCaptchaRefresh', [userId, applicationId]);
}

// ── Вопросы от работодателей (решение владельца 30.09.2026) ────────────────
// Юпитер собирает вопросы анкет, на которые нет ответа в профиле; человек
// отвечает здесь, отклик уходит сам. Факты сохраняются в банк ответов.

type JupiterQuestionType =
  | 'text' | 'text_long' | 'choice' | 'yesno' | 'date' | 'number' | 'phone' | 'email' | 'url';

export interface JupiterQuestion {
  id: string;
  application_id: string;
  /** Подпись поля на сайте работодателя — как есть. */
  question: string;
  /** Понятная формулировка от YandexGPT (миграция 138); null — не было. */
  display?: string | null;
  /** Пояснение, что туда обычно пишут; null — не было. */
  hint?: string | null;
  type: JupiterQuestionType;
  /** fact — сохранится и подставится сам; vacancy — только для этого отклика. */
  kind: 'fact' | 'vacancy';
  options: { value: string; label: string }[];
  /** Прежний ответ на этот вопрос — черновик, человек подтверждает или правит. */
  draft: string | null;
  company: string | null;
  vacancy_url: string | null;
  /** Сколько откликов ждут ответа на этот же вопрос. */
  applications_waiting: number;
}

export interface JupiterSavedAnswer {
  question_key: string;
  question_text: string;
  answer: string;
  updated_at: string;
}

/** Открытые вопросы работодателей по всем откликам человека. */
export async function jupiterQuestions(userId: string): Promise<JupiterQuestion[]> {
  return (await proxy<JupiterQuestion[]>('jupiterQuestions', [userId])) ?? [];
}

/** Ответ (для choice — подпись варианта). Вернёт, сколько откликов разблокировано. */
export async function jupiterAnswerQuestion(
  userId: string,
  questionId: string,
  answer: string,
): Promise<{ ok: boolean; applications: number }> {
  return proxy('jupiterAnswerQuestion', [userId, questionId, answer]);
}

/** «Пропустить»: этот вопрос человек заполнит на сайте сам. */
export async function jupiterSkipQuestion(userId: string, questionId: string): Promise<void> {
  await proxy('jupiterSkipQuestion', [userId, questionId]);
}

/** Банк ответов: что Юпитер подставит сам. */
export async function jupiterAnswers(userId: string): Promise<JupiterSavedAnswer[]> {
  return (await proxy<JupiterSavedAnswer[]>('jupiterAnswers', [userId])) ?? [];
}

export async function jupiterAnswerDelete(userId: string, questionKey: string): Promise<void> {
  await proxy('jupiterAnswerDelete', [userId, questionKey]);
}
