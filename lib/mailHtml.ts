// Обёртка письма для показа как в почте (app/mail.tsx). Письмо пишет чужой
// отправитель, поэтому документ закрыт политикой: ни одного скрипта, ни форм,
// ни встраиваемых страниц. Картинки и стили — откуда угодно (решение
// владельца 01.10.2026: «как в обычной почте»). Ссылки открываются снаружи
// (<base target="_blank">, на телефоне — перехват в WebView).
export const MAIL_CSP =
  "default-src 'none'; img-src * data: blob:; style-src 'unsafe-inline' *; font-src * data:; media-src * data:; form-action 'none'; frame-src 'none'; base-uri 'none'";

export function mailDocument(html: string): string {
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<meta http-equiv="Content-Security-Policy" content="${MAIL_CSP}">`
    + '<base target="_blank">'
    + '<style>html,body{margin:0;padding:0;background:#fff}'
    + 'body{padding:12px;font-family:-apple-system,Roboto,Arial,sans-serif;font-size:15px;line-height:1.45;color:#141414;word-wrap:break-word;overflow-wrap:anywhere}'
    + 'img{max-width:100%;height:auto}table{max-width:100%!important}</style>'
    + '</head><body>' + html + '</body></html>';
}

/** Какие переходы из письма открывать во внешнем браузере. */
export function isExternalMailLink(url: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(url);
}
