/**
 * «33 минуты назад» — как на карточке вакансии.
 *
 * Своя функция, а не Intl.RelativeTimeFormat: тот на Android в Hermes до сих
 * пор приходит без данных о языках и молча отдаёт английское «33 minutes ago».
 * Правил здесь на десяток строк, и они не меняются.
 */

/** Правильная форма слова при числе: 1 минута, 2 минуты, 5 минут. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/**
 * Сколько времени прошло. Пустая строка — если даты нет или она непонятна:
 * у партнёрских вакансий источник даёт её не всегда, и лучше не показать
 * ничего, чем показать «54 года назад» от нулевой даты.
 */
export function agoRu(iso?: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';

  const sec = Math.floor((Date.now() - t) / 1000);
  // Часы на телефоне могут отставать от сервера, и тогда дата окажется в
  // будущем. «Только что» здесь честнее отрицательного числа.
  if (sec < 60) return 'только что';

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`;

  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${plural(months, 'месяц', 'месяца', 'месяцев')} назад`;

  const years = Math.floor(days / 365);
  return `${years} ${plural(years, 'год', 'года', 'лет')} назад`;
}

/**
 * Домен ссылки без www — «hh.ru», «superjob.ru», «career.rt.ru».
 *
 * В контактах показываем именно его, а не весь адрес: полный адрес вакансии у
 * партнёров — это сто с лишним символов с идентификаторами и метками перехода,
 * и прочитать в нём источник невозможно. Человеку нужно понять, куда он
 * попадёт, а не увидеть строку целиком.
 */
export function domainOf(url?: string | null): string {
  if (!url) return '';
  // Свой разбор, а не URL: на Hermes он есть, но кидает на адресах без схемы,
  // а источники иногда присылают «www.hh.ru/vacancy/1» без «https://».
  const m = String(url).match(/^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#]+)|^([^/?#:]+\.[^/?#:]+)/i);
  const host = (m?.[1] ?? m?.[2] ?? '').split('@').pop() ?? '';
  return host.replace(/:\d+$/, '').replace(/^www\./i, '').toLowerCase();
}
