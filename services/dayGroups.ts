/**
 * Группировка списков по дням.
 *
 * Общее для «Откликов» и «Избранного»: оба показывают ленту событий,
 * разбитую заголовками «СЕГОДНЯ», «ВЧЕРА», «8 СЕНТЯБРЯ».
 *
 * Всё считается по МЕСТНОМУ времени. С toISOString() получилось бы UTC, и у
 * московского пользователя вечерние события уезжали бы в завтрашнюю группу.
 */

const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const MONTHS_SHORT = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

/** Ключ дня (YYYY-MM-DD) по местному времени. Пустая строка — дата непригодна. */
export function dayKey(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Сегодняшний ключ — вынесен, чтобы тесты могли считать от своей даты. */
export function todayKey(now: Date = new Date()): string {
  return dayKey(now.toISOString());
}

/** Заголовок группы: «СЕГОДНЯ», «ВЧЕРА» или «8 СЕНТЯБРЯ». */
export function dayLabel(key: string, now: Date = new Date()): string {
  if (!key) return 'РАНЬШЕ';
  if (key === todayKey(now)) return 'СЕГОДНЯ';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (key === todayKey(y)) return 'ВЧЕРА';
  const [, mm, dd] = key.split('-');
  return `${parseInt(dd, 10)} ${MONTHS_GEN[parseInt(mm, 10) - 1] ?? ''}`.toUpperCase();
}

/** Короткая дата для правого края строки: «сегодня», «вчера», «8 сен». */
export function dayShort(key: string, now: Date = new Date()): string {
  if (!key) return '';
  if (key === todayKey(now)) return 'сегодня';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (key === todayKey(y)) return 'вчера';
  const [, mm, dd] = key.split('-');
  return `${parseInt(dd, 10)} ${MONTHS_SHORT[parseInt(mm, 10) - 1] ?? ''}`;
}

/**
 * Разложить список по дням, сохраняя порядок исходного списка.
 *
 * Порядок не трогаем намеренно: сортировка — дело вызывающего, у него свои
 * правила (у откликов свежие сверху, у избранного тоже, но по другому полю).
 */
export function groupByDay<T>(
  items: T[],
  at: (item: T) => string | null | undefined,
  now: Date = new Date(),
): { key: string; label: string; items: T[] }[] {
  const out: { key: string; label: string; items: T[] }[] = [];
  for (const item of items) {
    const key = dayKey(at(item));
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(item);
    else out.push({ key, label: dayLabel(key, now), items: [item] });
  }
  return out;
}
