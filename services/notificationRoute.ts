// Куда вести по нажатию на уведомление. Одна таблица на всех: и системный
// пуш (app/_layout.tsx), и колокольчик внутри приложения ходят сюда, чтобы
// одно и то же уведомление всегда открывало один и тот же экран.

type NotifTarget = { pathname: string; params?: Record<string, string> };

const TO_MATCHES = new Set([
  'new_applicant', 'match_employer', 'match_worker',
  'shift_confirmed_by_employer', 'shift_cancelled',
  'new_perm_applicant', 'perm_approved', 'perm_rejected',
  'jupiter_sent', 'jupiter_failed',
  // Напоминание работодателю «Кандидаты ждут» и автоотказ работнику.
  'pending_apps', 'app_auto_rejected',
  // Ответ по отклику, присланный из tg.php (expo_push_one), и отказ по смене.
  'perm_status', 'shift_rejected',
]);

const TO_FEED = new Set(['nearby_shift', 'nearby_perm']);

export function routeForNotification(
  type?: string | null,
  payload?: { chatId?: string; applicationId?: string } | null,
): NotifTarget | null {
  if (!type) return null;
  // Юпитер ждёт слово с картинки: сразу на экран капчи этой заявки. Id
  // заявки приходит только в payload колокольчика (системный пуш нейтральный,
  // {type:'refresh'}); без id — в «Отклики», там заявка в «Нужны вы».
  if (type === 'jupiter_captcha') {
    return payload?.applicationId
      ? { pathname: '/jupiter-captcha', params: { id: payload.applicationId } }
      : { pathname: '/(tabs)/matches' };
  }
  // Работодатели задали вопросы — сразу в очередь вопросов.
  if (type === 'jupiter_questions') return { pathname: '/jupiter-questions' };
  if (type === 'support') return { pathname: '/support' };
  if (type === 'message') {
    return payload?.chatId
      ? { pathname: '/chat-room', params: { chatId: payload.chatId } }
      : { pathname: '/(tabs)/chats' };
  }
  if (TO_MATCHES.has(type)) return { pathname: '/(tabs)/matches' };
  if (TO_FEED.has(type)) return { pathname: '/(tabs)/feed' };
  return null;
}

// Уведомления, сохранённые до появления колонки type, знают о себе только
// заголовок. Эмодзи в начале заголовка задаёт вид однозначно — по нему и
// определяем экран, чтобы старый список тоже открывался по нажатию.
export function routeByTitle(title: string): NotifTarget | null {
  const t = title.trim();
  if (t.startsWith('💬')) return { pathname: '/(tabs)/chats' };
  if (t.startsWith('🆘')) return { pathname: '/support' };
  // Записаны до того, как у них появился type (01.10.2026).
  if (t.startsWith('⏳') || t === 'Отклик закрыт без ответа') return { pathname: '/(tabs)/matches' };
  if (t.startsWith('📥') || t.startsWith('🎉') || t.startsWith('✅') || t.startsWith('❌')) {
    return { pathname: '/(tabs)/matches' };
  }
  if (t.startsWith('⚡') || t.startsWith('💼')) return { pathname: '/(tabs)/feed' };
  return null;
}

// Системный пуш обезличен (push_privacy.php шлёт только {type:'refresh'}):
// что случилось, знает колокольчик. По нажатию берём самое свежее
// непрочитанное уведомление и ведём туда же, куда повёл бы колокольчик.
// Нет такого или оно никуда не ведёт — в «Отклики»: туда приходит почти всё.
export function routeForRefreshPush(
  notes: { title: string; is_read: boolean; type?: string | null; payload?: any }[],
): NotifTarget {
  const fresh = notes.find((n) => !n.is_read);
  if (fresh) {
    const t = routeForNotification(fresh.type, fresh.payload) ?? routeByTitle(fresh.title);
    if (t) return t;
  }
  return { pathname: '/(tabs)/matches' };
}
