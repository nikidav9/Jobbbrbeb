import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';
import { User, Vacancy, Like, Chat, Message, PermVacancy, PermApplication, PermApplicationStatus, ReportableOutcome, WorkType } from '@/constants/types';
import { uid, nowISO } from '@/services/storage';
import { normalizeCompany } from '@/services/company';

const DB_TIMEOUT = 12_000;

// ─── Native API proxy ────────────────────────────────────────────────────────
// On Android/iOS the supabase-js client has connectivity issues.
// All DB calls go through the web API endpoint instead.

const IS_NATIVE = true; // always proxy through jobtoo.ru — Supabase is blocked in Russia from browsers
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
      // Не JSON — ответила не наша программа. Пробуем ещё раз, один.
      if (attempt === 0) { await new Promise(r => setTimeout(r, 600)); continue; }
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
    if (parsed?.error) throw new Error(parsed.error);
    return parsed?.data as T;
  }

  const head = text.trim().replace(/\s+/g, ' ').slice(0, 120);
  console.error(`[db] ${fn}: ответ не JSON (HTTP ${status}):`, text.slice(0, 500));
  throw new Error(head
    ? `Сервер ответил не по делу (${status}): ${head}`
    : `Сервер не ответил (${status}). Попробуйте ещё раз.`);
}

function withTimeout<T>(promise: PromiseLike<T>, ms = DB_TIMEOUT): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Нет ответа от сервера. Проверьте соединение.')), ms)
    ),
  ]);
}

function throwOnError(label: string, error: any): never {
  const msg = error?.message ?? String(error);
  console.error(`[db] ${label}:`, msg);
  throw new Error(msg);
}

// ─── Users ────────────────────────────────────────────────────────────────────

const PUBLIC_USER_COLUMNS = [
  'id', 'role', 'first_name', 'last_name', 'age', 'metro_line_id',
  'metro_station', 'work_types', 'company', 'bio', 'resume_data',
  'avatar_url', 'avg_rating', 'rating_count', 'is_blocked', 'created_at',
  'last_seen_at', 'referral_worked',
].join(',');

