import { Platform } from 'react-native';
import { getSessionToken, dbGetConsent } from '@/services/db';
import { hasCrossBorderConsent } from '@/constants/legal';

// Публичная половина пары, которую сервер создал сам (infra/bootstrap.sh).
// Прежняя жила в настройках Vercel, и её приватная часть однажды прошла
// через переписку — то есть перестала быть секретом. Новую приватную часть
// не знает никто, кроме самой машины.
//
// Ключ здесь не секрет: браузер получает его при каждой подписке. Менять
// его безопасно — ниже подписка сверяется с ним и перевыпускается, если
// выдана под другой.
const VAPID_PUBLIC_KEY = 'BOGmoT8nUYJHXx8zLh7kmn_xDoaaLKu0wbSgWhqphsImHNeiTIscMLFEZsndZflZ6Xp9sJ8UMC1iIIkiLCecNzs';

// Supabase напрямую из браузера блокируется в РФ — сохраняем через прокси.
// В вебе адрес прокси — same-origin (тот же хост, с которого открылось
// приложение), как и API_BASE в services/db.ts: иначе с «чистого» имени
// подписка на пуш уходила бы на зашитый jobtoo.ru и упиралась в фильтр ТСПУ.
const PROXY_URL =
  Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin
    ? `${window.location.origin}/api/db.php`
    : process.env.EXPO_PUBLIC_API_URL
      ? `${process.env.EXPO_PUBLIC_API_URL}/api/db.php`
      : 'https://jobtoo.ru/api/db.php';
const APP_SECRET = process.env.EXPO_PUBLIC_APP_SECRET ?? '';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

const WP_FLAG = 'webpush_registered';
const WP_DEBUG = 'webpush_debug';

export function isWebPushRegistered(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(WP_FLAG) === '1';
}

export function getWebPushDebug(): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(WP_DEBUG) || '';
}

function wpDebug(msg: string) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(WP_DEBUG, msg);
  console.warn('[webpush]', msg);
}

function wpTimeout<T>(p: Promise<T>, ms: number, step: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`Зависло на шаге: ${step}. Закройте приложение полностью и попробуйте снова.`)), ms)
    ),
  ]);
}

export async function registerWebPush(userId: string): Promise<boolean> {
  if (Platform.OS !== 'web') return false;
  if (typeof window === 'undefined') return false;

  const consent = await dbGetConsent(userId).catch(() => null);
  if (!hasCrossBorderConsent(consent?.docs)) {
    wpDebug('Нужно отдельное согласие на трансграничную передачу для web-push');
    return false;
  }

  if (!('serviceWorker' in navigator)) {
    wpDebug('Ошибка: serviceWorker не поддерживается');
    return false;
  }
  if (!('PushManager' in window)) {
    wpDebug('Ошибка: PushManager недоступен. Откройте приложение через ярлык с экрана «Домой» (не в браузере)');
    return false;
  }

  try {
    wpDebug('Регистрируем sw.js...');
    const reg = await wpTimeout(navigator.serviceWorker.register('/sw.js'), 10_000, 'регистрация sw.js');
    wpDebug('Ждём готовности SW...');
    // iOS PWA: serviceWorker.ready может зависнуть навсегда — ждём не дольше 10с
    await wpTimeout(Promise.resolve(navigator.serviceWorker.ready), 10_000, 'ожидание service worker');

    wpDebug('Запрашиваем разрешение...');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      wpDebug(`Разрешение: ${permission}. Зайдите в Настройки → Safari → Уведомления`);
      return false;
    }

    wpDebug('Создаём push-подписку...');
    const wanted = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    let existing = await wpTimeout(reg.pushManager.getSubscription(), 8_000, 'проверка подписки');

    // Подписка привязана к ключу, под которым выдана. Если ключи сменили, а
    // подписку оставили прежнюю, она молча перестаёт работать: браузер её
    // держит, сервер шлёт под новым ключом, человек не получает ничего — и
    // никогда не узнает почему.
    //
    // Раньше здесь стояло «есть подписка — берём её», без всякой сверки.
    // Это делало ключи незаменимыми: потеряли приватный — потеряли всех, кто
    // уже подписан. Теперь несовпадение просто переподписывает.
    if (existing) {
      const current = new Uint8Array(existing.options?.applicationServerKey ?? new ArrayBuffer(0));
      const same = current.length === wanted.length && current.every((b, i) => b === wanted[i]);
      if (!same) {
        wpDebug('Подписка выдана под другой ключ — переподписываемся');
        try { await wpTimeout(existing.unsubscribe(), 8_000, 'отписка'); } catch {}
        existing = null;
      }
    }

    const sub = existing ?? await wpTimeout(reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: wanted,
    }), 12_000, 'создание подписки');

    wpDebug('Сохраняем в базу...');
    const subJson = sub.toJSON();
    // dbSaveWebPushSubscription на сервере — авторизованный метод: ему нужен
    // токен сессии (Authorization), как и остальным запросам в services/db.ts.
    // Без него сервер не видит пользователя и отвечает 401 — из-за этого
    // «подключить уведомления» падало с «Ошибка сервера: HTTP 401».
    const sessionToken = await getSessionToken();
    const resp = await wpTimeout(fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Secret': APP_SECRET,
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: JSON.stringify({
        fn: 'dbSaveWebPushSubscription',
        args: [userId, subJson.endpoint, (subJson.keys as any)?.p256dh, (subJson.keys as any)?.auth],
      }),
    }), 12_000, 'сохранение в базу');

    if (resp.status === 401) {
      wpDebug('Ошибка 401: сессия не распознана. Выйдите и войдите снова, затем повторите.');
      return false;
    }

    if (!resp.ok) {
      wpDebug(`Ошибка сервера: HTTP ${resp.status}`);
      return false;
    }

    localStorage.setItem(WP_FLAG, '1');
    localStorage.setItem(WP_DEBUG, 'OK — подписка сохранена!');
    console.info('[webpush] Subscription saved for user:', userId);
    return true;
  } catch (e: any) {
    wpDebug(`Исключение: ${e?.message ?? String(e)}`);
    return false;
  }
}
