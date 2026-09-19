import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { dbSavePushToken, dbReleasePushToken, dbGetCrossBorderConsent, dbGetIosPushTransport } from '@/services/db';

const APP_SECRET = process.env.EXPO_PUBLIC_APP_SECRET ?? '';
const DASHBOARD_URL = process.env.EXPO_PUBLIC_DASHBOARD_URL || '';
// В вебе прокси — same-origin (тот же хост, с которого открылось приложение),
// как API_BASE в services/db.ts: иначе с «чистого» имени вызовы пушей уходили
// бы на зашитый jobtoo.ru и упирались в фильтр ТСПУ. Нативно window нет.
const PROXY_URL =
  Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin
    ? `${window.location.origin}/api/db.php`
    : process.env.EXPO_PUBLIC_API_URL
      ? `${process.env.EXPO_PUBLIC_API_URL}/api/db.php`
      : 'https://jobtoo.ru/api/db.php';

// Какая переписка сейчас открыта на экране. Экран чата отмечается здесь, а
// обработчик ниже сверяет отметку с тем, к какому чату относится уведомление.
//
// Зачем: пока человек читает переписку, баннер и звук о новом сообщении в ней
// же только мешают — сообщение и так появляется в списке у него на глазах.
// Раньше в chat-room.tsx для этого был заведён isFocused, но им никто не
// пользовался, и уведомления приходили поверх открытого чата.
let activeChatId: string | null = null;

export function setActiveChat(chatId: string | null): void {
  activeChatId = chatId;
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as { chatId?: string } | undefined;
    // Глушим только сообщения из этой же переписки. Всё остальное — отклики,
    // мэтчи, новые вакансии — показываем как обычно.
    const reading = !!activeChatId && !!data?.chatId && data.chatId === activeChatId;
    return {
      shouldShowAlert: !reading,
      shouldPlaySound: !reading,
      shouldSetBadge: !reading,
      shouldShowBanner: !reading,
      shouldShowList: !reading,
    };
  },
});

// ─── Android notification channels ───────────────────────────────────────────

export async function setupAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Promise.all([
    Notifications.setNotificationChannelAsync('messages', {
      name: 'Сообщения',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
      sound: 'default',
    }),
    Notifications.setNotificationChannelAsync('matches', {
      name: 'Мэтчи',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
    }),
    Notifications.setNotificationChannelAsync('vacancies', {
      name: 'Новые вакансии',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    }),
    Notifications.setNotificationChannelAsync('default', {
      name: 'Общие',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
    }),
  ]);
}

// ─── Token registration ───────────────────────────────────────────────────────

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

function getExpoProjectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.easConfig?.projectId
    ?? undefined
  );
}

/**
 * iOS switches to Apple's native device token as soon as our backend confirms
 * that direct APNs credentials are installed. Android stays on Expo/FCM.
 */
async function getStoredPushToken(): Promise<string | null> {
  if (Platform.OS === 'ios') {
    // Cut over only when our own backend confirms that APNs credentials are
    // installed. Until then the currently working Expo route stays intact.
    const transport = await dbGetIosPushTransport().catch(() => 'expo' as const);
    if (transport === 'apns') {
      const native = await Notifications.getDevicePushTokenAsync();
      const token = String(native.data ?? '').trim();
      return token ? `apns:${token}` : null;
    }
  }

  // Android remains Expo/FCM for now. On iOS this is only the pre-cutover
  // fallback while the server has no APNs provider credentials.
  const projectId = getExpoProjectId();
  if (!projectId) {
    console.warn('[push] Missing EAS projectId. Build with EAS and keep expo.extra.eas.projectId in app config.');
    return null;
  }
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

export async function registerForPushNotifications(userId: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (!Device.isDevice) {
    console.info('[push] Skipped push token registration: simulator/emulator detected.');
    return false;
  }

  try {
    const consent = await dbGetCrossBorderConsent(userId).catch(() => null);
    if (consent?.accepted !== true) {
      console.info('[push] Separate cross-border consent is missing: skipping token registration.');
      return false;
    }

    // Never trigger the OS permission dialog here — boot-time calls must stay
    // silent. The dialog is requested only from NotificationPermissionSheet.
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      console.info('[push] Permission not granted yet: skipping token registration.');
      return false;
    }

    await setupAndroidChannels();

    const token = await getStoredPushToken();
    if (!token) return false;
    await dbSavePushToken(userId, token);
    console.info('[push] Push token saved for user:', userId, Platform.OS === 'ios' ? 'APNs' : 'Expo');
    return true;
  } catch (error) {
    console.warn('[push] Failed to register push token:', error);
    return false;
  }
}


