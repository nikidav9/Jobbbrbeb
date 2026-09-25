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
