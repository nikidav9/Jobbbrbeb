import AsyncStorage from '@react-native-async-storage/async-storage';
import { User, Vacancy } from '@/constants/types';
export { normalizeCompany } from '@/services/company';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const nowISO = () => new Date().toISOString();

const KEY_CURRENT = 'jm_currentUser';
const KEY_PENDING_REF = 'jm_pendingReferral';

// ─── Session (current user in AsyncStorage for fast boot) ────────────────────

export async function getSessionUser(): Promise<User | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_CURRENT);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveSessionUser(u: User): Promise<void> {
  await AsyncStorage.setItem(KEY_CURRENT, JSON.stringify(u));
}

export async function clearSessionUser(): Promise<void> {
  await AsyncStorage.removeItem(KEY_CURRENT);
}

// ─── Приглашение, пришедшее по ссылке ────────────────────────────────────────
//
// Между открытием ссылки и регистрацией человек проходит несколько экранов, а
// мини-приложение по дороге может перезапуститься. Держать код в памяти
// недостаточно: он потеряется ровно там, где нужен.
//
// Код не секрет, но и не наш: чужое приглашение в хранилище — это чужое
// вознаграждение, поэтому стираем сразу, как использовали.

export async function getPendingReferral(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY_PENDING_REF);
  } catch {
    return null;
  }
}

export async function savePendingReferral(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PENDING_REF, code);
  } catch {
    // Приглашение — не то, ради чего стоит ронять запуск приложения.
  }
}

export async function clearPendingReferral(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY_PENDING_REF);
  } catch {
    // См. выше.
  }
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function nameColorFromString(str: string): string {
  const colors = ['#FF6B1A', '#2563EB', '#16A34A', '#7C3AED', '#DC2626', '#0CACCA'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export function formatDate(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  return `${days[d.getDay()]} ${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;
}

const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/**
 * Отметка времени в списке переписок.
 *
 * Раньше у каждой строки стояли часы и минуты — и у сегодняшней, и у
 * прошлогодней. «12:29» ничего не говорит, когда разговор был неделю назад:
 * список выглядел так, будто все написали сегодня.
 *
 * Считаем по календарным дням, а не по суткам: сообщение вчера в 23:00,
 * прочитанное сегодня в час ночи, — это «1д», а не «2 часа назад».
 */
export function formatChatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(d)) / 86_400_000);
  const p2 = (n: number) => n.toString().padStart(2, '0');

  if (days <= 0) return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  if (days < 7) return `${days}д`;
  if (days < 35) return `${Math.floor(days / 7)}н`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/**
 * Returns the "virtual start date" for the date strip.
 * After 21:00, today is considered closed — the strip starts from tomorrow.
 */
/** Format a Date object to YYYY-MM-DD using LOCAL date components (not UTC). */
export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getVirtualStartDate(): Date {
  const now = new Date();
  if (now.getHours() >= 21) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow;
  }
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return today;
}

/**
 * Returns ISO date strings for the next 14 days starting from the virtual start date.
 * Before 21:00: today + 13 more days.
 * After  21:00: tomorrow + 13 more days.
 * Always exactly 14 days — auto-updates daily.
 */
export function getTodayDates(): string[] {
  const start = getVirtualStartDate();
  const dates: string[] = [];
  const cur = new Date(start);
  for (let i = 0; i < 14; i++) {
    dates.push(localDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}



// ─── Phone helpers ────────────────────────────────────────────────────────────

export function isPhoneComplete(formatted: string): boolean {
  const digits = formatted.replace(/\D/g, '');
  const local = digits.startsWith('7') || digits.startsWith('8') ? digits.slice(1) : digits;
  return local.length === 10;
}

export function extractPhoneDigits(formatted: string): string {
  const digits = formatted.replace(/\D/g, '');
  if (digits.startsWith('7') || digits.startsWith('8')) return '7' + digits.slice(1, 11);
  return '7' + digits.slice(0, 10);
}

// ─── AsyncStorage cache (stale-while-revalidate) ──────────────────────────────

export const CACHE_KEYS = {
  vacancies:       'jm_c1_vac',
  users:           'jm_c1_users',
  likes:           (uid: string) => `jm_c1_likes_${uid}`,
  chats:           (uid: string) => `jm_c1_chats_${uid}`,
  permVac:         (uid: string) => `jm_c1_pvac_${uid}`,
  permApps:        (uid: string) => `jm_c1_papps_${uid}`,
  vacancyStats:    (vacId: string) => `jm_c1_vstats_${vacId}`,
  allVacancyStats: 'jm_c1_all_vstats',
  notifications:   (uid: string) => `jm_c1_notifs_${uid}`,
};

export async function loadCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function saveCache(key: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  } catch {}
}

/**
 * Стирает только временный stale-while-revalidate кэш приложения.
 *
 * Сессию, токен авторизации, прогресс обучения, push-настройки и другие
 * пользовательские предпочтения намеренно не трогаем — кнопка «Очистить кеш»
 * не должна выбрасывать человека из аккаунта или сбрасывать его настройки.
 */
export async function clearRuntimeCache(): Promise<number> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter(key => key.startsWith('jm_c1_'));
    if (cacheKeys.length > 0) {
      await AsyncStorage.multiRemove(cacheKeys);
    }
    return cacheKeys.length;
  } catch {
    return 0;
  }
}