/**
 * Отвязать это устройство от чужого аккаунта при запуске без входа.
 *
 * Нужно для тех, кто вышел из аккаунта раньше, чем появилось снятие токена
 * при выходе: токен так и остался записан за ними, уведомления продолжали
 * приходить, а почиститься при входе они не могут — они же вышли.
 *
 * Разрешение не запрашиваем: если его нет, токена всё равно не будет.
 */
export async function releasePushTokenIfSignedOut(): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!Device.isDevice) return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    const token = await getStoredPushToken();
    if (!token) return;
    await dbReleasePushToken(token);
  } catch {
    // Молча: это уборка, а не то, ради чего человек открыл приложение.
  }
}

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  channelId: string;
  priority: 'default' | 'normal' | 'high';
  data: Record<string, unknown>;
  ttl?: number;
};

type ExpoPushTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};


// ─── Web Push helper ──────────────────────────────────────────────────────────


// ─── Internal helper ──────────────────────────────────────────────────────────

// Экранируем HTML для parse_mode=HTML в Telegram (имена/компании могут содержать < > &)
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Зеркалим уведомление в Telegram, если пользователь привязал аккаунт.
// Сервер сам находит telegram_id по userId (эндпоинт tgNotifyUser).


// ─── Employer notifications ───────────────────────────────────────────────────




// Уведомлений о сообщениях здесь больше нет. Их шлёт сервер при записи
// сообщения и при заведении чата (jt_notify_new_message в php-proxy/db.php):
// имя отправителя и текст он берёт из того, что сам записал, а не из того,
// что прислал телефон. Отсюда они и терялись при обрыве, и позволяли послать
// через нашего бота произвольный текст тому, с кем есть переписка.

// ─── Worker notifications ──────────────────────────────────────────────────





// ─── Nearby vacancy broadcast ─────────────────────────────────────────────────

const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function formatDateRu(iso?: string): string {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  if (!m || !d) return iso;
  return `${d} ${MONTHS_RU[m - 1]}`;
}

// Уведомлений о событиях здесь больше нет — ни о сообщениях, ни о мэтче, ни об
// итоге смены, ни о решении по заявке. Их шлёт сервер там же, где записывает
// само событие: jt_notify_new_message, jt_notify_match, jt_notify_shift_outcome
// и jt_perm_app_announce в php-proxy/db.php.
//
// Отсюда они уходили «выстрелил и забыл» — обрыв связи, и человек не узнавал.
// И, что хуже, текст уведомления собирал телефон: через нашего бота можно было
// послать что угодно тому, с кем есть переписка.
//
// Ниже осталось одно — объявление о новой вакансии: это не событие одного
// человека, а рассылка, и у неё свой серверный обработчик.