function rowToUser(r: any): User {
  return {
    id: r.id,
    role: r.role,
    phone: r.phone,
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
  /** Из них вышли на первую смену. Это и есть поручительство. */
  worked: number;
  /** И не вышли. Число неприятное, но без него первое ничего не значит. */
  noShow: number;
};

export async function dbGetMyReferral(userId: string): Promise<MyReferral | null> {
  if (!IS_NATIVE) return null;
  return await proxy<MyReferral>('dbGetMyReferral', [userId]);
}

export async function dbGetUserById(id: string): Promise<User | null> {
  if (IS_NATIVE) { const d = await proxy<any>('dbGetUserById', [id]); return d ? rowToUser(d) : null; }
  const { data } = await withTimeout(
    supabase.from('jm_users').select(PUBLIC_USER_COLUMNS).eq('id', id).maybeSingle()
  );
  return data ? rowToUser(data) : null;
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

/**
 * Отзывчивость сразу по всем — для карточек в ленте.
 *
 * Поштучно нельзя: на экране десяток вакансий, и запрос на каждую превратил бы
 * ленту в слайд-шоу. В карте только те, о ком есть что сказать: остальных в
 * ней просто нет.
 */
export type Responsiveness = { chats: number; answered: number; medianSeconds: number | null };

export async function dbResponsivenessMap(): Promise<Record<string, Responsiveness>> {
  try {
    return await proxy<Record<string, Responsiveness>>('dbResponsivenessMap');
  } catch {
    // Лента важнее подписи: не сложилось — карточки просто без неё.
    return {};
  }
}

export async function dbUserStats(userId: string): Promise<UserStats> {
  try {
    return await proxy<UserStats>('dbUserStats', [userId]);
  } catch {
    // Профиль важнее статистики: не сложилось — просто не показываем блок.
    return { enough: false };
  }
}

/** Только число пользователей — для приветственного экрана. */
export async function dbCountUsers(): Promise<number> {
  if (IS_NATIVE) { return proxy<number>('dbCountUsers'); }
  const { count } = await withTimeout(
    supabase.from('jm_users').select('id', { count: 'exact', head: true })
  );
  return count ?? 0;
}

export async function dbGetUsers(): Promise<User[]> {
  if (IS_NATIVE) { const d = await proxy<any[]>('dbGetUsers'); return d.map(rowToUser); }
  const { data, error } = await withTimeout(
    supabase.from('jm_users').select(PUBLIC_USER_COLUMNS).order('created_at', { ascending: true })
  );
  if (error) throwOnError('dbGetUsers', error);
  return (data ?? []).map(rowToUser);
}

/**
 * Вход. Пароль сверяет сервер и возвращает профиль уже без пароля.
 *
 * Раньше приложение спрашивало профиль по номеру телефона и сравнивало
 * пароль у себя — то есть пароль уходил наружу всякому, кто знает номер.
 */
export async function dbLogin(phone: string, password: string): Promise<User | null> {
  const d = await proxy<{ user?: any; session_token?: string } | null>('dbLogin', [phone, password]);
  if (!d?.user || !d.session_token) return null;
  await saveSessionToken(d.session_token);
  return rowToUser(d.user);
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

/** Смена пароля: старый сверяет сервер, новый он же и хеширует. */
export async function dbChangePassword(
  userId: string,
  oldPassword: string,
  newPassword: string
): Promise<{ ok: boolean; reason?: string }> {
  const res = await proxy<{ ok: boolean; reason?: string; session_token?: string | null }>(
    'dbChangePassword', [userId, oldPassword, newPassword]
  );
  // Смена пароля гасит все выданные токены, в том числе наш собственный:
  // сервер тут же выдаёт новый, и без этой строки человек, сменивший пароль,
  // оказывался бы выброшен из приложения.
  if (res?.session_token) await saveSessionToken(res.session_token);
  return res;
}

/**
 * Сохранить профиль; при РЕГИСТРАЦИИ — передать код приглашения.
 *
 * Код идёт отдельным доводом, а не полем профиля: поля профиля человек
 * назначает себе сам, а кто его привёл — решает сервер. Он же находит
 * владельца кода и записывает связь, и только один раз, при создании.
 */
export type ConsentPayload = {
  stamp: string;
  docs: Record<string, string>;
  /** Отдельное добровольное согласие на трансграничную передачу. */
  crossBorderVersion?: string;
};

export async function dbUpsertUser(
  u: User,
  referralCode?: string,
  consent?: ConsentPayload,
): Promise<void> {
  const { avg_rating, rating_count, ...row } = userToRow(u);
  // Пустой пароль не отправляем: он означает «профиль пришёл без пароля»
  // (вход его больше не отдаёт), а не «стереть пароль».
  if (!row.password) delete (row as Partial<typeof row>).password;
  if (IS_NATIVE) {
    // Согласие идёт ТЕМ ЖЕ запросом, что создаёт человека. Отдельным вызовом
    // оно терялось при любом обрыве связи, а запись согласия — доказательство,
    // а не аналитика.
    const args: unknown[] = consent
      ? [row, referralCode ?? '', consent]
      : (referralCode ? [row, referralCode] : [row]);
    const d = await proxy<{ session_token?: string | null }>('dbUpsertUser', args);
    if (d?.session_token) await saveSessionToken(d.session_token);
    return;
  }
  const { error } = await withTimeout(
    supabase.from('jm_users').upsert(row, { onConflict: 'id' })
  );
  if (error) throwOnError('dbUpsertUser', error);
}

/**
 * Удалить свой аккаунт.
 *
 * Только через прокси и только с паролем. Прежняя версия ходила в базу
 * напрямую анонимным ключом — а у него с миграции 013 нет прав на jm_users,
 * так что запрос отклонялся. Ответ никто не читал, и человек видел
 * «Аккаунт удалён», когда не удалялось ничего.
 *
 * Пароль здесь не формальность: в прокси приходит идентификатор, и без
 * проверки по нему можно было бы стереть чужой аккаунт.
 *
 * Бросает с текстом причины — вызывающий обязан её показать, а не проглотить.
 */
export async function dbDeleteAccount(id: string, password: string): Promise<void> {
  const res = await proxy<{ error?: string; 'удалён'?: boolean }>(
    'dbDeleteAccount', [id, password],
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

export type CrossBorderConsentRecord = {
  accepted: boolean;
  version: string | null;
  source: string | null;
  accepted_at: string | null;
};

/** Текущее отдельное решение по трансграничной передаче. */
export async function dbGetCrossBorderConsent(userId: string): Promise<CrossBorderConsentRecord> {
  return proxy('dbGetCrossBorderConsent', [userId]);
}

/**
 * Зафиксировать отдельное добровольное согласие на трансграничную передачу.
 * В отличие от общего dbRecordConsent этот вызов бросает ошибку: включать
 * иностранный канал без доказательной записи нельзя.
 */
export type CrossBorderConsentSource =
  | 'crossborder:registration'
  | 'crossborder:reconsent'
  | 'crossborder:push'
  | 'crossborder:telegram';

export async function dbRecordCrossBorderConsent(
  userId: string,
  version: string,
  source: CrossBorderConsentSource = 'crossborder:reconsent',
): Promise<void> {
  const res = await proxy<{ ok?: boolean; error?: string }>(
    'dbRecordCrossBorderConsent', [userId, version, source],
  );
  if (!res?.ok) throw new Error(res?.error || 'Не удалось сохранить согласие');
}

/** Отзыв отдельного трансграничного согласия. */
export async function dbRevokeCrossBorderConsent(userId: string): Promise<void> {
  const res = await proxy<{ ok?: boolean; error?: string }>('dbRevokeCrossBorderConsent', [userId]);
  if (!res?.ok) throw new Error(res?.error || 'Не удалось отозвать согласие');
}

/** Удаление администратором из дашборда — там пароля человека нет. */
export async function dbDeleteUser(id: string): Promise<void> {
  await proxy('dbDeleteUser', [id]);
}

export function dbWarmup(): void {
  if (IS_NATIVE) {
    fetch(`${API_BASE}/api/db.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Secret': APP_SECRET },
      body: JSON.stringify({ fn: 'dbWarmup', args: [] }),
    }).catch(() => {});
    return;
  }
  withTimeout(
    supabase.from('jm_users').select('id').limit(1),
    20_000
  ).catch(() => {});
}

export async function dbCheckPhoneExists(phone: string): Promise<boolean> {
  // Ошибка запроса — это НЕ ответ «номер свободен». Экран регистрации сам
  // показывает понятный текст и оставляет человека на первом шаге для повтора.
  // Если проглотить ошибку здесь, внешний catch никогда не сработает и при
  // обрыве связи мы разрешим создать второй аккаунт с тем же номером.
  return proxy<boolean>('dbCheckPhoneExists', [phone]);
}

export async function dbGetUserByPhone(phone: string): Promise<User | null> {
  if (IS_NATIVE) { const d = await proxy<any>('dbGetUserByPhone', [phone]); return d ? rowToUser(d) : null; }
  const { data, error } = await withTimeout(
    supabase.from('jm_users').select('*').eq('phone', phone).maybeSingle()
  );
  if (error) throwOnError('dbGetUserByPhone', error);
  return data ? rowToUser(data) : null;
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

function vacancyToRow(v: Vacancy) {
  return {
    id: v.id,
    employer_id: v.employerId,
    company: v.company ? normalizeCompany(v.company) : v.company,
    title: v.title,
    work_type: v.workType,
    work_type_label: v.workTypeLabel,
    metro_line_id: v.metroLineId || null,
    metro_station: v.metroStation || null,
    date: v.date,
    time_start: v.timeStart,
    time_end: v.timeEnd,
    salary: v.salary,
    norms_and_pay: v.normsAndPay || null,
    address: v.address || null,
    lat: v.lat ?? null,
    lng: v.lng ?? null,
    workers_needed: v.workersNeeded,
    workers_found: v.workersFound,
    is_urgent: v.isUrgent,
    no_experience_needed: v.noExperienceNeeded,
    conditions: v.conditions || null,
    status: v.status,
    created_at: v.createdAt,
  };
}

export async function dbGetVacancies(): Promise<Vacancy[]> {
  if (IS_NATIVE) { const d = await proxy<any[]>('dbGetVacancies'); return d.map(rowToVacancy); }
  const { data, error } = await withTimeout(
    supabase.from('jm_vacancies').select('*').order('created_at', { ascending: false })
  );
  if (error) throwOnError('dbGetVacancies', error);
  return (data ?? []).map(rowToVacancy);
}

export async function dbUpsertVacancy(v: Vacancy): Promise<void> {
  if (IS_NATIVE) { await proxy('dbUpsertVacancy', [vacancyToRow(v)]); return; }
  const { error } = await withTimeout(
    supabase.from('jm_vacancies').upsert(vacancyToRow(v), { onConflict: 'id' })
  );
  if (error) throwOnError('dbUpsertVacancy', error);
}

export async function dbUpsertVacancyBatch(vacs: Vacancy[]): Promise<void> {
  if (vacs.length === 0) return;
  const rows = vacs.map(vacancyToRow);
  if (IS_NATIVE) { await proxy('dbUpsertVacancyBatch', [rows]); return; }
  const { error } = await withTimeout(
    supabase.from('jm_vacancies').upsert(rows, { onConflict: 'id' })
  );
  if (error) throwOnError('dbUpsertVacancyBatch', error);
}

export async function dbUpdateVacancy(id: string, patch: Partial<{ status: string; workers_found: number }>): Promise<void> {
  if (IS_NATIVE) { await proxy('dbUpdateVacancy', [id, patch]); return; }
  const { error } = await withTimeout(
    supabase.from('jm_vacancies').update(patch).eq('id', id)
  );
  if (error) throwOnError('dbUpdateVacancy', error);
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
  if (IS_NATIVE) { const d = await proxy<any[]>('dbGetLikes'); return d.map(rowToLike); }
  const { data, error } = await withTimeout(supabase.from('jm_likes').select('*'));
  if (error) throwOnError('dbGetLikes', error);
  return (data ?? []).map(rowToLike);
}

export async function dbGetLikesForUser(userId: string, role: 'worker' | 'employer'): Promise<Like[]> {
  if (IS_NATIVE) { const d = await proxy<any[]>('dbGetLikesForUser', [userId, role]); return d.map(rowToLike); }
  const field = role === 'worker' ? 'worker_id' : 'employer_id';
  const { data, error } = await withTimeout(
    supabase.from('jm_likes').select('*').eq(field, userId)
  );
  if (error) throwOnError('dbGetLikesForUser', error);
  return (data ?? []).map(rowToLike);
}

export async function dbGetVacancyStatsMap(): Promise<Record<string, { applicants: number; rejected: number; views: number }>> {
  if (IS_NATIVE) return proxy<Record<string, { applicants: number; rejected: number; views: number }>>('dbGetVacancyStatsMap');
  const [{ data, error }, { data: viewData }] = await Promise.all([
    withTimeout(supabase.from('jm_likes').select('vacancy_id,worker_liked,employer_liked,worker_skipped,is_match')),
    withTimeout(supabase.from('jm_vacancy_views').select('vacancy_id')),
  ]);
  if (error) throwOnError('dbGetVacancyStatsMap', error);
  const map: Record<string, { applicants: number; rejected: number; views: number }> = {};
  for (const r of data ?? []) {
    if (!r.vacancy_id) continue;
    if (!map[r.vacancy_id]) map[r.vacancy_id] = { applicants: 0, rejected: 0, views: 0 };
    if (r.worker_liked && !r.is_match && r.employer_liked !== false) map[r.vacancy_id].applicants++;
    if (r.employer_liked === false || (r.worker_liked === false && r.worker_skipped === true)) map[r.vacancy_id].rejected++;
  }
  for (const v of viewData ?? []) {
    if (!v.vacancy_id) continue;
    if (!map[v.vacancy_id]) map[v.vacancy_id] = { applicants: 0, rejected: 0, views: 0 };
    map[v.vacancy_id].views++;
  }
  return map;
}

export async function dbGetVacancyViewers(vacancyId: string): Promise<string[]> {
  if (IS_NATIVE) return proxy<string[]>('dbGetVacancyViewers', [vacancyId]);
  const { data } = await withTimeout(
    supabase.from('jm_vacancy_views').select('worker_id').eq('vacancy_id', vacancyId).order('viewed_at', { ascending: false })
  );
  return [...new Set((data ?? []).map((r: any) => r.worker_id))];
}

export async function dbGetPermVacancyViewers(vacancyId: string): Promise<string[]> {
  return proxy<string[]>('dbGetPermVacancyViewers', [vacancyId]);
}

export async function dbRecordVacancyView(vacancyId: string, workerId: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbRecordVacancyView', [vacancyId, workerId]); return; }
  await withTimeout(
    supabase.from('jm_vacancy_views').upsert(
      { vacancy_id: vacancyId, worker_id: workerId },
      { onConflict: 'vacancy_id,worker_id', ignoreDuplicates: true }
    )
  );
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

export type GuestEventType =
  | 'guest_started'
  | 'vacancy_impression'
  | 'apply_intent'
  | 'registration_started'
  | 'registration_completed'
  | 'campaign_published'
  | 'campaign_open'
  | 'campaign_apply'
  | 'campaign_shared';

export interface GuestEventContext {
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
  if (IS_NATIVE) return proxy<Record<string, number>>('dbGetPermVacancyViewsMap');
  const { data } = await withTimeout(supabase.from('jm_perm_vacancy_views').select('vacancy_id'));
  const map: Record<string, number> = {};
  for (const r of data ?? []) {
    if (!r.vacancy_id) continue;
    map[r.vacancy_id] = (map[r.vacancy_id] ?? 0) + 1;
  }
  return map;
}

export async function dbRecordPermVacancyView(vacancyId: string, workerId: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbRecordPermVacancyView', [vacancyId, workerId]); return; }
  await withTimeout(
    supabase.from('jm_perm_vacancy_views').upsert(
      { vacancy_id: vacancyId, worker_id: workerId },
      { onConflict: 'vacancy_id,worker_id', ignoreDuplicates: true }
    )
  );
}

export async function dbGetLikesByVacancy(vacancyId: string): Promise<Like[]> {
  if (IS_NATIVE) { const d = await proxy<any[]>('dbGetLikesByVacancy', [vacancyId]); return d.map(rowToLike); }
  const { data, error } = await withTimeout(
    supabase.from('jm_likes').select('*').eq('vacancy_id', vacancyId)
  );
  if (error) throwOnError('dbGetLikesByVacancy', error);
  return (data ?? []).map(rowToLike);
}

export async function dbGetLikeByVacancyWorker(vacancyId: string, workerId: string): Promise<Like | null> {
  if (IS_NATIVE) { const d = await proxy<any>('dbGetLikeByVacancyWorker', [vacancyId, workerId]); return d ? rowToLike(d) : null; }
  const { data } = await withTimeout(
    supabase.from('jm_likes').select('*').eq('vacancy_id', vacancyId).eq('worker_id', workerId).maybeSingle()
  );
  return data ? rowToLike(data) : null;
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
  if (IS_NATIVE) { const d = await proxy<any>('dbUpsertLike', [vacancyId, workerId, employerId, updates]); return rowToLike(d); }
  const { data: existing } = await withTimeout(
    supabase.from('jm_likes').select('*').eq('vacancy_id', vacancyId).eq('worker_id', workerId).maybeSingle()
  );

  const base: any = existing ?? {
    id: uid(),
    vacancy_id: vacancyId,
    worker_id: workerId,
    employer_id: employerId,
    worker_liked: false,
    employer_liked: null,
    worker_skipped: false,
    is_match: false,
    matched_at: null,
    worker_confirmed: false,
    employer_confirmed: false,
    worker_rated: false,
    employer_rated: false,
    shift_completed: false,
  };

  const row = {
    ...base,
    worker_liked: updates.workerLiked ?? base.worker_liked,
    employer_liked: updates.employerLiked ?? base.employer_liked,
    worker_skipped: updates.workerSkipped ?? base.worker_skipped,
    is_match: updates.isMatch ?? base.is_match,
    matched_at: updates.matchedAt ?? base.matched_at,
    worker_confirmed: updates.workerConfirmed ?? base.worker_confirmed,
    employer_confirmed: updates.employerConfirmed ?? base.employer_confirmed,
    worker_rated: updates.workerRated ?? base.worker_rated,
    employer_rated: updates.employerRated ?? base.employer_rated,
    shift_completed: updates.shiftCompleted ?? base.shift_completed,
  };

  const { data: written, error } = await withTimeout(
    supabase.from('jm_likes').upsert(row, { onConflict: 'vacancy_id,worker_id' }).select()
  );
  if (error) throwOnError('dbUpsertLike', error);
  if (!written || written.length === 0) {
    throw new Error('Like not saved: permission denied');
  }
  return rowToLike(row);
}

export async function dbRemoveLike(vacancyId: string, workerId: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbRemoveLike', [vacancyId, workerId]); return; }
  const { error } = await withTimeout(
    supabase.from('jm_likes').delete().eq('vacancy_id', vacancyId).eq('worker_id', workerId)
  );
  if (error) throwOnError('dbRemoveLike', error);
}

export async function dbDeleteMatch(likeId: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbDeleteMatch', [likeId]); return; }
  const { error } = await withTimeout(supabase.from('jm_likes').delete().eq('id', likeId));
  if (error) throwOnError('dbDeleteMatch', error);
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
  if (IS_NATIVE) { const d = await proxy<any[]>('dbGetMessages', [chatId]); return d.map(rowToMessage); }
  const { data, error } = await withTimeout(
    supabase.from('jm_messages').select('*').eq('chat_id', chatId).order('created_at', { ascending: true })
  );
  if (error) throwOnError('dbGetMessages', error);
  return (data ?? []).map(rowToMessage);
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
  if (IS_NATIVE) {
    const rows = await proxy<any[]>('dbGetChats', [userId, role]);
    return rows.map(row => {
      const last = row._last_msg;
      return rowToChat(row, last ? [rowToMessage(last)] : []);
    });
  }
  const field = role === 'worker' ? 'worker_id' : 'employer_id';
  const { data, error } = await withTimeout(
    supabase.from('jm_chats').select('*').eq(field, userId).order('created_at', { ascending: false })
  );
  if (error) throwOnError('dbGetChats', error);

  const chatRows = data ?? [];
  if (chatRows.length === 0) return [];

  const chatIds = chatRows.map((r: any) => r.id);
  const { data: allMsgs } = await withTimeout(
    supabase.from('jm_messages').select('*').in('chat_id', chatIds).order('created_at', { ascending: false })
  );

  const lastMsgByChat = new Map<string, any>();
  for (const msg of (allMsgs ?? [])) {
    if (!lastMsgByChat.has(msg.chat_id)) lastMsgByChat.set(msg.chat_id, msg);
  }

  return chatRows.map((row: any) => {
    const lastMsg = lastMsgByChat.get(row.id);
    return rowToChat(row, lastMsg ? [rowToMessage(lastMsg)] : []);
  });
}

export async function dbGetChatById(chatId: string): Promise<Chat | null> {
  if (IS_NATIVE) {
    const result = await proxy<any>('dbGetChatById', [chatId]);
    if (!result) return null;
    const { _messages, ...row } = result;
    return rowToChat(row, (_messages ?? []).map(rowToMessage));
  }
  const { data } = await withTimeout(
    supabase.from('jm_chats').select('*').eq('id', chatId).maybeSingle()
  );
  if (!data) return null;
  const msgs = await dbGetMessages(chatId);
  return rowToChat(data, msgs);
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
  if (IS_NATIVE) {
    return proxy<string>('dbCreateChat', [
      workerId, employerId, vacancyId, vacTitle, canonicalCompanyName,
      systemMessage, initialUnreadWorker, initialUnreadEmployer, author,
    ]);
  }
  const { data: existing } = await withTimeout(
    supabase.from('jm_chats').select('id').eq('vacancy_id', vacancyId).eq('worker_id', workerId).maybeSingle()
  );
  if (existing) return existing.id;

  const chatId = uid();
  const row = {
    id: chatId,
    vacancy_id: vacancyId,
    worker_id: workerId,
    employer_id: employerId,
    vac_title: vacTitle,
    company_name: canonicalCompanyName,
    unread_worker: initialUnreadWorker,
    unread_employer: initialUnreadEmployer,
    created_at: nowISO(),
  };
  const { error } = await withTimeout(supabase.from('jm_chats').insert(row));
  if (error) throwOnError('dbCreateChat', error);

  if (systemMessage) {
    await dbInsertMessage(chatId, 'system', systemMessage);
  }

  return chatId;
}

export async function dbMarkRead(chatId: string, role: 'worker' | 'employer'): Promise<void> {
  if (IS_NATIVE) { await proxy('dbMarkRead', [chatId, role]); return; }
  // Время прочтения рядом со счётчиком: по нему собеседник видит вторую
  // галочку. Счётчик отвечает «сколько», отметка — «с какого момента».
  const field = role === 'worker' ? 'unread_worker' : 'unread_employer';
  const stamp = role === 'worker' ? 'worker_read_at' : 'employer_read_at';
  const { error } = await withTimeout(
    supabase.from('jm_chats').update({ [field]: 0, [stamp]: new Date().toISOString() }).eq('id', chatId)
  );
  if (error) throwOnError('dbMarkRead', error);
}

export async function dbIncrementUnread(chatId: string, forRole: 'worker' | 'employer'): Promise<void> {
  if (IS_NATIVE) { await proxy('dbIncrementUnread', [chatId, forRole]); return; }
  const { data } = await withTimeout(
    supabase.from('jm_chats').select('unread_worker,unread_employer').eq('id', chatId).maybeSingle()
  );
  if (!data) return;
  const field = forRole === 'worker' ? 'unread_worker' : 'unread_employer';
  const cur = forRole === 'worker' ? data.unread_worker : data.unread_employer;
  await withTimeout(supabase.from('jm_chats').update({ [field]: (cur ?? 0) + 1 }).eq('id', chatId));
}

export async function dbDeleteChat(chatId: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbDeleteChat', [chatId]); return; }
  await withTimeout(supabase.from('jm_messages').delete().eq('chat_id', chatId));
  await withTimeout(supabase.from('jm_chats').delete().eq('id', chatId));
}

// ─── Saved ────────────────────────────────────────────────────────────────────

export async function dbGetSaved(userId: string): Promise<string[]> {
  if (IS_NATIVE) { return proxy<string[]>('dbGetSaved', [userId]); }
  const { data, error } = await withTimeout(
    supabase.from('jm_saved').select('vacancy_id').eq('user_id', userId)
  );
  if (error) throwOnError('dbGetSaved', error);
  return (data ?? []).map((r: any) => r.vacancy_id);
}

export async function dbAddSaved(userId: string, vacancyId: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbAddSaved', [userId, vacancyId]); return; }
  const { error } = await withTimeout(
    supabase.from('jm_saved').upsert({ user_id: userId, vacancy_id: vacancyId })
  );
  if (error) throwOnError('dbAddSaved', error);
}

export async function dbRemoveSaved(userId: string, vacancyId: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbRemoveSaved', [userId, vacancyId]); return; }
  const { error } = await withTimeout(
    supabase.from('jm_saved').delete().eq('user_id', userId).eq('vacancy_id', vacancyId)
  );
  if (error) throwOnError('dbRemoveSaved', error);
}

// ─── Complaints ───────────────────────────────────────────────────────────────

export async function dbFileComplaint(params: {
  reporterId: string;
  reporterPhone: string;
  reporterCompany?: string;
  targetId: string;
  targetPhone: string;
  targetCompany?: string;
  complaintType: 'worker' | 'employer';
  description?: string;
}): Promise<void> {
  if (IS_NATIVE) { await proxy('dbFileComplaint', [params]); return; }
  const { error } = await withTimeout(
    supabase.from('jm_complaints').insert({
      id: uid(),
      reporter_id: params.reporterId,
      reporter_phone: params.reporterPhone,
      reporter_company: params.reporterCompany ?? null,
      target_id: params.targetId,
      target_phone: params.targetPhone,
      target_company: params.targetCompany ?? null,
      complaint_type: params.complaintType,
      description: params.description ?? null,
      created_at: nowISO(),
    })
  );
  if (error) throwOnError('dbFileComplaint', error);
}

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
  if (IS_NATIVE) { const d = await proxy<any[]>('dbGetPermVacancies'); return d.map(rowToPermVacancy); }
  const { data, error } = await withTimeout(
    supabase.from('jm_perm_vacancies').select('*').eq('status', 'open').order('created_at', { ascending: false })
  );
  if (error) throwOnError('dbGetPermVacancies', error);
  return (data ?? []).map(rowToPermVacancy);
}

export async function dbGetPermVacanciesByEmployer(employerId: string): Promise<PermVacancy[]> {
  if (IS_NATIVE) { const d = await proxy<any[]>('dbGetPermVacanciesByEmployer', [employerId]); return d.map(rowToPermVacancy); }
  const { data, error } = await withTimeout(
    supabase.from('jm_perm_vacancies').select('*').eq('employer_id', employerId).order('created_at', { ascending: false })
  );
  if (error) throwOnError('dbGetPermVacanciesByEmployer', error);
  return (data ?? []).map(rowToPermVacancy);
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
  if (IS_NATIVE) { await proxy('dbUpsertPermVacancy', [permRow]); return; }
  const { error } = await withTimeout(
    supabase.from('jm_perm_vacancies').upsert(permRow, { onConflict: 'id' })
  );
  if (error) throwOnError('dbUpsertPermVacancy', error);
}

export async function dbClosePermVacancy(id: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbClosePermVacancy', [id]); return; }
  const { error } = await withTimeout(
    supabase.from('jm_perm_vacancies').update({ status: 'closed' }).eq('id', id)
  );
  if (error) throwOnError('dbClosePermVacancy', error);
}

export async function dbDeleteVacancy(id: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbDeleteVacancy', [id]); return; }
  await withTimeout(supabase.from('jm_vacancies').delete().eq('id', id));
}

export async function dbDeletePermVacancy(id: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbDeletePermVacancy', [id]); return; }
  await withTimeout(supabase.from('jm_perm_vacancies').delete().eq('id', id));
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
  if (IS_NATIVE) { const d = await proxy<any[]>('dbGetPermApplications', [userId, role]); return d.map(rowToPermApp); }
  const field = role === 'worker' ? 'worker_id' : 'employer_id';
  const { data, error } = await withTimeout(
    supabase.from('jm_perm_applications').select('*').eq(field, userId).order('created_at', { ascending: false })
  );
  if (error) throwOnError('dbGetPermApplications', error);
  return (data ?? []).map(rowToPermApp);
}

export async function dbGetPermApplicationsForVacancy(vacancyId: string): Promise<PermApplication[]> {
  if (IS_NATIVE) { const d = await proxy<any[]>('dbGetPermApplicationsForVacancy', [vacancyId]); return d.map(rowToPermApp); }
  const { data, error } = await withTimeout(
    supabase.from('jm_perm_applications').select('*').eq('vacancy_id', vacancyId).order('created_at', { ascending: false })
  );
  if (error) throwOnError('dbGetPermApplicationsForVacancy', error);
  return (data ?? []).map(rowToPermApp);
}

export async function dbApplyPermVacancy(
  vacancyId: string, workerId: string, employerId: string,
  /** Живая строка от работника — с ней отклик открывает переписку. */
  message?: string,
): Promise<void> {
  if (IS_NATIVE) { await proxy('dbApplyPermVacancy', [vacancyId, workerId, employerId, message]); return; }
  const { error } = await withTimeout(
    supabase.from('jm_perm_applications').upsert({
      id: uid(),
      vacancy_id: vacancyId,
      worker_id: workerId,
      employer_id: employerId,
      status: 'pending',
      created_at: nowISO(),
    }, { onConflict: 'vacancy_id,worker_id' })
  );
  if (error) throwOnError('dbApplyPermVacancy', error);
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
  if (IS_NATIVE) { await proxy('dbSetPermApplicationStatus', [appId, status]); return; }
  const { error } = await withTimeout(
    supabase.from('jm_perm_applications').update({ status }).eq('id', appId)
  );
  if (error) throwOnError('dbSetPermApplicationStatus', error);
}

// ─── Permanent saved ──────────────────────────────────────────────────────────

export async function dbGetPermSaved(userId: string): Promise<string[]> {
  if (IS_NATIVE) { return proxy<string[]>('dbGetPermSaved', [userId]); }
  const { data, error } = await withTimeout(
    supabase.from('jm_perm_saved').select('vacancy_id').eq('user_id', userId)
  );
  if (error) throwOnError('dbGetPermSaved', error);
  return (data ?? []).map((r: any) => r.vacancy_id);
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
  if (IS_NATIVE) { return proxy('dbGetPermSavedDetailed', [userId]); }
  const { data, error } = await withTimeout(
    supabase.from('jm_perm_saved').select('vacancy_id,created_at').eq('user_id', userId)
  );
  if (error) throwOnError('dbGetPermSavedDetailed', error);
  return (data ?? []).map((r: any) => ({ vacancyId: r.vacancy_id, savedAt: r.created_at ?? null }));
}

export async function dbAddPermSaved(userId: string, vacancyId: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbAddPermSaved', [userId, vacancyId]); return; }
  const { error } = await withTimeout(
    supabase.from('jm_perm_saved').upsert({ user_id: userId, vacancy_id: vacancyId })
  );
  if (error) throwOnError('dbAddPermSaved', error);
}

export async function dbRemovePermSaved(userId: string, vacancyId: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbRemovePermSaved', [userId, vacancyId]); return; }
  const { error } = await withTimeout(
    supabase.from('jm_perm_saved').delete().eq('user_id', userId).eq('vacancy_id', vacancyId)
  );
  if (error) throwOnError('dbRemovePermSaved', error);
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
  if (IS_NATIVE) {
    const d = await proxy<any[]>('dbGetRatingsForUser', [toUserId]);
    return d.map((r: any) => ({ id: r.id, fromUserId: r.from_user_id, rating: r.rating, reviewText: r.review_text ?? undefined, role: r.role, createdAt: r.created_at, vacancyId: r.vacancy_id }));
  }
  const { data, error } = await withTimeout(
    supabase.from('jm_ratings').select('*').eq('to_user_id', toUserId).order('created_at', { ascending: false })
  );
  if (error) throwOnError('dbGetRatingsForUser', error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    fromUserId: r.from_user_id,
    rating: r.rating,
    reviewText: r.review_text ?? undefined,
    role: r.role,
    createdAt: r.created_at,
    vacancyId: r.vacancy_id,
  }));
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
  if (IS_NATIVE) { await proxy('dbSetShiftOutcome', [likeId, outcome, opts]); return; }
  const worked = outcome === 'worked';
  await withTimeout(
    supabase.from('jm_likes').update({
      outcome,
      late_minutes: worked ? (opts.lateMinutes ?? 0) : null,
      outcome_at: nowISO(),
      outcome_by: opts.by ?? null,
      // проекция для существующих экранов
      employer_confirmed: worked,
      worker_confirmed: worked,
      shift_completed: worked,
      cancelled: !worked,
    }).eq('id', likeId)
  );
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
  if (IS_NATIVE) { return proxy<{ bothRated: boolean }>('dbSubmitRatingAndMaybeDelete', [params]); }
  const { likeId, fromUserId, toUserId, vacancyId, rating, role, reviewText } = params;

  await withTimeout(
    supabase.from('jm_ratings').insert({
      id: uid(),
      from_user_id: fromUserId,
      to_user_id: toUserId,
      vacancy_id: vacancyId,
      like_id: likeId,
      rating,
      role,
      review_text: reviewText ?? null,
      created_at: nowISO(),
    })
  );

  const ratedField = role === 'worker' ? 'worker_rated' : 'employer_rated';
  await withTimeout(supabase.from('jm_likes').update({ [ratedField]: true }).eq('id', likeId));

  const { data: allRatings } = await withTimeout(
    supabase.from('jm_ratings').select('rating').eq('to_user_id', toUserId)
  );
  if (allRatings && allRatings.length > 0) {
    const avg = allRatings.reduce((s: number, r: any) => s + r.rating, 0) / allRatings.length;
    await withTimeout(
      supabase.from('jm_users').update({
        avg_rating: Math.round(avg * 100) / 100,
        rating_count: allRatings.length,
      }).eq('id', toUserId)
    );
  }

  const { data: likeRow } = await withTimeout(
    supabase.from('jm_likes').select('worker_rated,employer_rated').eq('id', likeId).maybeSingle()
  );

  return { bothRated: !!(likeRow?.worker_rated && likeRow?.employer_rated) };
}

// ─── Микро-тесты по профессиям ────────────────────────────────────────────────

export interface SkillResult {
  workType: WorkType;
  correct: number;
  total: number;
  passed: boolean;
  passedAt?: string;
  attemptsToday: number;
  attemptsDay?: string;
}

export async function dbGetSkillResults(userId: string): Promise<SkillResult[]> {
  const rows = await proxy<any[]>('dbGetSkillResults', [userId]);
  return (rows ?? []).map(r => ({
    workType: r.work_type,
    correct: r.correct ?? 0,
    total: r.total ?? 0,
    passed: !!r.passed,
    passedAt: r.passed_at ?? undefined,
    attemptsToday: r.attempts_today ?? 0,
    attemptsDay: r.attempts_day ?? undefined,
  }));
}

/**
 * Отправить результат. Сервер проверить его не может — вопросы живут в
 * приложении, — но считает попытки и не даёт перебирать наугад. Поэтому в
 * ответе и приходит, сколько попыток осталось.
 */
export async function dbSubmitSkillTest(
  userId: string, workType: WorkType, correct: number, total: number, passed: boolean,
): Promise<{ passed: boolean; осталось: number; error_попытки?: boolean }> {
  return proxy('dbSubmitSkillTest', [userId, workType, correct, total, passed]);
}

// ─── Push tokens ──────────────────────────────────────────────────────────────

export async function dbSavePushToken(userId: string, token: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbSavePushToken', [userId, token]); return; }
  await withTimeout(supabase.from('jm_users').update({ push_token: token }).eq('id', userId));
}

/**
 * Отвязать устройство от аккаунта при выходе.
 *
 * Токен лежит в строке пользователя, и пока он там, сервер шлёт на этот
 * телефон уведомления — даже если человек из аккаунта вышел, а приложение
 * оставил. Именно так уведомления и приходили «в никуда».
 */
export async function dbClearPushToken(userId: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbClearPushToken', [userId]); return; }
  await withTimeout(supabase.from('jm_users').update({ push_token: null }).eq('id', userId));
}

/** Снять токен с любого аккаунта, за которым он записан. Аккаунт знать не нужно. */
export async function dbReleasePushToken(token: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbReleasePushToken', [token]); return; }
  await withTimeout(supabase.from('jm_users').update({ push_token: null }).eq('push_token', token));
}

/** То же для браузера: снимаем подписку на веб-пуши. */
export async function dbDeleteWebPushSubscription(userId: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbDeleteWebPushSubscription', [userId]); return; }
  await withTimeout(supabase.from('jm_web_push_subscriptions').delete().eq('user_id', userId));
}


export async function dbSetEmployerCompany(userId: string, company: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbSetEmployerCompany', [userId, company]); return; }
  await withTimeout(supabase.from('jm_users').update({ company }).eq('id', userId).eq('role', 'employer'));
}

export async function dbGetWebPushSubscription(userId: string): Promise<{ endpoint: string; p256dh: string; auth: string } | null> {
  if (IS_NATIVE) {
    return proxy<{ endpoint: string; p256dh: string; auth: string } | null>('dbGetWebPushSubscription', [userId]);
  }
  const { data } = await withTimeout(
    supabase.from('jm_web_push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', userId).maybeSingle()
  );
  return data ?? null;
}

export async function dbGetWorkerTokensByMetro(metroStation: string): Promise<{ id: string; push_token: string }[]> {
  if (IS_NATIVE) { return proxy<{ id: string; push_token: string }[]>('dbGetWorkerTokensByMetro', [metroStation]); }
  const { data } = await withTimeout(
    supabase
      .from('jm_users')
      .select('id, push_token')
      .eq('role', 'worker')
      .eq('metro_station', metroStation)
      .not('push_token', 'is', null)
  );
  return (data ?? []) as { id: string; push_token: string }[];
}

// ─── In-app notifications ──────────────────────────────────────────────────────


/** Отметить, что пользователь сейчас в приложении. Ошибки глушим: это
 *  фоновая отметка, ради неё нельзя ломать экран. */
export async function dbTouchLastSeen(userId: string): Promise<void> {
  try {
    if (IS_NATIVE) { await proxy('dbTouchLastSeen', [userId]); return; }
    await withTimeout(supabase.from('jm_users').update({ last_seen_at: new Date().toISOString() }).eq('id', userId));
  } catch {
    // колонки может ещё не быть — молчим
  }
}

/**
 * Сказать серверу, что сейчас будет привязка Telegram. Нужно для случая,
 * когда чат с ботом уже существует: Telegram тогда не передаёт метку из
 * ссылки, и бот получает голый «/start». По этой заявке он поймёт, к кому
 * привязываться. Заявка живёт 15 минут.
 */
export async function dbTgPrepareLink(userId: string): Promise<void> {
  // Ошибка должна дойти до UI: оба места вызова уже завершают fire-and-forget
  // собственным .catch(...) и показывают человеку, что привязку подготовить не удалось.
  await proxy('tgPrepareLink', [userId]);
}

export async function dbGetNotifications(userId: string): Promise<{ id: string; title: string; body: string; is_read: boolean; created_at: string; type?: string | null; payload?: any }[]> {
  if (IS_NATIVE) { return proxy('dbGetNotifications', [userId]); }
  const { data, error } = await withTimeout(
    supabase.from('jm_notifications')
      .select('id, title, body, is_read, created_at, type, payload')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)
  );
  if (error) throwOnError('dbGetNotifications', error);
  return data ?? [];
}

export async function dbMarkNotifRead(id: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbMarkNotifRead', [id]); return; }
  await withTimeout(supabase.from('jm_notifications').update({ is_read: true }).eq('id', id));
}

export async function dbMarkAllNotifsRead(userId: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbMarkAllNotifsRead', [userId]); return; }
  await withTimeout(supabase.from('jm_notifications').update({ is_read: true }).eq('user_id', userId));
}

export async function dbDeleteNotif(id: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbDeleteNotif', [id]); return; }
  await withTimeout(supabase.from('jm_notifications').delete().eq('id', id));
}

export async function dbDeleteAllNotifs(userId: string): Promise<void> {
  if (IS_NATIVE) { await proxy('dbDeleteAllNotifs', [userId]); return; }
  await withTimeout(supabase.from('jm_notifications').delete().eq('user_id', userId));
}

// ─── Подсказки адресов ───────────────────────────────────────────────────────

export type AddressSuggestion = { name: string; lat: number | null; lng: number | null };

export async function dbAddressSuggest(query: string): Promise<AddressSuggestion[]> {
  if (query.trim().length < 3) return [];
  // Ошибку сети не превращаем в []: вызывающему коду важно отличать
  // «ничего не найдено» от «подсказки сейчас не загрузились».
  return withTimeout(proxy<AddressSuggestion[]>('addressSuggest', [query]), 9000);
}

export async function dbGetAllWorkerTokens(): Promise<{ id: string; push_token: string }[]> {
  return proxy<{ id: string; push_token: string }[]>('dbGetAllWorkerTokens');
}

// ─── Telegram Mini App ────────────────────────────────────────────────────────

export type TgAuthResult = {
  ok: boolean;
  user?: User | null;
  tg?: { id: number; first_name: string; last_name: string; username: string };
};

/** Validates Telegram initData server-side and returns the linked user (if any) */
export async function dbTelegramAuth(initData: string): Promise<TgAuthResult> {
  const res = await proxy<{ ok: boolean; user?: any; session_token?: string | null; tg?: TgAuthResult['tg'] }>('tgAuth', [initData]);
  if (res.session_token) await saveSessionToken(res.session_token);
  return { ...res, user: res.user ? rowToUser(res.user) : null };
}

/** Links the current Telegram account to an existing JobToo user */
export async function dbBindTelegram(userId: string, initData: string): Promise<boolean> {
  return proxy<boolean>('tgBindTelegram', [userId, initData]);
}

/** Sends a Telegram message to a user's linked account (bot notification) */

export async function dbAutoClosePastVacancies(): Promise<void> {
  await proxy('dbAutoClosePastVacancies');
}

/** Отвязывает Telegram от аккаунта */
export async function dbUnbindTelegram(userId: string): Promise<void> {
  await proxy('tgUnbindTelegram', [userId]);
}

// ─── Поддержка ────────────────────────────────────────────────────────────────

export type SupportMessage = {
  id: string;
  direction: 'in' | 'out';
  text: string;
  createdAt: string;
};

/** Переписка человека с поддержкой. Тред один на человека. */
export async function dbSupportHistory(userId: string): Promise<SupportMessage[]> {
  const rows = await proxy<any[]>('supportHistory', [userId]);
  return (rows ?? []).map(r => ({
    id: r.id,
    direction: r.direction === 'out' ? 'out' : 'in',
    text: r.text,
    createdAt: r.created_at,
  }));
}

export async function dbSupportSend(userId: string, text: string): Promise<void> {
  await proxy('supportSend', [userId, text]);
}
