import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { dbSavePushToken, dbGetPushToken, dbReleasePushToken, dbGetWebPushSubscription, dbSaveNotification } from '@/services/db';

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

export async function registerForPushNotifications(userId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!Device.isDevice) {
    console.info('[push] Skipped push token registration: simulator/emulator detected.');
    return;
  }

  // Never trigger the OS permission dialog here — boot-time calls must stay
  // silent. The dialog is requested only from NotificationPermissionSheet.
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    console.info('[push] Permission not granted yet: skipping token registration.');
    return;
  }

  await setupAndroidChannels();

  const projectId = getExpoProjectId();
  if (!projectId) {
    console.warn('[push] Missing EAS projectId. Build with EAS and keep expo.extra.eas.projectId in app config.');
    return;
  }

  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await dbSavePushToken(userId, token);
    console.info('[push] Expo push token saved for user:', userId);
  } catch (error) {
    console.warn('[push] Failed to register Expo push token:', error);
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
    const projectId = getExpoProjectId();
    if (!projectId) return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
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

async function sendExpoPush(messages: ExpoPushMessage[]): Promise<void> {
  if (Platform.OS === 'web') {
    // exp.host blocks cross-origin requests from browsers — route through server proxy
    const tokens = messages.map(m => m.to);
    const first = messages[0];
    await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Secret': APP_SECRET },
      body: JSON.stringify({
        fn: 'sendPushNotification',
        args: [
          tokens.length === 1 ? tokens[0] : tokens,
          first.title,
          first.body,
          { channelId: first.channelId, ...first.data },
        ],
      }),
    }).catch(e => console.warn('[push] Server proxy error:', e));
    return;
  }

  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages.length === 1 ? messages[0] : messages),
  });

  if (!response.ok) {
    const text = await response.text();
    console.warn('[push] Expo API HTTP error:', response.status, text);
    return;
  }

  const payload = await response.json().catch(() => null) as { data?: ExpoPushTicket[] | ExpoPushTicket; errors?: unknown } | null;
  if (!payload) {
    console.warn('[push] Expo API returned unreadable JSON payload.');
    return;
  }

  if (payload.errors) {
    console.warn('[push] Expo API top-level errors:', payload.errors);
  }

  const tickets = Array.isArray(payload.data) ? payload.data : payload.data ? [payload.data] : [];
  tickets.forEach((ticket) => {
    if (ticket.status === 'error') {
      console.warn('[push] Expo push ticket error:', ticket.details?.error ?? ticket.message ?? 'unknown_error');
    }
  });
}

// ─── Web Push helper ──────────────────────────────────────────────────────────

