// Ссылки в тексте письма «Почты JobToo»: служба почты превращает кнопки
// письма в «надпись (адрес)», а экран делает адреса нажимаемыми.

export type MailPart = { text: string; url?: string };

const URL_RE = /https?:\/\/[^\s<>"'()[\]]+/g;

/** Длинный адрес с метками отслеживания — показываем «сайт/…», ведёт на полный. */
export function linkLabel(url: string): string {
  if (url.length <= 60) return url;
  const host = url.replace(/^https?:\/\//, '').split(/[/?#]/)[0];
  return `${host}/…`;
}

export function splitMailLinks(body: string): MailPart[] {
  const parts: MailPart[] = [];
  let last = 0;
  for (const match of body.matchAll(URL_RE)) {
    // Точка или запятая в конце — конец предложения, а не адреса.
    const url = match[0].replace(/[.,;:!?]+$/, '');
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: body.slice(last, start) });
    parts.push({ text: linkLabel(url), url });
    last = start + url.length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

/** «Платформа «Пульс» <hrplatform@sberbank.ru>» → «Платформа «Пульс»». */
export function senderName(sender: string): string {
  const name = sender.replace(/<[^>]*>/g, '').replace(/^["'\s]+|["'\s]+$/g, '').trim();
  return name || sender.replace(/[<>]/g, '').trim();
}

/** Начало письма одной строкой — для списка. */
export function mailPreview(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}

/** Как в почте: сегодня — время, в этом году — день и месяц, раньше — дата. */
export function mailDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
  }
  return d.toLocaleDateString('ru-RU');
}
