// «В сети» / «был в сети …» — из отметки last_seen_at, которую приложение
// обновляет раз в две минуты. Порог в три минуты выбран с запасом: отметка
// успевает обновиться до того, как человек «погаснет» на глазах собеседника.

import { MONTHS_SHORT } from '@/services/dayGroups';

const ONLINE_MS = 3 * 60 * 1000;

export function isOnline(lastSeenAt?: string | null): boolean {
  if (!lastSeenAt) return false;
  const t = new Date(lastSeenAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < ONLINE_MS;
}

/**
 * Строка под именем в чате. Женский род не угадываем — пишем «был(а)»,
 * пола в профиле нет.
 */
export function lastSeenLabel(lastSeenAt?: string | null): string | null {
  if (!lastSeenAt) return null;
  const d = new Date(lastSeenAt);
  const t = d.getTime();
  if (Number.isNaN(t)) return null;

  const diff = Date.now() - t;
  if (diff < ONLINE_MS) return 'в сети';
  if (diff < 0) return 'в сети';

  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `был(а) ${mins} мин назад`;

  const hours = Math.floor(mins / 60);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (sameDay) return `был(а) сегодня в ${hh}`;

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `был(а) вчера в ${hh}`;

  if (hours < 24 * 7) {
    return `был(а) ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} в ${hh}`;
  }
  const year = d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `был(а) ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${year}`;
}

// ── Отзывчивость ────────────────────────────────────────────────────────────
// Показываем в чужом профиле, чтобы человек понимал, стоит ли писать. Из 143
// чатов ответ пришёл в 65 — половина откликов уходит в пустоту, и узнают об
// этом только через двое суток, когда отклик закроется сам.

/** «обычно отвечает в течение часа» — из медианы задержки первого ответа. */
export function replySpeedLabel(medianSeconds?: number | null): string | null {
  if (medianSeconds == null) return null;
  const mins = Math.round(medianSeconds / 60);
  if (mins <= 15) return 'сразу';
  if (mins <= 60) return 'в течение часа';
  const hours = Math.round(mins / 60);
  if (hours < 24) return `около ${hours} ${plural(hours, 'часа', 'часов', 'часов')}`;
  const days = Math.max(1, Math.round(hours / 24));
  return `около ${days} ${plural(days, 'дня', 'дней', 'дней')}`;
}

/** «отвечает примерно в 8 случаях из 10» — доля переписок, где вообще ответил. */
export function replyRateLabel(answered: number, chats: number): string | null {
  if (chats < 2) return null;
  if (answered === 0) return `ни разу из ${chats}`;
  if (answered === chats) return `всегда, ${chats} из ${chats}`;
  return `${answered} из ${chats} переписок`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