async function sendWebPushTo(
  recipientUserId: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  if (!DASHBOARD_URL) return;
  try {
    const sub = await dbGetWebPushSubscription(recipientUserId);
    if (!sub) return;
    await fetch(`${DASHBOARD_URL}/api/webpush/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-app-secret': APP_SECRET,
      },
      body: JSON.stringify({
        subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        title,
        body,
        data,
      }),
    });
  } catch {
    // Never crash due to web push failure
  }
}

// ─── Internal helper ──────────────────────────────────────────────────────────

// Экранируем HTML для parse_mode=HTML в Telegram (имена/компании могут содержать < > &)
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Зеркалим уведомление в Telegram, если пользователь привязал аккаунт.
// Сервер сам находит telegram_id по userId (эндпоинт tgNotifyUser).
async function sendTelegramTo(recipientUserId: string, title: string, body: string): Promise<void> {
  try {
    const html = `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(body)}`;
    await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Secret': APP_SECRET },
      body: JSON.stringify({ fn: 'tgNotifyUser', args: [recipientUserId, html, true] }),
    });
  } catch {
    // Never crash due to a Telegram notification failure
  }
}

/**
 * Отправить уведомление всеми каналами сразу.
 *
 * `abroad` — то, что можно выпускать за границу.
 *
 * Пуш уходит на exp.host, то есть в США. США нет в перечне государств с
 * адекватной защитой прав субъектов персональных данных (приказ РКН № 128
 * от 05.08.2022), и передача туда идёт по самому строгому порядку. А мы
 * отправляли туда имя работника и — в уведомлениях о чате — первые сто
 * символов самого сообщения. Переписка открытым текстом на чужой сервер.
 *
 * Остальные каналы текст не теряют:
 *   — колокольчик живёт в нашей базе в Москве;
 *   — веб-пуш шифруется на нашей стороне (RFC 8291), Apple и Google видят
 *     только шифртекст;
 *   — телеграм получает полный текст как и раньше.
 *
 * Если `abroad` не передан, наружу идёт обычный текст — так и должно быть
 * там, где персональных данных нет вовсе: «5 смен рядом с вашим метро».
 */
async function pushTo(
  recipientUserId: string,
  title: string,
  body: string,
  type: string,
  channelId = 'default',
  data: Record<string, unknown> = {},
  sendTelegram = true,
  abroad?: { title?: string; body?: string },
): Promise<void> {
  // Save in-app notification so the bell always shows it. type/data кладём
  // рядом — по ним колокольчик понимает, какой экран открыть по нажатию.
  dbSaveNotification(recipientUserId, title, body, type, data).catch(() => {});
  // Fire-and-forget web push alongside Expo push
  sendWebPushTo(recipientUserId, title, body, { type, ...data }).catch(() => {});
  // Mirror to Telegram (bell + push + web push + Telegram — все каналы)
  if (sendTelegram) sendTelegramTo(recipientUserId, title, body).catch(() => {});
  try {
    const token = await dbGetPushToken(recipientUserId);
    if (!token) return;
    await sendExpoPush([{
      to: token,
      title: abroad?.title ?? title,
      body: abroad?.body ?? body,
      sound: 'default',
      channelId,
      data: { type, ...data },
      priority: 'high',
      ...(channelId === 'messages' ? { ttl: 60 } : {}),
    }]);
  } catch {
    // Never crash the app due to a notification failure
  }
}

// ─── Employer notifications ───────────────────────────────────────────────────

export async function notifyEmployerNewApplicant(
  employerId: string,
  workerName: string,
  vacancyTitle: string,
): Promise<void> {
  await pushTo(
    employerId,
    '📥 Новый отклик!',
    `${workerName} хочет выйти на смену «${vacancyTitle}». Посмотрите кандидата!`,
    'new_applicant',
    'matches',
    {}, true,
    // Название смены — не персональные данные, его оставляем: без него
    // уведомление перестаёт что-либо значить. Имя убираем.
    { body: `Кто-то хочет выйти на смену «${vacancyTitle}». Посмотрите кандидата!` },
  );
}

export async function notifyEmployerGotMatch(
  employerId: string,
  workerName: string,
  vacancyTitle: string,
): Promise<void> {
  await pushTo(
    employerId,
    '🎉 Мэтч!',
    `${workerName} готов выйти на смену «${vacancyTitle}». Откройте чат!`,
    'match_employer',
    'matches',
    {}, true,
    { body: `Кандидат готов выйти на смену «${vacancyTitle}». Откройте чат!` },
  );
}


// Уведомлений о сообщениях здесь больше нет. Их шлёт сервер при записи
// сообщения и при заведении чата (jt_notify_new_message в php-proxy/db.php):
// имя отправителя и текст он берёт из того, что сам записал, а не из того,
// что прислал телефон. Отсюда они и терялись при обрыве, и позволяли послать
// через нашего бота произвольный текст тому, с кем есть переписка.

// ─── Worker notifications ──────────────────────────────────────────────────

export async function notifyWorkerGotMatch(
  workerId: string,
  companyName: string,
  vacancyTitle: string,
): Promise<void> {
  await pushTo(
    workerId,
    '🎉 Мэтч! Вас хотят взять!',
    `${companyName} подтвердили ваш отклик на «${vacancyTitle}». Откройте чат!`,
    'match_worker',
    'matches',
  );
}

export async function notifyWorkerShiftConfirmedByEmployer(
  workerId: string,
  companyName: string,
  vacancyTitle: string,
): Promise<void> {
  await pushTo(
    workerId,
    '✅ Смена подтверждена работодателем',
    `${companyName} подтвердил смену «${vacancyTitle}». Хотите оставить отзыв?`,
    'shift_confirmed_by_employer',
    'default',
  );
}

/**
 * Смена не состоялась. Текст зависит от того, из-за чего.
 *
 * Прежде он был один на все случаи: «компания отменила смену». Работнику,
 * которого только что отметили не вышедшим, приходило письмо о том, что смену
 * отменил работодатель, — неправда, и вдобавок отметку, которая пойдёт ему в
 * рейтинг, он бы так и не увидел. Пусть видит: если это ошибка, он успеет
 * написать в поддержку, пока помнит, как всё было.
 */
export async function notifyWorkerShiftCancelled(
  workerId: string,
  companyName: string,
  vacancyTitle: string,
  outcome?: 'no_show' | 'worker_cancelled' | 'employer_cancelled' | 'other_cancelled',
): Promise<void> {
  const [title, body] =
    outcome === 'no_show'
      ? ['⚠️ Отмечен невыход',
         `${companyName} отметил, что вы не вышли на смену «${vacancyTitle}». Это влияет на рейтинг. Если это ошибка — напишите в поддержку.`]
      : outcome === 'worker_cancelled'
      ? ['Смена отменена',
         `Ваш отказ от смены «${vacancyTitle}» (${companyName}) записан. На рейтинг он не влияет.`]
      : outcome === 'other_cancelled'
      ? ['Смена отменена',
         `Смена «${vacancyTitle}» не состоялась по другой причине. На рейтинг сторон это не влияет.`]
      : ['❌ Смена отменена',
         `${companyName} отменил смену «${vacancyTitle}». Загляните в приложение — там много других подработок!`];

  await pushTo(workerId, title, body, 'shift_cancelled', 'matches');
}


// ─── Nearby vacancy broadcast ─────────────────────────────────────────────────

const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function formatDateRu(iso?: string): string {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  if (!m || !d) return iso;
  return `${d} ${MONTHS_RU[m - 1]}`;
}

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
}): Promise<void> {
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
          if (res.ok) break;
        } finally {
          clearTimeout(timer);
        }
      } catch {
        // Сетевой сбой/таймаут — попробуем ещё раз (если есть vacancyId).
      }
      if (canRetry && attempt < 2) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  } catch {
    // Never crash the app due to a notification failure
  }
}

// ─── Permanent vacancy notifications ─────────────────────────────────────────

export async function notifyEmployerNewPermApplicant(
  employerId: string,
  workerName: string,
  vacancyTitle: string,
  workerId?: string,
  vacancyId?: string,
): Promise<void> {
  await pushTo(
    employerId,
    '📥 Новая заявка!',
    `${workerName} откликнулся на вакансию «${vacancyTitle}». Посмотрите кандидата!`,
    'new_perm_applicant', 'matches',
    {}, false, // Telegram шлём отдельной карточкой ниже — не дублируем
    { body: `Есть отклик на вакансию «${vacancyTitle}». Посмотрите кандидата!` },
  );
  // Telegram-карточка с кнопками «Одобрить/Отклонить» прямо в чате директора
  if (workerId && vacancyId) {
    fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Secret': APP_SECRET },
      body: JSON.stringify({
        fn: 'tgNotifyNewApplication',
        args: [employerId, workerId, vacancyId, vacancyTitle],
      }),
    }).catch(() => {});
  }
}

export async function notifyWorkerPermApplicationApproved(
  workerId: string,
  companyName: string,
  vacancyTitle: string,
): Promise<void> {
  await pushTo(
    workerId,
    '✅ Заявка одобрена!',
    `${companyName} одобрили вашу заявку на «${vacancyTitle}» и написали вам — ответьте в чате.`,
    'perm_approved', 'matches',
  );
}

export async function notifyWorkerPermApplicationRejected(
  workerId: string,
  companyName: string,
  vacancyTitle: string,
): Promise<void> {
  await pushTo(
    workerId,
    '❌ Заявка отклонена',
    `${companyName} отклонили вашу заявку на «${vacancyTitle}».`,
    'perm_rejected', 'matches',
  );
}