export async function notifyWorkersNewVacancy(params: {
  metroStation: string;
  title: string;
  company: string;
  type: 'shift' | 'permanent';
  date?: string;       // ISO, для смен
  daysCount?: number;  // если смена на несколько дней
  timeStart?: string;
  timeEnd?: string;
  salary?: number;
  schedule?: string;   // для постоянных
  vacancyId?: string;  // кнопка ведёт прямо на вакансию
  workType?: string;   // для добровольного фильтра по профессиям
  estimated?: boolean; // сдельная оплата: сумма — ориентир, а не обещание
}): Promise<boolean> {
  try {
    const { metroStation, title, company, type, date, daysCount, timeStart, timeEnd, salary, schedule, vacancyId, workType, estimated } = params;

    const dateLabel = formatDateRu(date) + (daysCount && daysCount > 1 ? ` (+${daysCount - 1} дн.)` : '');
    const timeLabel = timeStart ? `${timeStart}${timeEnd ? `–${timeEnd}` : ''}` : '';
    // «≈» у сдельной оплаты: человек, пришедший за обещанной суммой и
    // получивший меньше, прав, считая себя обманутым.
    const salaryLabel = salary && salary > 0
      ? `${estimated ? '≈ ' : ''}${salary.toLocaleString('ru-RU')} ₽${type === 'permanent' ? '/мес' : ''}`
      : '';

    // Сервер разошлёт всем работникам, у кого есть куда написать. Какое-то
    // время слали только тем, кому недалеко по своей ветке, но география
    // отрезала тех, кто готов ехать, а таких среди складских много: на смене
    // в Строгино объявление ушло 19 людям вместо 149. От заваливания теперь
    // защищает не расстояние, а счёт — не больше четырёх объявлений в сутки
    // на человека. Станция стоит в тексте, человек решает сам.
    const notifTitle = type === 'permanent'
      ? '💼 Новая постоянная вакансия!'
      : '⚡ Новая подработка!';
    const body = `${title} — ${company}`
      + (dateLabel ? `, ${dateLabel}` : '')
      + (timeLabel ? ` ${timeLabel}` : '')
      + (metroStation ? `, м. ${metroStation}` : '')
      + (salaryLabel ? `, ${salaryLabel}` : '')
      + '. Открой и откликнись!';

    const detailsHtml = `\n\n👷 ${title} — ${company}`
      + (dateLabel ? `\n📅 ${dateLabel}${timeLabel ? `, ${timeLabel}` : ''}` : (timeLabel ? `\n🕐 ${timeLabel}` : ''))
      + (schedule ? `\n🗓 ${schedule}` : '')
      + (metroStation ? `\n🚇 м. ${metroStation}` : '')
      + (salaryLabel ? `\n💰 ${salaryLabel}` : '');

    const headHtml = type === 'permanent' ? '💼 <b>Новая постоянная вакансия!</b>' : '⚡ <b>Новая подработка!</b>';
    const tgHtml = headHtml + detailsHtml + '\n\nУспей откликнуться 👇';
    // Текст поста в группу «ПОДРАБОТКИ» здесь больше не собирается: его делает
    // сервер (jt_group_html в php-proxy/db.php) из строки вакансии. Раньше
    // формат жил в двух местах, и второй — догоняющее задание — неизбежно
    // разъехался бы с этим. Довод оставлен пустым, чтобы не сдвинуть номера
    // остальных: старый сервер по пустому соберёт пост из tgHtml, как и до
    // появления этого поля.
    const groupHtml = '';

    const notifyPayload = JSON.stringify({
      fn: 'dbNotifyAllWorkersNewVacancy',
      // Новые поля добавлены в конец: старые клиенты остаются совместимыми.
      args: [notifTitle, body, tgHtml, type === 'permanent' ? 'nearby_perm' : 'nearby_shift',
             groupHtml, vacancyId ?? '', metroStation ?? '', workType ?? ''],
    });

    // Рассылка — отдельный вызов, и раньше он был «выстрелил и забыл», одна
    // попытка без срока. Стоило сети моргнуть при публикации — и объявление в
    // группу «ПОДРАБОТКИ» молча терялось (вакансия в ленте есть, сообщения нет).
    //
    // Теперь до трёх попыток с таймаутом. Повтор безопасен, потому что сервер
    // идемпотентен по vacancyId: дважды одну вакансию он не разошлёт. Без
    // vacancyId (нечем застолбить) оставляем одну попытку, чтобы не поймать
    // дубли у старого пути.
    const canRetry = !!vacancyId;
    for (let attempt = 0; attempt < (canRetry ? 3 : 1); attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 25000);
        try {
          const res = await fetch(PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-App-Secret': APP_SECRET },
            body: notifyPayload,
            signal: ctrl.signal,
          });
          if (res.ok) return true;
        } finally {
          clearTimeout(timer);
        }
      } catch {
        // Сетевой сбой/таймаут — попробуем ещё раз (если есть vacancyId).
      }
      if (canRetry && attempt < 2) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
    return false;
  } catch {
    // Не роняем публикацию вакансии из-за вторичной рассылки, но возвращаем
    // честный результат, чтобы форма могла предупредить работодателя.
    return false;
  }
}

// ─── Permanent vacancy notifications ─────────────────────────────────────────



