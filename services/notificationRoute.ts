// Куда вести по нажатию на уведомление. Одна таблица на всех: и системный
// пуш (app/_layout.tsx), и колокольчик внутри приложения ходят сюда, чтобы
// одно и то же уведомление всегда открывало один и тот же экран.

export type NotifTarget = { pathname: string; params?: Record<string, string> };

const TO_MATCHES = new Set([
  'new_applicant', 'match_employer', 'match_worker',
  'shift_confirmed_by_employer', 'shift_cancelled',
  'new_perm_applicant', 'perm_approved', 'perm_rejected',
  'jupiter_sent',
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
  if (t.startsWith('📥') || t.startsWith('🎉') || t.startsWith('✅') || t.startsWith('❌')) {
    return { pathname: '/(tabs)/matches' };
  }
  if (t.startsWith('⚡') || t.startsWith('💼')) return { pathname: '/(tabs)/feed' };
  return null;
}
